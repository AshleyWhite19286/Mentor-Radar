import { test } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { modelFetch,publicFetch } from '../lib/network';
import { modelRequest } from '../lib/model';

test('学校模型支持内网和代理DNS映射，普通网页抓取仍拒绝', async t => {
  t.mock.method(dns,'lookup',async () => [{address:'198.18.3.220',family:4}]);
  const calls:string[]=[];
  t.mock.method(globalThis,'fetch',async (url:URL,init:RequestInit) => {
    calls.push(url.href);
    assert.equal(init.redirect,'manual');
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer test-only');
    return new Response(JSON.stringify({choices:[{message:{content:'连接成功'}}],data:[{id:'deepseek-chat'}]}));
  });
  const base='https://models.sjtu.edu.cn/api/v1';
  await assert.rejects(() => publicFetch(`${base}/models`),/不支持访问本机或内网地址/);
  const models=await (await modelFetch(`${base}/models`,{headers:{Authorization:'Bearer test-only'}})).json();
  assert.equal(models.data[0].id,'deepseek-chat');
  assert.equal(await modelRequest({baseUrl:base,apiKey:'test-only',model:'deepseek-chat'},[{role:'user',content:'测试'}]),'连接成功');
  assert.deepEqual(calls,[`${base}/models`,`${base}/chat/completions`]);
});

test('学校例外不放行其他域名、端口、路径、凭证或内网IP', async t => {
  t.mock.method(dns,'lookup',async () => [{address:'10.0.0.1',family:4}]);
  t.mock.method(globalThis,'fetch',async () => {throw new Error('不应发出请求');});
  for (const url of [
    'https://models.sjtu.edu.cn.evil.com/api/v1/models',
    'https://other.sjtu.edu.cn/api/v1/models',
    'https://models.sjtu.edu.cn:8443/api/v1/models',
    'https://models.sjtu.edu.cn/admin',
    'https://models.sjtu.edu.cn/api/v1/models?url=http://localhost',
    'https://user:pass@models.sjtu.edu.cn/api/v1/models',
    'https://127.0.0.1/api/v1/models',
    'https://10.0.0.1/api/v1/models',
    'https://198.18.3.220/api/v1/models',
  ]) await assert.rejects(() => modelFetch(url),/仅支持公开|不支持访问本机或内网地址/);
  await assert.rejects(() => modelFetch('http://models.sjtu.edu.cn/api/v1/models'),/必须使用HTTPS/);
});

test('学校模型重定向不会继续发送Key', async t => {
  let calls=0;
  t.mock.method(globalThis,'fetch',async () => {
    calls++;
    return new Response(null,{status:302,headers:{location:'http://127.0.0.1/secret'}});
  });
  await assert.rejects(() => modelFetch('https://models.sjtu.edu.cn/api/v1/models',{
    headers:new Headers({Authorization:'Bearer test-only'}),
  }),/模型接口发生重定向/);
  assert.equal(calls,1);
});
