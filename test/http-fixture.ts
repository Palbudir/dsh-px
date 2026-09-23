/** Real HTTP requests always carry an authority; unit mocks must model it too. */
export function localHandler (handler: (req: any, res: any) => unknown): (req: any, res: any) => any {
  return (req, res) => {
    req.headers = { host: '127.0.0.1', ...req.headers }
    return handler(req, res)
  }
}
