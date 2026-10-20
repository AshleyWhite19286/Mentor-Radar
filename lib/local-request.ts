export function localRequest(req: Request) {
  const url = new URL(req.url);
  const isLoopback = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  if (!isLoopback(url.hostname)) throw new Error('此版本仅支持本机访问');

  // NextURL normalizes loopback IPs to localhost. Host retains the address
  // used by the browser; validate it before using it for the origin check.
  const host = req.headers.get('host') ?? url.host;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) {
    throw new Error('此版本仅支持本机访问');
  }
  const expected = new URL(`${url.protocol}//${host}`);
  const origin = req.headers.get('origin');
  if (origin && origin !== expected.origin) throw new Error('请求来源不匹配');
}
