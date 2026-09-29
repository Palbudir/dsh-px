export interface SecretFinding {
  path: string
  line: number
  rule: string
}
export declare const RULES: [string, RegExp][]
/** Scan one text blob; findings never include the matched value. */
export declare function scanText(path: string, text: string): SecretFinding[]
/** Scan tracked + untracked-not-ignored files, or only files changed in a git range. */
export declare function scanRepository(range?: string): SecretFinding[]
