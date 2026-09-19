/**
 * `materializeSeedHome` 的单元测试。
 *
 * 为什么值得专门测：这段逻辑决定"首启能不能起来"，而且踩过的坑都很隐蔽 ——
 * 开发态插件是 Junction，原样重建会留下**悬空链接**，直接表现为 harness
 * `Cannot find package '…'`（不是崩溃，是插件静默消失）。这些用端到端冒烟
 * 只能间接发现，所以在这里用构造出来的种子树把三种情况钉死。
 *
 * 跑法：`npm run test`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lstatSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isCrossDevice, isLinkUnsupported, materializeSeedHome } from '../src/main/materialize'

/** 造一棵最小种子树：清单 + 插件依赖 + 两类链接。 */
function makeSeed (root: string, dshDir: string): string {
  const seed = join(root, 'seed')
  const profile = join(seed, 'profiles', 'web')

  mkdirSync(join(profile, 'node_modules', 'a-real-plugin'), { recursive: true })
  writeFileSync(join(profile, 'node_modules', 'a-real-plugin', 'index.js'), 'export default 1\n')
  writeFileSync(join(profile, 'package.json'), '{"name":"profile"}\n')
  writeFileSync(join(profile, 'cordis.yml'), 'rows: []\n')

  // ① 指向 dsh 安装目录内部的链接 —— 必须**原样保留**
  mkdirSync(join(dshDir, 'node_modules', 'dsh-fallback'), { recursive: true })
  writeFileSync(join(dshDir, 'node_modules', 'dsh-fallback', 'index.js'), 'export default 2\n')
  mkdirSync(join(profile, 'node_modules', '@deepseek-ai'), { recursive: true })   // 名字判据会跳过
  symlinkSync(join(dshDir, 'node_modules', 'dsh-fallback'),
    join(profile, 'node_modules', 'dsh-fallback'),
    process.platform === 'win32' ? 'junction' : 'dir')

  // ② 指向仓库外部的链接（开发态插件）—— 必须**解引用成真实内容**
  const external = join(root, 'external-plugin')
  mkdirSync(external, { recursive: true })
  writeFileSync(join(external, 'package.json'), '{"name":"dsh-px-updater"}\n')
  writeFileSync(join(external, 'index.js'), 'export default 3\n')
  symlinkSync(external, join(profile, 'node_modules', 'dsh-px-updater'),
    process.platform === 'win32' ? 'junction' : 'dir')

  // ③ 上一级的 fallback 树（整棵必须跳过）
  mkdirSync(join(seed, 'profiles', 'node_modules', 'should-be-skipped'), { recursive: true })
  writeFileSync(join(seed, 'profiles', 'node_modules', 'should-be-skipped', 'index.js'), 'x\n')

  return seed
}

test('物化：硬链接 node_modules，跳过 fallback 树，保留 dsh 内链接、解引用外部链接', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-mat-'))
  try {
    const dshDir = join(root, 'dsh')
    mkdirSync(dshDir, { recursive: true })
    const seed = makeSeed(root, dshDir)
    const home = join(root, 'home')

    const r = await materializeSeedHome({ seedHome: seed, home, profileName: 'web', dshDir })
    assert.ok(r.linked > 0, '应有硬链接')
    assert.equal(r.copied, 0, '同卷内不应有复制')

    const profileDest = join(home, 'profiles', 'web')

    // ① dsh 内部链接被原样保留（仍是链接，且目标可解析）
    //    注意：判断"是不是链接"必须用 lstatSync —— statSync 会跟随链接，
    //    Windows 上 junction 通过 stat 看就是普通目录，isSymbolicLink() 恒为 false。
    const kept = join(profileDest, 'node_modules', 'dsh-fallback')
    assert.equal(lstatSync(kept).isSymbolicLink(), true, 'dsh 内部链接应保留为符号链接/Junction')
    assert.ok(statSync(kept).isDirectory(), 'dsh 内部链接应解析到真实目录（不悬空）')
    assert.equal(readFileSync(join(kept, 'index.js'), 'utf8').includes('2'), true, '链接目标内容应可读')

    // ② 外部链接被解引用成真实内容（不是悬空链接）
    const plugin = join(profileDest, 'node_modules', 'dsh-px-updater')
    assert.ok(statSync(plugin).isDirectory(), '外部链接应成为真实目录')
    assert.equal(readFileSync(join(plugin, 'package.json'), 'utf8').includes('dsh-px-updater'), true,
      '插件内容应被真实物化')
    assert.equal(lstatSync(plugin).isSymbolicLink(), false, '外部链接不应残留为符号链接')

    // ③ 上一级的 fallback 树整棵跳过
    const skipped = join(home, 'profiles', 'node_modules')
    assert.equal(statSync(skipped, { throwIfNoEntry: false }), undefined, 'profiles/node_modules 不应被物化')

    // ④ `@deepseek-ai` 命名空间整棵跳过
    assert.equal(statSync(join(profileDest, 'node_modules', '@deepseek-ai'), { throwIfNoEntry: false }), undefined)

    // ⑤ 完成标记
    assert.ok(readFileSync(join(home, '.dsh-px-materialized'), 'utf8').includes('linked='))

    // ⑥ 硬链接确实共享数据：同一份文件在种子侧与目标侧是同一个文件
    const seedFile = join(seed, 'profiles', 'web', 'node_modules', 'a-real-plugin', 'index.js')
    const destFile = join(profileDest, 'node_modules', 'a-real-plugin', 'index.js')
    assert.equal(statSync(seedFile).ino, statSync(destFile).ino, '两边应是同一个文件（硬链接）')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('物化：可重复执行（幂等），第二次全跳过', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dshpx-mat2-'))
  try {
    const dshDir = join(root, 'dsh')
    mkdirSync(dshDir, { recursive: true })
    const seed = makeSeed(root, dshDir)
    const home = join(root, 'home')

    const first = await materializeSeedHome({ seedHome: seed, home, profileName: 'web', dshDir })
    const second = await materializeSeedHome({ seedHome: seed, home, profileName: 'web', dshDir })

    assert.ok(first.linked > 0)
    assert.equal(second.linked, 0, '第二次不应再建链接')
    assert.equal(second.copied, 0, '第二次不应再复制')
    assert.ok(second.skipped > 0, '第二次应全部跳过')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('物化：硬链接数达上限时回退复制，且不中断', async (t) => {
  // 这个用例的**前提是 Windows/NTFS 特有的**：NTFS 单文件硬链接上限是 1024，
  // 而 Linux 的 ext4 上限约 65000 —— 在 Linux 上无论建多少条都触发不了上限，
  // 于是"回退"根本不会发生，断言必然失败（CI 上就是这么暴露的）。
  //
  // 我们真正要守的是"上限触发后回退复制且不中断"这条逻辑；它只在 NTFS 上能被
  // 真实触发。在其他平台跳过，并说明原因，而不是留一个会误报失败的用例。
  if (process.platform !== 'win32') {
    t.skip('硬链接上限回退只在 NTFS（上限 1024）上可真实触发；本平台跳过')
    return
  }

  const root = mkdtempSync(join(tmpdir(), 'dshpx-mat3-'))
  try {
    // 真实触发条件：NTFS 单文件硬链接上限是 1024。种子树的文件来自 pnpm
    // 内容寻址 store，每装一个项目就多一条链接，因此"链接数耗尽"是**必然会遇到**
    // 的真实情况（实测开发机上某个文件已有 623 条）。这里把它造出来。
    const dshDir = join(root, 'dsh')
    mkdirSync(dshDir, { recursive: true })
    const seed = makeSeed(root, dshDir)

    const target = join(seed, 'profiles', 'web', 'node_modules', 'a-real-plugin', 'index.js')
    const filler = join(root, 'filler')
    mkdirSync(filler, { recursive: true })
    let made = 0
    let hitLimit = false
    try {
      for (let i = 0; i < 1100; i++) {
        linkSync(target, join(filler, `h${i}`))
        made++
      }
    } catch {
      // 到上限了 —— 正是我们要的状态。
      hitLimit = true
    }
    // 在 NTFS 上 1100 次必然触顶；没触顶说明前提变了，宁可跳过也不要误报。
    if (!hitLimit) {
      t.skip(`未能触发硬链接上限（已建 ${made} 条），跳过`)
      return
    }

    const home = join(root, 'home')
    const r = await materializeSeedHome({ seedHome: seed, home, profileName: 'web', dshDir })

    // 关键：不能抛错中断；该文件应以复制方式落地，且内容正确。
    assert.ok(r.copied >= 1, `链接数耗尽后应回退复制（实际 copied=${r.copied}）`)
    const dest = join(home, 'profiles', 'web', 'node_modules', 'a-real-plugin', 'index.js')
    assert.equal(readFileSync(dest, 'utf8'), readFileSync(target, 'utf8'), '回退复制的内容应与源一致')

    // 标记文件里应记录回退原因，便于事后排查"为什么这次慢/占盘"。
    const marker = readFileSync(join(home, '.dsh-px-materialized'), 'utf8')
    assert.match(marker, /hardlinkFallback=[1-9]/, '标记文件应记录回退次数')

    // 链接本身是**独立副本**（不再与源共享），所以能继续正常使用。
    assert.notEqual(statSync(dest).ino, statSync(target).ino, '回退后应是独立文件')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('跨卷判据：EXDEV 与不支持硬链接的错误码都被识别', () => {
  assert.equal(isCrossDevice(Object.assign(new Error('x'), { code: 'EXDEV' })), true)
  assert.equal(isCrossDevice(Object.assign(new Error('x'), { code: 'EPERM' })), false, 'EPERM 不是跨卷')
  assert.equal(isCrossDevice(new Error('x')), false)

  for (const code of ['EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EINVAL', 'UNKNOWN']) {
    assert.equal(isLinkUnsupported(Object.assign(new Error('x'), { code })), true, `${code} 应视为不支持硬链接`)
  }
  assert.equal(isLinkUnsupported(Object.assign(new Error('x'), { code: 'EXDEV' })), false)
})
