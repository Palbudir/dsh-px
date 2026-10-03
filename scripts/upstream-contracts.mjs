import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

/**
 * Pinned upstream DSH contracts used by CI to verify official dependencies.
 * Package identities, hashes and file selections are maintained here.
 * Each tarball URL is derived from the registry, package name and version, and must match the
 * pinned sha512 SRI. Only listed regular files are projected, in memory, never executed.
 */
export const UPSTREAM_LOCK = deepFreeze({
  schemaVersion: 1,
  registry: 'https://registry.npmjs.org',
  hosts: ['0.1.5-rc.2', '0.2.0-rc.1'],
  packages: {
    '@deepseek-ai/dsh-client-connection': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-W0GAZX01hAfrfjoZbtwEJ5ik3dG20Hy/0TFYJ6dnvwxtcacGYNIwi3f2oHpZgLcEw+PWwq1Y9IV1iKG+yDOytg==',
        '0.2.0-rc.1':
          'sha512-aMZvpoyryBUYpqIBxaC8+nYWcwluSCegIU5JIuKnWMyaZLNvMC187ZPm7Bbpvy3pR2hnfWqJaFkl2XQodGfGCA=='
      },
      files: [
        'package.json',
        'LICENSE',
        'lib/types/index.d.ts',
        'lib/types/rpc.d.ts',
        'lib/types/rpc-host.d.ts',
        'lib/types/api-request-trust.d.ts',
        'lib/types/browser-auth.d.ts',
        'lib/types/client/connection.d.ts'
      ],
      slices: [{ file: 'lib/index.js', anchor: 'requestRejection(request) {', before: 30, after: 30 }]
    },
    '@deepseek-ai/dsh-host-webserver': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-lFgGm9wDrHiTBANzsdoWzdfPSjWYuDFwCoNQ4Uko57Fo5XASL2unfRHGm1xZ828rwEYuGwRvJHMOuoP/17VmlA==',
        '0.2.0-rc.1':
          'sha512-/LkuSWupB7vijPty3Iypt9DZrBli9wsNh/E485m+xgo4uBbgloANQA+nyIpB0n+N20zleyV4EFYbe6Lb6k2oqQ=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    },
    '@deepseek-ai/dsh-client-ui-slots': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-uUKIHBcNzWmJFtTlPkgn7hprsE5uU8lJf8Fw7jKwUouZWIwGnLdxuunrm1LOZWr7G+b4UfjVwD4LV12rhF/WLg==',
        '0.2.0-rc.1':
          'sha512-GrQbf1KN9NGa63ZBocAKAA2W5aahRCOAQVYQoW2OLIvg5h2e1j30dqMx+nptni59YUvg0DmmLj6ggUXvFpzCQA=='
      },
      files: [
        'package.json',
        'LICENSE',
        'lib/types/index.d.ts',
        'lib/types/renderer.d.ts',
        'lib/types/store.d.ts'
      ]
    },
    '@deepseek-ai/dsh-client-ui-layout': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-N5+kH1W6UjzOuagJEKDenm/Gbs8Y2sz6btdmVKW5dypEEUgVWsQGV0auTC37gsWKWDaWGpfYOpeAa3Ybk6DYbQ==',
        '0.2.0-rc.1':
          'sha512-qleVtdPWbp4z/QDaz9QmfSoNIZPIkh18pGl7EGfvYcLOoh0ZCLUVmqVYDHF9XqpEBv5cFoh572YBBD7p8iH65w=='
      },
      files: [
        'package.json',
        'LICENSE',
        'lib/types/client/index.d.ts',
        'lib/types/client/columns.d.ts',
        'lib/types/client/service.d.ts',
        'lib/types/client/stores.d.ts'
      ]
    },
    '@deepseek-ai/dsh-client-ui-sidebar': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-52PGlC4e9zkD6MQOjDo2TakxsWi4f5QigmdNsHluhDMBUfwMYl8ppWGD3uuHyAkK95yh0D1eKI5UPdQ5kikn+A==',
        '0.2.0-rc.1':
          'sha512-OiUg7wrTDt7syjE1CEc6SuXqdNwQZ9naGwUYqGJyFPnyR54o1qM9HPwNP7bwQHgcF/JjizpvgB/9u8rgWzM01g=='
      },
      files: [
        'package.json',
        'LICENSE',
        'lib/types/client/index.d.ts',
        'lib/types/client/contract/slots.d.ts'
      ]
    },
    '@deepseek-ai/dsh-client-ui-sidebar-right': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-EqKZ5JuyM+yCd6TVe7NwTmZf9y7dyhcLczpnu5rG87RuwVufEz1ARqO9TBXf32ApXCeYOJQGVeJjR/VsYzVMgA==',
        '0.2.0-rc.1':
          'sha512-1xvY5uuOVx4Ci3mAS/TYLQRqT0OgTd3AASN6tPqtvGb4Zrd2ToF+7CnzCoFARAhCX6T/ZFZyKv9hx78V3On27w=='
      },
      files: [
        'package.json',
        'LICENSE',
        'lib/types/client/index.d.ts',
        'lib/types/client/service.d.ts',
        'lib/types/client/tab-registry.d.ts',
        'lib/types/client/tab-info.d.ts',
        'lib/types/client/tab-domain.d.ts',
        'lib/types/client/contract/slots.d.ts',
        'lib/types/client/contract/params.d.ts'
      ]
    },
    '@deepseek-ai/dsh-client-modules': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-034DxLlGvX4GgkqqFN2SGcQx8hKdicj5IrgENclBXXbyMDlpF9xADiWi5DxPms+iOBcL/5LLe84q/GCTWOrA2g==',
        '0.2.0-rc.1':
          'sha512-XvPOXcpz1bYU/uwRICpQRKL8mUHfcbUiLQiiXgi76H/eS5K7LNIHCSGzvmWk2IdCK7tPi4GP33lHAprrsAXCUw=='
      },
      files: [
        'package.json',
        'LICENSE',
        'lib/types/index.d.ts',
        'lib/types/client/index.d.ts',
        'lib/types/client/manifest.d.ts',
        'lib/types/client/system.d.ts'
      ]
    },
    '@deepseek-ai/dsh-app-boot': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-beM+ULhjr2mGoyrWta3F6HOQ9OD+i5tKG8BU0RtgVGmXDjA57cVEAiEkkgPLMTxbbzU+xsFP61I5SApna4Cz5A==',
        '0.2.0-rc.1':
          'sha512-iHUYI+Tc3FlaYay0aLg4LsmZELi8wNWd6DSYrd46enUv0SWgm3qXVFLZivlcKqKWxcjuuvL5JxNemxGiMRIWxQ=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts'],
      slices: [{ file: 'lib/index.js', anchor: 'function anchorInsertedPluginNames(', before: 2, after: 60 }]
    },
    '@deepseek-ai/dsh-client-locale': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-kv56ki/WQWagsHt94wJAPzsiKnxa8KlmM33bZGgl2SgF4atlQ3iRCdkwJ3fQARXF4Ocnfutivoj5fu5usks1Sw==',
        '0.2.0-rc.1':
          'sha512-4LNz28WCad8v3quEeuSTXOTHb6YHrMGkjIq73W+6+6zkEBbbmpfiz4FJ3MW9iE72DXLR9/IyUHNBpf6N/CVZ4Q=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/client/index.d.ts']
    },
    '@deepseek-ai/dsh-client-ui-settings': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-NsnZLRI2ZDzJJylx9KATuDwrTdJ0FSP93dU5SL5k2G2W4FLUspNvlAmk7bha5Miopfzmfd+h5/NvMdWe8PVVjQ==',
        '0.2.0-rc.1':
          'sha512-ojZaW+Ivcwve/cvd6Zp7iA8j/uydRXNViuV4EyZaWtkp6G6yHUj6dVuwLKKlLmkgAJptcm5mJSV9AwXFe8jIzg=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/client/index.d.ts']
    },
    '@deepseek-ai/dsh-api-session-controller': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-rwOxS6piZ9EuLgE/pbq4cUlRCGv98IKgdFnK5v8WNwZYKug3rUpvYODDU9vE42ydmClgjFd/KIAaEDFPatcDpA==',
        '0.2.0-rc.1':
          'sha512-0oSU0vdUjQycdVPvqZeEGrnBvRiKySgLOqZ/FwDYh0FjcpD8/1SKAKhsNKq8IavjiYEXluFpT55dvOEfmicEkA=='
      },
      files: [
        'package.json',
        'LICENSE',
        'lib/types/client/index.d.ts',
        'lib/types/client/contract/sessions.d.ts',
        'lib/types/client/sessions/service.d.ts'
      ]
    },
    '@deepseek-ai/dsh-client-ui-workspace': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-BRe/RDIJJblCECYLwVroy8h4+cXrf3eXSfLjJ6BdpnW2fI3CBJuEKlFaBPGtKAFTTain0rQ+dP6SscZNrXm5Gw==',
        '0.2.0-rc.1':
          'sha512-8ehLXqZGvFWk93RxQwnCKkaoMrTxdyE7HBbKyXaav3V6GAMOpe+MbUmR8fLm17JTno4cfMr/Mg2S4P9hS5dBAw=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/client/navigation.d.ts']
    },
    '@deepseek-ai/dsh-client-ui-session': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-EGCG4Ik95obEM1MA3ZVSsPuK7nknQyhfV/qgNg035jn6gtZJxAguuck9qBNuSOC0upx1xTbh+gSJ6bAmS4ugcQ==',
        '0.2.0-rc.1':
          'sha512-eNFVTb0GwNxI0Q7ZlzjHsIXvFYw4NCApMcdw0DnxYw6tsAc2oLFkYFUx/PACigYvWhPiGLw4xZtOEkW5/Iekfw=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/client/index.d.ts']
    },
    '@deepseek-ai/dsh-client-ui-sidebar-files': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-ZJCpQNruk1Sm29wce30+ATjFkvnuhd55yB3wb+9WpeN+hW6jPmBnAmvUGbS4JsWqpimHLL4y8xYUd5AzAe7+sQ==',
        '0.2.0-rc.1':
          'sha512-5Ie/q64XxEQ6paS8Jf2mkK3xhb+gkA+fyYCqBwwrMOXwDdwkHtIzrAZ/tSbu7b/UlugnoiHhxWqxIey0dlENtg=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/client/definition.d.ts', 'lib/types/client/index.d.ts']
    },
    '@deepseek-ai/dsh-util-workspace-path': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-RCBz+6BpdPDNsRk2ukIdIIuLdf6u+cS8sLiViFg/8/x/kxc+LEXRKJMy2xv+YA9hYOGFK109rjUFgx9JVtZf2w==',
        '0.2.0-rc.1':
          'sha512-8pNpCCgByrlYtxXqDLuIz/77rJg4p+bdQs/IotRppM7ahfIQtY/u3qkcbniCTQo4FUfoC3F2p6Lw/fHdLhcgqQ=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/file-address.d.ts', 'lib/index.js']
    },
    '@deepseek-ai/dsh-client-ui-renderer': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-otUJ72f1UfL8b/UL+tMdSE+FHqJWErPmHs2AWbad9nHXghNoZjL2bxumOhI3b+Hb1eezhhM+KanlWzIulTIkvw==',
        '0.2.0-rc.1':
          'sha512-jEX/d4MBgfMEYVhGN2ooiJsPfk596+ISPLKYTfOwSTTOwus/9bvGI8dMCIz2CrSKa0LMHcK6lUi/f0nQ6hWQlw=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/client/index.d.ts']
    },
    '@deepseek-ai/dsh-client-ui-conversation': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-VnZ0VrmI7+1JH/iMYV6+FaxCsZrVk4CZIuG+k1HkeevHgUPHe3ghLo8u1Qt9cx00MEH5i3bLOY5Nka3w4mbA6g==',
        '0.2.0-rc.1':
          'sha512-2aDx9NZUrExfCe6elV5RczHoxJS/zyJlpdv7fD1FyTZIN7DS2yvDQe9+P6FpPCUfm1Sn6y0slls8QK9aLo4IvQ=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/client/index.d.ts']
    },
    '@deepseek-ai/dsh-session': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-y+klWiGAWR4m4cc4ylurA0cW63673B4N8cr2ANMimweDZAfxL4XVBC7WiD/5DT2DtIhYmVZhz/niyS/WbniUTA==',
        '0.2.0-rc.1':
          'sha512-KUDCUk8kmiJCwvV3gDbkUSpkyoGHdg36nIhKsEh6iBoYDuIQCuvX2htiVRXCm099XZO6rCBVInmm1193UoPYcA=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    },
    '@deepseek-ai/dsh-session-persistence': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-0nDeM+H+3YR0CH/IVlhjNL9bDx2G4QbliaLekVxY0jdZHM7RqdN/fWPKjeCKbXcRq6qdn9QcmvXU3uWZdErlIw==',
        '0.2.0-rc.1':
          'sha512-OAHmDpR3LasgEXzpmGyajlgcG5tOEzlUSclovllLtKaY402hcTn6Vm7W/EzRMwc+jvSfEQyXDY1g7wG3t3Ch+g=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    },
    '@deepseek-ai/dsh-api-workspace-controller': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-95USICv+Ds+BS4Bjf27gVneXc/ZuhlYvTsdfjx/S+MMSutjgV2eZDKkQOxVn8u8KMZw3FG0X5Era47qa3kg01Q==',
        '0.2.0-rc.1':
          'sha512-ufdQT5WCoHC2eQNBMX/aMtv8FgKdQs6kIdSQaBRZ+olYgfC9WKh4LeUG96KZFXp1KMvMpgdWgarANHcd6Gwviw=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    },
    '@deepseek-ai/dsh-web': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-3qt/Fh+uCghOy2wZPjwQ6xIMU3t1NW4D5yRvTXOyvadwaDwosqXOzCteYUhnuWzWN66adrFLeRrymhSDS4PMeg==',
        '0.2.0-rc.1':
          'sha512-tqCgrF1/vrBxmsn3pWTob9n+/Es1rNlzIuDJu1NAc4XvZz9uzuJlspwEHnG+cqvJsBSKVoEotLC7h4LDUldJoA=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    },
    '@deepseek-ai/dsh-jobs': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-C3rBEuWhtDBlxMeKykFvSfBwjSPxkLsvKCFq8BrFdjDmZC1lI9GooMjPZkPxXVbogVrcOBaYVtJdOYJ4+rIpQg==',
        '0.2.0-rc.1':
          'sha512-ewueg51ZSEF+/sLXEhi5ySqFu2egKWI4koBwBciE2sAaOwBY2Ou9BqYUHFN1wGRaUYVZ/DrMpn18c0XBC37j0A=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    },
    '@deepseek-ai/dsh-agent': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-SlUL1riZmVLwMUR3jo9CP/R1cxov9dHkCJDh6JQW3fSZJVCIdPygBRlAweCUDvHxAEmPpFHxE/U3NmSUbX+vQQ==',
        '0.2.0-rc.1':
          'sha512-PQ4Qtu7QiI6j2n730p8RJ+u4l7ywwhVJ4NeIe/Tj86hBYYZNvNT8iMhViECn+GSepAk7GmM/1eb7e7hvmYhsKA=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    },
    '@deepseek-ai/dsh-system-prompt': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-VtmZVKqBMJ7kzskHu0jY+Jth7jSuKMG8QB3MBPzJe9M0LL4YPMWsGKt9gGky9RXolk/ugAy4YZEv1gUqouVofA==',
        '0.2.0-rc.1':
          'sha512-AZC0HBWaiopkVcJXh/WEzyyF19+/yBPnbuLrZoD7h+UJYF8iG8tlDabauWfMw+dvgoYe9hIiTV2EcFRv4AgJhw=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    },
    '@deepseek-ai/dsh-tools': {
      integrity: {
        '0.1.5-rc.2':
          'sha512-k2yZuJJtszaU9lzr2aBtdeFMINrkdlk4ellbtrMokA2oySVqJmAM8dv+u9RtzduD3aRRqyr2i2hWrTACz0qOrA==',
        '0.2.0-rc.1':
          'sha512-HmXY+X4HBoeuGBJWkS+q91GEGK61XgNc3qCXT+QqI+nzCcg1VOIwWvjgOnr1c76x5HKPyxR7FF3PMMq3+hO7oQ=='
      },
      files: ['package.json', 'LICENSE', 'lib/types/index.d.ts']
    }
  },
  /** Host service names injected by plugins (ctx.inject / ctx.<service>) and their contract packages. */
  services: {
    connection: ['@deepseek-ai/dsh-client-connection'],
    webServer: ['@deepseek-ai/dsh-host-webserver', '@deepseek-ai/dsh-client-connection'],
    slots: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-slots'],
    layout: ['@deepseek-ai/dsh-client-ui-layout'],
    sidebar: ['@deepseek-ai/dsh-client-ui-sidebar'],
    // util-workspace-path defines the dsh-resource://file/ grammar that openResourceIn receives.
    sidebarRight: ['@deepseek-ai/dsh-client-ui-sidebar-right', '@deepseek-ai/dsh-util-workspace-path'],
    sidebarRightTabs: [
      '@deepseek-ai/dsh-client-ui-sidebar-right',
      '@deepseek-ai/dsh-client-ui-sidebar-files'
    ],
    // ui-session declares the `mainView` retention source the Session list is read through.
    sessions: [
      '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-api-session-controller',
      '@deepseek-ai/dsh-client-ui-session'
    ],
    sessionController: ['@deepseek-ai/dsh-api-session-controller'],
    sessionPersistence: ['@deepseek-ai/dsh-session-persistence'],
    conversation: ['@deepseek-ai/dsh-client-ui-conversation'],
    workspaceController: ['@deepseek-ai/dsh-api-workspace-controller'],
    uiWorkspace: ['@deepseek-ai/dsh-client-ui-workspace'],
    web: ['@deepseek-ai/dsh-web'],
    jobs: ['@deepseek-ai/dsh-jobs'],
    agents: ['@deepseek-ai/dsh-agent'],
    systemPrompt: ['@deepseek-ai/dsh-system-prompt'],
    tools: ['@deepseek-ai/dsh-tools'],
    settings: ['@deepseek-ai/dsh-client-ui-settings'],
    locale: ['@deepseek-ai/dsh-client-locale']
  },
  /** A package manifest declaring a DSH bundle/client entry depends on the loader contracts. */
  manifest: ['@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-app-boot']
})

const LIMITS = Object.freeze({ tarball: 8 * 1024 * 1024, unpacked: 64 * 1024 * 1024, file: 64 * 1024 })

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item)
    Object.freeze(value)
  }
  return value
}
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export const upstreamLockDigest = (lock = UPSTREAM_LOCK) => sha256(canonical(lock))
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    )
  return JSON.stringify(value)
}

/** Derived, never supplied: registry + exact scoped name + exact semver. */
export function tarballUrl(name, version, registry = UPSTREAM_LOCK.registry) {
  const match = /^@([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9._-]*)$/.exec(name)
  if (
    !match ||
    registry !== 'https://registry.npmjs.org' ||
    typeof version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/.test(version)
  )
    throw new Error(`Invalid upstream package identity ${JSON.stringify(name + '@' + version)}`)
  return `${registry}/@${match[1]}/${match[2]}/-/${match[2]}-${version}.tgz`
}

export function verifySri(bytes, integrity) {
  const match = /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(integrity ?? '')
  if (!match) throw new Error('Upstream integrity must be a single sha512 SRI')
  if (createHash('sha512').update(bytes).digest('base64') !== match[1])
    throw new Error('Upstream tarball SRI mismatch')
}

/** Minimal ustar/pax reader: regular files only; links, devices, traversal and duplicates fail. */
export function readTarball(buffer) {
  const files = new Map()
  let offset = 0,
    paxPath = null,
    total = 0
  const field = (block, start, length) =>
    block
      .subarray(start, start + length)
      .toString('utf8')
      .replace(/\0[\s\S]*$/, '')
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    let sum = 0
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i]
    const declared = parseInt(field(header, 148, 8).trim(), 8)
    const sizeText = field(header, 124, 12).trim()
    if (declared !== sum || !/^[0-7]+$/.test(sizeText)) throw new Error('Malformed upstream tar header')
    const size = parseInt(sizeText, 8),
      type = header[156] === 0 ? '0' : String.fromCharCode(header[156])
    if (offset + 512 + size > buffer.length) throw new Error('Truncated upstream tar entry')
    const prefix = field(header, 345, 155),
      name = paxPath ?? (prefix ? prefix + '/' + field(header, 0, 100) : field(header, 0, 100))
    const body = buffer.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    if (type === 'x') {
      paxPath = null
      for (const record of body.toString('utf8').split('\n')) {
        const match = /^\d+ path=(.*)$/.exec(record)
        if (match) paxPath = match[1]
      }
      continue
    }
    paxPath = null
    if (type === 'g' || type === '5') continue
    if (type !== '0')
      throw new Error(`Upstream tarball contains a non-regular entry: ${JSON.stringify(name)}`)
    const parts = name.split('/')
    if (
      parts[0] !== 'package' ||
      parts.length < 2 ||
      name.includes('\\') ||
      name.includes('\0') ||
      parts.slice(1).some((part) => !part || part === '.' || part === '..')
    )
      throw new Error(`Unsafe upstream tar path ${JSON.stringify(name)}`)
    const path = parts.slice(1).join('/')
    if (files.has(path)) throw new Error(`Duplicate upstream tar entry ${JSON.stringify(path)}`)
    total += size
    if (total > LIMITS.unpacked) throw new Error('Upstream tarball exceeds unpacked limit')
    files.set(path, Buffer.from(body))
  }
  return files
}

function decode(bytes, label) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  if (text.includes('\0')) throw new Error(`Upstream contract is not text: ${label}`)
  return text
}

/** Project one verified tarball into labelled contract text. Pure: bytes in, projection out. */
export function projectTarball(name, version, integrity, bytes, pin) {
  if (bytes.length > LIMITS.tarball) throw new Error('Upstream tarball exceeds size limit')
  verifySri(bytes, integrity)
  const entries = readTarball(gunzipSync(bytes, { maxOutputLength: LIMITS.unpacked }))
  const manifest = JSON.parse(decode(entries.get('package.json') ?? Buffer.alloc(0), name + '/package.json'))
  if (manifest.name !== name || manifest.version !== version)
    throw new Error(`Upstream tarball identity mismatch for ${name}@${version}`)
  const files = []
  const add = (path, text, extra = {}) => {
    if (text.length > LIMITS.file) throw new Error(`Upstream contract ${name}/${path} exceeds per-file limit`)
    files.push({ path, sha256: sha256(entries.get(path)), bytes: entries.get(path).length, ...extra, text })
  }
  for (const path of pin.files) {
    if (!entries.has(path)) throw new Error(`Pinned upstream contract is missing: ${name}@${version}/${path}`)
    add(path, decode(entries.get(path), path))
  }
  for (const slice of pin.slices ?? []) {
    if (!entries.has(slice.file))
      throw new Error(`Pinned upstream contract is missing: ${name}@${version}/${slice.file}`)
    const lines = decode(entries.get(slice.file), slice.file).split('\n')
    const hits = lines.flatMap((line, index) => (line.includes(slice.anchor) ? [index] : []))
    if (hits.length !== 1)
      throw new Error(`Upstream slice anchor must match exactly once: ${name}@${version}/${slice.file}`)
    const from = Math.max(0, hits[0] - slice.before),
      to = Math.min(lines.length, hits[0] + slice.after + 1)
    add(slice.file, lines.slice(from, to).join('\n'), {
      slice: { fromLine: from + 1, toLine: to, anchor: slice.anchor }
    })
  }
  return {
    name,
    version,
    tarball: tarballUrl(name, version),
    integrity,
    license: typeof manifest.license === 'string' ? manifest.license : null,
    files
  }
}

function privateRegularFile(path) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    throw new Error('Upstream cache entry is not a private regular file')
}

/**
 * Read a response body, aborting as soon as it exceeds `limit` bytes. The declared length is
 * checked first, but a chunked or understated response is still bounded while it is read.
 */
export async function boundedBody(response, limit) {
  const tooLarge = () => new Error('Upstream tarball exceeds size limit')
  if (Number(response.headers?.get?.('content-length') ?? 0) > limit) throw tooLarge()
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > limit) throw tooLarge()
    return bytes
  }
  const reader = response.body.getReader(),
    chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => {})
      throw tooLarge()
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, size)
}

/** Download or reuse a cached tarball. The cache is re-verified on every read and never trusted by name. */
export async function fetchTarball(name, version, integrity, options = {}) {
  const { cacheDirectory, fetch: fetcher = globalThis.fetch, timeoutMs = 60000 } = options
  if (!cacheDirectory) throw new Error('Upstream cache directory is required')
  mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 })
  const file = join(cacheDirectory, sha256(integrity) + '.tgz')
  if (existsSync(file)) {
    privateRegularFile(file)
    const bytes = readFileSync(file)
    try {
      verifySri(bytes, integrity)
      return bytes
    } catch {
      // A damaged cache is quarantined and replaced, never used.
      renameSync(file, file + '.corrupt-' + randomUUID())
    }
  }
  if (options.offline) throw new Error(`Upstream contract is not cached: ${name}@${version}`)
  const response = await fetcher(tarballUrl(name, version), {
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/octet-stream' }
  })
  if (!response.ok) throw new Error(`Registry returned ${response.status} for ${name}@${version}`)
  const bytes = await boundedBody(response, LIMITS.tarball)
  verifySri(bytes, integrity)
  const temporary = file + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600, flush: true })
    renameSync(temporary, file)
  } finally {
    try {
      unlinkSync(temporary)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return bytes
}

/** Build the complete verified catalog for every pinned host. Any failure aborts the review. */
export async function loadUpstreamCatalog(options = {}, lock = UPSTREAM_LOCK) {
  if (lock.schemaVersion !== 1 || lock.registry !== 'https://registry.npmjs.org')
    throw new Error('Untrusted upstream contract lock')
  const hosts = new Map()
  for (const host of lock.hosts) {
    const packages = new Map()
    for (const [name, pin] of Object.entries(lock.packages)) {
      const integrity = pin.integrity?.[host]
      if (!integrity) throw new Error(`Upstream contract ${name} is not pinned for host ${host}`)
      const bytes = await fetchTarball(name, host, integrity, options)
      packages.set(name, projectTarball(name, host, integrity, bytes, pin))
    }
    hosts.set(host, packages)
  }
  return { lockDigest: upstreamLockDigest(lock), services: lock.services, manifest: lock.manifest, hosts }
}

/** Host versions declared anywhere in the candidate product contract must all be pinned. */
export function requirePinnedHosts(catalog, productText) {
  // Without a product contract no host can be proven pinned; that is not "all pinned".
  if (productText === undefined || productText === null)
    throw new Error('Candidate product contract config/products.json is missing')
  let value
  try {
    value = JSON.parse(productText)
  } catch {
    throw new Error('Candidate product contract is not valid JSON')
  }
  const versions = new Set(),
    stack = [value]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    for (const [key, item] of Object.entries(node)) {
      if (key === 'hostVersion' && typeof item === 'string') versions.add(item)
      else if (key === 'hostVersions' && Array.isArray(item))
        for (const version of item) if (typeof version === 'string') versions.add(version)
      if (item && typeof item === 'object') stack.push(item)
    }
  }
  if (!versions.size) throw new Error('Candidate product contract declares no host version')
  for (const version of versions)
    if (!catalog.hosts.has(version))
      throw new Error(`Upstream DSH contract is not pinned for declared host ${JSON.stringify(version)}`)
  return [...versions].sort()
}
