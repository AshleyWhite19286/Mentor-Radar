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
