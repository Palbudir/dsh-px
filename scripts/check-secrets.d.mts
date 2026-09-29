export interface SecretFinding {
  path: string
  line: number
  rule: string
}
/** [rule id, pattern, capture group holding the value checked against the placeholder convention]. */
export type SecretRule = [string, RegExp, number?]
export declare const RULES: SecretRule[]
/** Scan one text blob; findings never include the matched value. */
export declare function scanText(path: string, text: string, rules?: SecretRule[]): SecretFinding[]
/** Scan tracked + untracked-not-ignored files, or only files changed in a git range. */
export declare function scanRepository(range?: string): SecretFinding[]
