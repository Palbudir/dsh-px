/** State transitions only. Never pass prompts, quotes, keys or full request bodies. */
export function diagnostic(event: string, fields: Record<string, string | number | boolean | null>): void {
  console.info(`[dsh-px-event] ${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}`)
}
