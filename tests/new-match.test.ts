import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyProfile, hasProfile, readingDelta, readVisits, sampleMentors } from '../lib/new-match';
import { newMatch, newMatchPlan } from '../lib/new-match-agent';
import type { Catalog } from '../lib/types';

const data = JSON.parse(readFileSync('data/seed.json', 'utf8')) as Catalog;
const mentors = data.mentors.filter(m => m.role === '导师');
const settings = { baseUrl: 'https://8.8.8.8/v1', model: 'fixture', apiKey: 'test-only' };
const response = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
const recommendation = (index: number) => ({ mentorId: mentors[index].id, reason: '研究方向与当前问题相关', readiness: '资料不足', gaps: [], citations: [mentors[index].source.id] });

test('空白画像保持未知；随机窗口最多16位且不含平台人员与重复教师', () => {
  assert.equal(hasProfile(emptyProfile), false);
  assert.equal(hasProfile({ ...emptyProfile, courses: '线性代数' }), true);
  const ids = sampleMentors([...data.mentors, mentors[0]], () => 0.3);
  assert.equal(ids.length, 16); assert.equal(new Set(ids).size, 16);
  assert.ok(ids.every(id => mentors.some(m => m.id === id)));
  assert.equal(sampleMentors(mentors.slice(0, 2)).length, 2);
});
test('有效阅读排除后台时间、闲置60秒后的时间和时钟倒退', () => {
  assert.equal(readingDelta(1000, 5000, 1000, true), 4000);
  assert.equal(readingDelta(1000, 90000, 1000, true), 60000);
  assert.equal(readingDelta(70000, 90000, 1000, true), 0);
  assert.equal(readingDelta(1000, 5000, 1000, false), 0);
  assert.equal(readingDelta(5000, 1000, 1000, true), 0);
  assert.deepEqual(readVisits({ valid: { clicks: 2, milliseconds: 500 }, corrupt: { clicks: -1, milliseconds: 0 }, invalid: null }), { valid: { clicks: 2, milliseconds: 500 } });
});
test('每轮召回可读取全部导师，空白背景不会填入默认值；精排返回有依据的Top16', async t => {
  const prompts: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    prompts.push(JSON.parse(init.body as string).messages[1].content);
    return response(prompts.length === 1 ? { summary: '想了解视觉感知', mentorIds: mentors.slice(0, 20).map(m => m.id) } : { recommendations: Array.from({ length: 16 }, (_, i) => recommendation(i)), limitations: '不代表名额' });
  });
  const result = await newMatch({ ...emptyProfile, interests: '视觉感知' }, data, settings);
  assert.equal(result.recommendations.length, 16);
  assert.ok(prompts[0].includes(mentors.at(-1)!.id));
  assert.ok(prompts[0].includes('"grade":""')); assert.ok(!prompts[0].includes('刚开始学习Python'));
  assert.ok(prompts[1].includes(mentors[19].id));
});
test('硬条件下无候选时返回空列表，不强行凑满16人', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response({ summary: '只考虑未收录的方向', mentorIds: [] }); });
  const result = await newMatch({ ...emptyProfile, constraints: '只考虑未收录的方向' }, data, settings);
  assert.equal(result.recommendations.length, 0); assert.equal(calls, 1);
});
test('重复候选和推荐按首次出现顺序去重，不增加模型请求', async t => {
  const prompts: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    prompts.push(JSON.parse(init.body as string).messages[1].content);
    return response(prompts.length === 1
      ? { summary: '测试', mentorIds: [mentors[1].id, mentors[0].id, mentors[1].id] }
      : { recommendations: [recommendation(1), recommendation(0), recommendation(1)], limitations: '测试' });
  });
  const result = await newMatch({ ...emptyProfile, interests: '视觉' }, data, settings);
  assert.deepEqual(result.recommendations.map(r => r.mentorId), [mentors[1].id, mentors[0].id]);
  const evidence = JSON.parse(prompts[1].split('。证据：')[1].split('\n引用规则：')[0]);
  assert.deepEqual(evidence.map((m: { id: string }) => m.id), [mentors[1].id, mentors[0].id]);
  assert.equal(prompts.length, 2);
});
test('不存在的候选ID反馈给模型修正，修正后才精排', async t => {
  const requests: { messages: { role: string; content: string }[] }[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string));
    return response(requests.length === 1
      ? { summary: '测试', mentorIds: [mentors[0].id, 'not-a-real-mentor'] }
      : requests.length === 2 ? { summary: '已修正', mentorIds: [mentors[0].id] }
      : { recommendations: [recommendation(0)], limitations: '测试' });
  });
  const result = await newMatch({ ...emptyProfile, interests: '视觉' }, data, settings);
  assert.equal(requests.length, 3);
  assert.equal(requests[1].messages[2].role, 'assistant');
  assert.match(requests[1].messages[3].content, /not-a-real-mentor/);
  assert.match(requests[1].messages[3].content, /不在本次目录/);
  assert.equal(result.summary, '已修正');
  assert.deepEqual(result.recommendations.map(r => r.mentorId), [mentors[0].id]);
});
test('候选ID持续错误时最多纠正一次，不静默丢弃也不进入精排', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return response({ summary: '测试', mentorIds: [mentors[0].id, 'not-a-real-mentor'] });
  });
  await assert.rejects(() => newMatch({ ...emptyProfile, interests: '视觉' }, data, settings), /结构检查/);
  assert.equal(calls, 2);
});
test('纠正后的空候选列表正常返回，不强行补人', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => response({ summary: '目录中没有符合条件的教师', mentorIds: ++calls === 1 ? ['not-a-real-mentor'] : [] }));
  const result = await newMatch({ ...emptyProfile, interests: '视觉' }, data, settings);
  assert.deepEqual(result.recommendations, []);
  assert.equal(calls, 2);
});
test('精排的越界教师ID和跨教师引用均可反馈纠正', async t => {
  for (const kind of ['outside', 'cross'] as const) {
    await t.test(kind, async t => {
      let calls = 0;
      t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
        calls++;
        if (calls === 1) return response({ summary: '测试', mentorIds: mentors.slice(0, 2).map(m => m.id) });
        if (calls === 3) {
          const messages = JSON.parse(init.body as string).messages;
          assert.match(messages[3].content, kind === 'outside' ? /不在本轮候选/ : /不属于教师/);
        }
        return response({ recommendations: [calls === 2
          ? kind === 'outside' ? recommendation(2) : { ...recommendation(0), citations: [mentors[1].source.id] }
          : recommendation(0)], limitations: '测试' });
      });
      const result = await newMatch({ ...emptyProfile, interests: '视觉' }, data, settings);
      assert.deepEqual(result.recommendations, [recommendation(0)]);
      assert.equal(calls, 3);
    });
  }
});
test('精排中重复项的错误引用不能通过去重绕过核验', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return response(calls === 1 ? { summary: '测试', mentorIds: mentors.slice(0, 2).map(m => m.id) }
      : { recommendations: [recommendation(0), { ...recommendation(0), citations: [mentors[1].source.id] }], limitations: '测试' });
  });
  await assert.rejects(() => newMatch({ ...emptyProfile, interests: '视觉' }, data, settings), /结构检查/);
  assert.equal(calls, 3);
});
test('入门计划仅使用选中教师资料并核验论文归属', async t => {
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const prompt = JSON.parse(init.body as string).messages[1].content;
    assert.ok(prompt.includes(mentors[0].id)); assert.ok(!prompt.includes(`"id":"${mentors[1].id}"`));
    return response({ reason: '可从研究方向了解', gaps: [], firstPaperId: 'not-this-mentors-paper', firstTask: '阅读摘要', weeks: ['了解问题', '补充基础', '小实验', '整理报告'], citations: [mentors[0].source.id] });
  });
  await assert.rejects(() => newMatchPlan(mentors[0].id, emptyProfile, data, settings), /论文与教师不一致/);
});
test('模型请求接收调用方取消信号', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    assert.ok(init.signal); controller.abort(); assert.equal(init.signal.aborted, true); init.signal.throwIfAborted();
    throw new Error('unreachable');
  });
  await assert.rejects(() => newMatch({ ...emptyProfile, interests: '视觉' }, data, settings, controller.signal), /abort/i);
});
