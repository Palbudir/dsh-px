import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs'

/** Keep a bounded desktop diagnostic log; this never touches session history. */
export function createRotatingLog(path: string, maxBytes = 5 * 1024 * 1024, retained = 3) {
  let size = existsSync(path) ? statSync(path).size : 0
  return {
    write(text: string): void {
      const bytes = Buffer.byteLength(text)
      if (size && size + bytes > maxBytes) {
        if (existsSync(`${path}.${retained}`)) unlinkSync(`${path}.${retained}`)
        for (let n = retained - 1; n >= 1; n--)
          if (existsSync(`${path}.${n}`)) renameSync(`${path}.${n}`, `${path}.${n + 1}`)
        if (existsSync(path)) renameSync(path, `${path}.1`)
        size = 0
      }
      // Avoid one abnormal producer entry bypassing the retention limit.
      const value = bytes > maxBytes ? Buffer.from(text).subarray(-maxBytes).toString('utf8') : text
      appendFileSync(path, value, { mode: 0o600 })
      size += Buffer.byteLength(value)
    }
  }
}
