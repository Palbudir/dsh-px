import { useEffect, useState } from 'react'
import type { MemorySourcePageProps } from 'dsh-mnemon/client'
import { skillAnchorName } from './workspace-navigation'
import { mountMnemonSkillPage } from './mnemon-skill-slot'

function SkillPageRoute({
  source,
  Native,
  open
}: {
  source: MemorySourcePageProps
  Native: any
  open: (sessionId: string, name: string) => boolean
}) {
  const input = source.navigationInput as { seed?: unknown } | undefined
  const name = skillAnchorName(
    { page: 'skills/library', seed: input?.seed, sessionId: source.sessionId },
    source.sessionId
  )
  const [waiting, setWaiting] = useState(false)
  useEffect(() => {
    if (name && source.sessionId) setWaiting(!open(source.sessionId, name))
  }, [source.sessionId, source.navigationInput, name])
  if (!name || !source.sessionId) return <Native {...source} />
  return (
    <p role="status">
      {waiting ? '请先打开来源会话，再查看该会话实际使用的技能。' : '正在打开本会话的技能…'}
    </p>
  )
}

/** Let Mnemon consume its own pending anchor, then resolve named skills through the native Agent scope.
 * Its filesystem-only manager otherwise opens a same-name shared file instead of a persona-private provider.
 * Non-name targets (reviews, evaluations and general browsing) retain the community component and capability.
 */
export function registerMnemonSkillNavigation(host: any, open: (sessionId: string, name: string) => boolean) {
  return mountMnemonSkillPage(host, (Native) => (source: MemorySourcePageProps) => (
    <SkillPageRoute source={source} Native={Native} open={open} />
  ))
}
