import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { structured } from '../lib/model';
import type { Source } from '../lib/types';

const settings={baseUrl:'https://8.8.8.8/api/v1',apiKey:'test-only',model:'fixture'};
const source:Source={id:'source-actual-paper',title:'测试论文',url:'https://example.com/paper',kind:'paper',retrievedAt:'2026-10-20'};
const schema=z.object({recommendations:z.array(z.object({reason:z.string(),citations:z.array(z.string()).min(1)}))});

test('嵌套引用填错时提供具体编号及来源对照，模型更正后才返回',async t => {
  let calls=0;
  t.mock.method(globalThis,'fetch',async (_url:URL,init:RequestInit) => {
    const {messages}=JSON.parse(init.body as string);
    calls++;
    const initial=messages[1].content;
    assert.ok(initial.includes(JSON.stringify({sourceId:source.id,title:source.title,url:source.url})));
    assert.ok(initial.includes('论文ID'));
    if(calls===2){
      const repair=messages.at(-1).content;
      assert.ok(repair.includes('paper-wrong-id'));
      assert.ok(repair.includes(source.id));
      assert.ok(repair.includes('重新核对正文与资料的对应关系'));
    }
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({recommendations:[{reason:'基于摘要',citations:[calls===1?'paper-wrong-id':source.id]}]})}}]}));
  });
  const result=await structured(settings,'根据论文给出建议',schema,[source]);
  assert.equal(calls,2);
  assert.deepEqual(result.recommendations[0].citations,[source.id]);
});

test('两次都引用未知来源时仍拦截，不删除或替换为已有来源',async t => {
  let calls=0;
  t.mock.method(globalThis,'fetch',async () => {
    calls++;
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({recommendations:[{reason:'没有支持的说法',citations:['invented-source']}]})}}]}));
  });
  await assert.rejects(() => structured(settings,'回答问题',schema,[source]),/引用编号未能对应.*自动修正后仍未通过/);
  assert.equal(calls,2);
});
