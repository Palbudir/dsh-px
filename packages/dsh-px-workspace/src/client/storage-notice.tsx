import { useState } from 'react'
import { base, post, useData, useOperation, errorText } from './data'
interface StorageStatus {
  ready: boolean
  error?: string
  revision: string
  snapshots: { id: string; createdAt: number; annotations: number; schedules: number }[]
}
export function StorageNotice({
  visible,
  onRestored
}: {
  visible: boolean
  onRestored: () => void
}): unknown {
  const status = useData<StorageStatus>(`${base}/storage`, visible)
  const [selected, setSelected] = useState<string | null>(null)
  const [failure, setFailure] = useState('')
  const [busy, run] = useOperation('storage:restore')
  if (!status.data || status.data.ready) return null
  return (
    <section className="px-card" role="alert">
      <h4>批注与定时存储需要恢复</h4>
      <p>{status.data.error} 会话正文与产物仍可查看。</p>
      {failure ? <p>{failure}</p> : null}
      {status.data.snapshots.length ? (
        <>
          <p>恢复会保留当前损坏文件，并暂停全部定时任务；核对后再启用。</p>
          {status.data.snapshots.map((snapshot) => (
            <div className="px-actions" key={snapshot.id}>
              <span>
                {new Date(snapshot.createdAt).toLocaleString()} · {snapshot.annotations} 条批注 ·{' '}
                {snapshot.schedules} 个任务
              </span>
              <button disabled={busy} onClick={() => setSelected(snapshot.id)}>
                选择此快照
              </button>
            </div>
          ))}
          {selected ? (
            <div className="px-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setFailure('')
                    try {
                      await post('storage', {
                        action: 'restore',
                        snapshotId: selected,
                        revision: status.data!.revision
                      })
                      setSelected(null)
                      status.refresh()
                      onRestored()
                    } catch (err) {
                      setFailure(errorText(err))
                    }
                  })
                }
              >
                {busy ? '恢复中…' : '确认恢复所选快照'}
              </button>
              <button disabled={busy} onClick={() => setSelected(null)}>
                取消
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p>没有可恢复快照，请从数据目录备份恢复；不会以空数据覆盖当前文件。</p>
      )}
    </section>
  )
}
