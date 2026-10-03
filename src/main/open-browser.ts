/** Open the owned Host's native login URL; the Host exchanges its token for a browser cookie. */
export async function openDesktopInBrowser(
  hostUrl: string | undefined,
  openExternal: (url: string) => Promise<unknown>
): Promise<void> {
  if (!hostUrl) throw new Error('Desktop service is not ready')
  let url: URL
  try {
    url = new URL(hostUrl)
  } catch {
    throw new Error('Desktop service address is unavailable')
  }
  // This entry only opens the local service owned by Desktop, never a renderer-supplied address.
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.hash ||
    [...url.searchParams.keys()].length !== 1 ||
    !url.searchParams.get('token')
  )
    throw new Error('Desktop service address is unavailable')
  // Do not include the authentication URL in logs or surface an OS error that might echo it.
  try {
    await openExternal(url.href)
  } catch {
    throw new Error('Could not open the default browser')
  }
}
