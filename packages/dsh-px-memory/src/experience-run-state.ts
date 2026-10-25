/** A stored running record from an earlier Host is not evidence of a live PX job. */
export function experienceRunView<T extends { status: string; startedAt: string }>(
  run: T,
  serviceStartedAt: number
) {
  const started = Date.parse(run.startedAt)
  return {
    ...run,
    awaitingRecovery: run.status === 'running' && (!Number.isFinite(started) || started < serviceStartedAt)
  }
}
