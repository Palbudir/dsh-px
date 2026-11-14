/** Follow native registration and settlement, not a status string in a tool's rendered prose. */
export async function nativeJobEvidence(
  reader: any,
  owner: string,
  beforeSeq: number,
  jobId: unknown,
  candidates: readonly number[] = [],
  signal?: AbortSignal
) {
  if (typeof jobId !== 'string' || !jobId || jobId.length > 200 || /[\r\n\0]/.test(jobId)) return
  let registered: any, settled: any
  const observe = (event: any) => {
    if (!event || event.seq > beforeSeq || event.data?.jobId !== jobId || event.data.owner !== owner) return
    if (event.type === 'job/registered' && (!registered || event.seq > registered.seq)) registered = event
    if (event.type === 'job/settled' && (!settled || event.seq > settled.seq)) settled = event
  }
  for (const seq of candidates.slice(0, 32)) {
    signal?.throwIfAborted()
    if (Number.isSafeInteger(seq) && seq >= 0 && seq <= beforeSeq)
      observe((await reader.read(seq, 1, { signal })).events[0])
  }
  // Cache positions are only hints. Re-read authoritative events; without both receipts remain unverified.
  for (let cursor = beforeSeq, pages = 0; (!registered || !settled) && cursor >= 0 && pages < 64; pages++) {
    signal?.throwIfAborted()
    const start = Math.max(0, cursor - 255)
    for (const event of (await reader.read(start, cursor - start + 1, { signal })).events) observe(event)
    cursor = start - 1
  }
  if (
    !registered ||
    !settled ||
    registered.seq >= settled.seq ||
    !Number.isSafeInteger(registered.data.startedAt) ||
    registered.data.startedAt < 0 ||
    !Number.isSafeInteger(settled.data.finishedAt) ||
    settled.data.finishedAt < registered.data.startedAt ||
    registered.data.startedAt !== settled.data.startedAt ||
    !['bash', 'pwsh'].includes(registered.data.kind) ||
    settled.data.kind !== registered.data.kind ||
    !['completed', 'failed', 'killed'].includes(settled.data.status) ||
    settled.data.producerReported !== true
  )
    return
  // Native shell producers use completed even for a nonzero process exit.
  // Only the pinned producer's exact successful detail proves command success.
  const detail = typeof settled.data.detail === 'string' ? settled.data.detail : ''
  const exit = /^exit code: (-?\d+)(?:; (.*))?$/.exec(detail)
  const exitCode = exit && Number.isSafeInteger(Number(exit[1])) ? Number(exit[1]) : undefined
  const outcome =
    settled.data.status !== 'completed' ||
    (exitCode !== undefined && exitCode !== 0) ||
    (exit && exit[2]?.includes('[sandbox:'))
      ? 'failure'
      : exitCode === 0 && exit?.[2] === undefined
        ? 'success'
        : 'unknown'
  return {
    jobId,
    owner,
    kind: registered.data.kind as 'bash' | 'pwsh',
    status: settled.data.status as string,
    outcome,
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(detail ? { detail: detail.slice(0, 1000) } : {}),
    registrationSeq: registered.seq as number,
    settlementSeq: settled.seq as number,
    source: 'native-job-events' as const
  }
}
