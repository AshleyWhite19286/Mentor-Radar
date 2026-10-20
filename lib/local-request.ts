export function localRequest(req: Request) {
  const url = new URL(req.url);
  const isLoopback = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  // next start uses its bind address in Request.url, including 0.0.0.0.
  // The actual browser host must still match an allowed Host below.
  const isServerAddress = isLoopback(url.hostname) || url.hostname === '0.0.0.0';
  const publicUrl = process.env.RADAR_PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL;
  const host = req.headers.get('host') ?? url.host;
  if (publicUrl) {
    const expected = new URL(publicUrl);
    if (expected.protocol !== 'https:' || expected.username || expected.password || expected.pathname !== '/' || expected.search || expected.hash) {
      throw new Error('公网地址必须是HTTPS网站源地址');
    }
    // Render terminates HTTPS before forwarding HTTP to Next.js. Compare the
    // browser Origin with the configured public URL, never with forwarded headers.
    if (host === expected.host && (url.host === expected.host || isServerAddress)) {
      const origin = req.headers.get('origin');
      if (origin && origin !== expected.origin) throw new Error('请求来源不匹配');
      return;
    }
  }
  if (!isServerAddress) throw new Error('此版本仅支持本机访问');

  // NextURL normalizes loopback IPs to localhost. Host retains the address
  // used by the browser; validate it before using it for the origin check.
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) {
    throw new Error('此版本仅支持本机访问');
  }
  const expected = new URL(`${url.protocol}//${host}`);
  const origin = req.headers.get('origin');
  if (origin && origin !== expected.origin) throw new Error('请求来源不匹配');
}
