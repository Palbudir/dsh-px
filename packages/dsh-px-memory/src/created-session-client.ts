/** Reconcile a successful PX creation receipt before the native view retains its address. No Host creation RPC is repeated. */
export async function catalogueCreatedSession(sessions: any, id: string): Promise<void> {
  if (typeof id !== 'string' || !id.trim() || id.length > 200 || /[\r\n\0]/.test(id))
    throw new Error('服务未返回有效会话编号')
  if (sessions.pxPersonaTransportVersion === 1) {
    await sessions.create({}, async () => ({ ok: true, value: { sessionId: id } }))
    return
  }
  // A first refresh can join a pull begun before creation; one following pull gets a fresh native baseline.
  const known = () => Object.hasOwn(sessions.list.getSnapshot().byId, id)
  for (let attempt = 0; attempt < 2 && !known(); attempt++) await sessions.refresh()
  if (!known()) throw new Error('会话已创建，但原生目录尚未显示它；请刷新目录后打开，未重复创建。')
}
