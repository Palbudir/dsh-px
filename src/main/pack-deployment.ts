import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { gt } from 'semver'
import { verifySignedRelease, type ReleaseManifest } from '../shared/signed-release'
import { assertRegularOrAbsent, writeAtomic } from './native-atomic'
import { extractPack, sha256, type PackContract } from './pack-archive'
import { materializePackRuntime } from './runtime-cache'
import { provisionNativeComposition } from './native-composition'

export interface PackReceipt extends PackContract {
  sha256: string
  signed?: string
}
interface DeploymentState {
  schemaVersion: 1
  active?: PackReceipt
  previous?: PackReceipt
  pending?: PackReceipt
  trial?: PackReceipt
  error?: string
  userManaged?: boolean
}
export interface DeploymentOptions {
  profile: string
  bundledRuntime: string
  bundledArchive: string
  bundled: PackReceipt
  candidate?: boolean
  hostKey: string
  keys: Record<string, string>
  install: (runtime: string, args: string[]) => Promise<void>
}

/** Changes only an offline native profile. The caller holds DSH's profile lock. */
export class PackDeployment {
  readonly own: string
  private readonly statePath: string
  constructor(readonly options: DeploymentOptions) {
    this.own = join(options.profile, '.dsh-px')
    mkdirSync(this.own, { recursive: true })
    if (!lstatSync(this.own).isDirectory() || lstatSync(this.own).isSymbolicLink())
      throw Error('Pack state must be profile-owned')
    this.statePath = join(this.own, 'deployment.json')
  }
  read(): DeploymentState {
    assertRegularOrAbsent(this.statePath)
    if (!existsSync(this.statePath)) return { schemaVersion: 1 }
    const state: DeploymentState = JSON.parse(readFileSync(this.statePath, 'utf8'))
    if (state.schemaVersion !== 1) throw Error('Unsupported Pack deployment state')
    for (const item of [state.active, state.previous, state.pending, state.trial]) if (item) this.verify(item)
    return state
  }
  private write(state: DeploymentState): void {
    writeAtomic(this.statePath, JSON.stringify(state, null, 2))
  }
  manifest(signed: string): ReleaseManifest {
    const manifest = verifySignedRelease(signed, this.options.keys, {
      product: 'pack',
      channel: 'preview',
      platform: 'any',
      protocolGeneration: this.options.bundled.protocolGeneration
    })
    if (
      manifest.hostVersion !== this.options.bundled.hostVersion ||
      manifest.upstreamCommit !== this.options.bundled.upstreamCommit
    )
      throw Error('此 Pack 需要不同的 DSH 核心，请先更新客户端')
    return manifest
  }
  private verify(receipt: PackReceipt): void {
    if (!/^[a-f0-9]{64}$/.test(receipt.sha256)) throw Error('Invalid Pack receipt')
    if (receipt.signed) {
      // Permit an older host receipt to remain a rollback record across Desktop upgrades.
      const manifest = verifySignedRelease(receipt.signed, this.options.keys, {
        product: 'pack',
        channel: 'preview',
        platform: 'any',
        protocolGeneration: receipt.protocolGeneration
      })
      if (
        manifest.version !== receipt.version ||
        manifest.sourceCommit !== receipt.sourceCommit ||
        manifest.hostVersion !== receipt.hostVersion ||
        manifest.upstreamCommit !== receipt.upstreamCommit ||
        manifest.files[0].sha256 !== receipt.sha256
      )
        throw Error('Pack receipt differs from its signed release')
    } else {
      // Bundled receipts survive Desktop upgrades; archive provenance was checked by the installer.
      if (
        !/^\d+\.\d+\.\d+-alpha\.\d+$/.test(receipt.version) ||
        !/^[a-f0-9]{40}$/.test(receipt.sourceCommit) ||
        !/^[a-f0-9]{40}$/.test(receipt.upstreamCommit)
      )
        throw Error('Invalid bundled Pack receipt')
    }
  }
  private archive(receipt: PackReceipt): string {
    return join(this.own, `release-${receipt.sha256}.tgz`)
  }
  private directory(receipt: PackReceipt): string {
    return join(this.own, `release-${receipt.sha256}`)
  }
  private prepare(bytes: Buffer, receipt: PackReceipt, candidate = false): void {
    if (sha256(bytes) !== receipt.sha256) throw Error('Pack checksum mismatch')
    const destination = this.directory(receipt),
      ready = join(destination, '.complete')
    if (!existsSync(ready)) {
      const temporary = destination + '.' + randomUUID()
      extractPack(bytes, temporary, receipt, candidate)
      writeAtomic(join(temporary, '.complete'), receipt.sha256)
      if (existsSync(destination)) renameSync(destination, destination + '.incomplete-' + randomUUID())
      renameSync(temporary, destination)
    }
    const archive = this.archive(receipt)
    if (!existsSync(archive) || sha256(readFileSync(archive)) !== receipt.sha256) writeAtomic(archive, bytes)
  }
  /** Download validation is separate from restart consent; no live profile changes here. */
  stage(signed: string, bytes: Buffer): PackReceipt {
    if (this.read().userManaged) throw Error('当前使用自行安装的 Pack，请通过原生插件管理器维护。')
    const manifest = this.manifest(signed),
      file = manifest.files[0]
    if (bytes.length !== file.size || createHash('sha512').update(bytes).digest('base64') !== file.sha512)
      throw Error('Incomplete or invalid Pack download')
    const receipt: PackReceipt = {
      version: manifest.version,
      sourceCommit: manifest.sourceCommit,
      hostVersion: manifest.hostVersion,
      upstreamCommit: manifest.upstreamCommit,
      protocolGeneration: manifest.protocolGeneration,
      sha256: file.sha256,
      signed
    }
    if (!gt(receipt.version, this.read().active?.version ?? this.options.bundled.version))
      throw Error('Pack update is no longer newer than the active version')
    this.prepare(bytes, receipt)
    return receipt
  }
  queue(receipt: PackReceipt): void {
    this.verify(receipt)
    if (!receipt.signed) throw Error('Only a signed downloaded Pack can be queued')
    this.manifest(receipt.signed)
    if (!gt(receipt.version, this.read().active?.version ?? this.options.bundled.version))
      throw Error('准备的 Pack 已不再新于当前版本，请重新检查更新。')
    if (sha256(readFileSync(this.archive(receipt))) !== receipt.sha256)
      throw Error('Pack cache changed before restart')
    this.write({ ...this.read(), pending: receipt })
  }
  confirm(): void {
    const state = this.read()
    if (state.trial) this.write({ ...state, trial: undefined })
  }
  async activate(): Promise<string> {
    const options = this.options,
      bundled = options.bundled
    let state = this.read()
    this.prepare(readFileSync(options.bundledArchive), bundled, options.candidate)
    let selected = state.pending ?? state.active ?? bundled
    const interrupted = state.trial !== undefined
    if (interrupted) {
      selected = state.previous ?? bundled
      state = { ...state, pending: undefined, error: '上次 Pack 启动未完成，已回退到先前版本。' }
    }
    const compatible = (r: PackReceipt) =>
      r.hostVersion === bundled.hostVersion &&
      r.upstreamCommit === bundled.upstreamCommit &&
      r.protocolGeneration === bundled.protocolGeneration
    if (!compatible(selected)) {
      selected = bundled
      state.error = '原 Pack 与新客户端核心不兼容，已切换到随附版本。'
    } else if (!state.pending && !interrupted && gt(bundled.version, selected.version)) selected = bundled
    const previous = interrupted
      ? selected
      : state.active && compatible(state.active)
        ? state.active
        : bundled
    const deploy = async (receipt: PackReceipt): Promise<string> => {
      this.prepare(
        readFileSync(this.archive(receipt)),
        receipt,
        options.candidate && receipt.sha256 === bundled.sha256
      )
      const runtime = await materializePackRuntime({
        profile: options.profile,
        bundledRuntime: options.bundledRuntime,
        hostKey: options.hostKey,
        packSha256: receipt.sha256,
        version: receipt.version,
        foundationDirectory: join(this.directory(receipt), 'foundation')
      })
      const result = await provisionNativeComposition({
        profile: options.profile,
        directory: this.directory(receipt),
        version: receipt.version,
        install: (args) => options.install(runtime, args)
      })
      if (result === 'failed') throw Error('Pack 安装失败，原生依赖已恢复')
      if (result === 'user-managed') throw new UserManagedPack()
      return runtime
    }
    // Persist trial before the first profile mutation. A process crash retries the previous cohort.
    const changing = interrupted || selected.sha256 !== state.active?.sha256
    if (state.pending && !interrupted) state.error = undefined
    if (changing) this.write({ ...state, previous, trial: selected, pending: undefined })
    let runtime: string
    try {
      runtime = await deploy(selected)
    } catch (error) {
      if (error instanceof UserManagedPack) {
        this.write({
          schemaVersion: 1,
          userManaged: true,
          error: '当前 Pack 由用户自行管理，保留其声明；请通过原生插件管理器更新。'
        })
        const pointer = join(this.own, 'runtime.json')
        assertRegularOrAbsent(pointer)
        rmSync(pointer, { force: true })
        return options.bundledRuntime
      }
      if (selected.sha256 === previous.sha256) throw error
      runtime = await deploy(previous)
      state.error = String(error instanceof Error ? error.message : error)
      selected = previous
    }
    this.write({
      schemaVersion: 1,
      active: selected,
      previous: changing ? previous : state.previous,
      trial: changing ? selected : undefined,
      error: state.error
    })
    writeAtomic(
      join(this.own, 'runtime.json'),
      JSON.stringify({ schemaVersion: 1, runtime, version: selected.version })
    )
    return runtime
  }
}

class UserManagedPack extends Error {}
