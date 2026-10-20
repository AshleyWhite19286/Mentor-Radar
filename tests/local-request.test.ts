import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localRequest } from '../lib/local-request';

function request(host: string, origin?: string) {
  return new Request('http://localhost:3000/api/connection', {
    headers: { host, ...(origin === undefined ? {} : { origin }) },
  });
}

test('Next.js规范化URL后仍接受浏览器的本机同源请求', () => {
  for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000']) {
    assert.doesNotThrow(() => localRequest(request(host, `http://${host}`)));
  }
});

test('拒绝外部来源、不同端口、不同协议与不同主机', () => {
  for (const origin of ['https://example.com', 'null', 'http://127.0.0.1:3001', 'https://127.0.0.1:3000', 'http://localhost:3000']) {
    assert.throws(() => localRequest(request('127.0.0.1:3000', origin)), /请求来源不匹配/);
  }
});

test('Host和请求URL必须是本机地址，不信任转发头', () => {
  for (const host of ['example.com:3000', 'localhost.example.com:3000', '192.168.1.1:3000', 'localhost:3000@evil.com', 'localhost:3000/path']) {
    assert.throws(() => localRequest(request(host)), /此版本仅支持本机访问/);
  }
  assert.throws(() => localRequest(new Request('http://example.com/api/connection', {
    headers: { host: 'localhost:3000' },
  })), /此版本仅支持本机访问/);
  assert.throws(() => localRequest(new Request('http://localhost:3000/api/connection', {
    headers: { host: 'localhost:3000', origin: 'https://example.com', 'x-forwarded-host': 'example.com' },
  })), /请求来源不匹配/);
});

test('支持无Origin的本机命令行请求及无Host的标准Request', () => {
  assert.doesNotThrow(() => localRequest(request('127.0.0.1:3000')));
  assert.doesNotThrow(() => localRequest(new Request('http://localhost:3000/api/catalog')));
});

function withPublicOrigin(env: Record<string, string>, work: () => void) {
  const keys = ['RADAR_PUBLIC_ORIGIN', 'RENDER_EXTERNAL_URL'];
  const before = keys.map(key => process.env[key]);
  try {
    for (const key of keys) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    work();
  } finally {
    keys.forEach((key, index) => {
      if (before[index] === undefined) delete process.env[key];
      else process.env[key] = before[index];
    });
  }
}

test('Render公网域名支持目录读取和HTTPS同源提交，包括代理后的HTTP请求', () => {
  withPublicOrigin({ RENDER_EXTERNAL_URL: 'https://mentor-radar.onrender.com' }, () => {
    for (const backend of ['http://mentor-radar.onrender.com', 'http://localhost:10000', 'http://0.0.0.0:10000', 'https://mentor-radar.onrender.com']) {
      for (const origin of [undefined, 'https://mentor-radar.onrender.com']) {
        assert.doesNotThrow(() => localRequest(new Request(`${backend}/api/connection`, {
          headers: { host: 'mentor-radar.onrender.com', ...(origin ? { origin } : {}) },
        })));
      }
    }
    assert.doesNotThrow(() => localRequest(request('127.0.0.1:3000', 'http://127.0.0.1:3000')));
    assert.doesNotThrow(() => localRequest(new Request('http://0.0.0.0:10000/api/catalog', {
      headers: { host: '127.0.0.1:10000', origin: 'http://127.0.0.1:10000' },
    })));
  });
});

test('公网模式拒绝跨站提交、其他Host及伪造的转发头', () => {
  withPublicOrigin({ RENDER_EXTERNAL_URL: 'https://mentor-radar.onrender.com' }, () => {
    for (const origin of ['https://evil.com', 'null', 'http://mentor-radar.onrender.com', 'https://mentor-radar.onrender.com:444']) {
      assert.throws(() => localRequest(request('mentor-radar.onrender.com', origin)), /请求来源不匹配/);
    }
    assert.throws(() => localRequest(new Request('http://evil.com/api/catalog', {
      headers: { host: 'mentor-radar.onrender.com' },
    })));
    assert.throws(() => localRequest(new Request('http://localhost:10000/api/catalog', {
      headers: { host: 'evil.com', 'x-forwarded-host': 'mentor-radar.onrender.com', 'x-forwarded-proto': 'https' },
    })));
  });
});

test('自定义域名优先于Render默认域名，并拒绝无效公网配置', () => {
  withPublicOrigin({ RADAR_PUBLIC_ORIGIN: 'https://radar.example.edu', RENDER_EXTERNAL_URL: 'https://mentor-radar.onrender.com' }, () => {
    assert.doesNotThrow(() => localRequest(request('radar.example.edu', 'https://radar.example.edu')));
    assert.throws(() => localRequest(request('mentor-radar.onrender.com')));
  });
  for (const value of ['http://radar.example.edu', 'https://user:pass@radar.example.edu', 'https://radar.example.edu/path', 'https://radar.example.edu?key=value', 'invalid']) {
    withPublicOrigin({ RADAR_PUBLIC_ORIGIN: value }, () => {
      assert.throws(() => localRequest(request('radar.example.edu')));
    });
  }
});
