import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Catalog, Mentor } from '../lib/types';
import { visitsKey } from '../lib/new-match';

const data = JSON.parse(readFileSync('data/seed.json', 'utf8')) as Catalog;
const mentors = data.mentors.filter(m => m.role === '导师');
const grid = (page: Page) => page.getByTestId('new-match-grid');
const cards = (page: Page) => grid(page).locator('button[data-mentor-id]');
const matchResult = (mentor: Mentor, summary: string) => ({ summary, recommendations: [{ mentorId: mentor.id, reason: `${summary}的研究方向依据`, readiness: '资料不足', gaps: [], citations: [mentor.source.id] }], limitations: '测试推荐不代表招生名额' });
async function connect(page: Page) {
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByLabel('API Key', { exact: true }).fill('test-only-not-a-real-key');
  await page.getByRole('button', { name: '完成', exact: true }).click();
}
test.beforeEach(async ({ page }) => { await page.goto('/#new-match'); await expect(cards(page)).toHaveCount(16); });

test('独立入口、桌面4×4、随机批次稳定、旧match保持原功能', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await expect(page.getByRole('heading', { name: '让好奇心，慢慢聚焦。' })).toBeVisible();
  const ids = await cards(page).evaluateAll(elements => elements.map(e => e.getAttribute('data-mentor-id')));
  expect(new Set(ids).size).toBe(16);
  const boxes = await cards(page).evaluateAll(elements => elements.map(e => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y })));
  expect(new Set(boxes.slice(0, 4).map(b => b.y)).size).toBe(1);
  expect(boxes[4].y).toBeGreaterThan(boxes[0].y);
  await page.getByLabel('你想研究什么？').fill('我喜欢摄影');
  await expect(cards(page)).toHaveCount(16);
  expect(await cards(page).evaluateAll(elements => elements.map(e => e.getAttribute('data-mentor-id')))).toEqual(ids);
  await page.getByRole('button', { name: '我的科研起点', exact: true }).click();
  await expect(page).toHaveURL(/#match$/);
  await expect(page.getByRole('heading', { name: '从你的好奇心开始。' })).toBeVisible();
  await expect(page.getByRole('button', { name: /找到我的入门路径/ })).toBeVisible();
  await page.getByRole('button', { name: '个性化匹配', exact: true }).click();
  await expect(page.getByLabel('你想研究什么？')).toHaveValue('我喜欢摄影');
  await expect(cards(page)).toHaveCount(16);
  expect(await cards(page).evaluateAll(elements => elements.map(e => e.getAttribute('data-mentor-id')))).toEqual(ids);
  await page.getByRole('button', { name: /清空条件，重新探索/ }).click();
  await page.getByRole('button', { name: '换一批', exact: true }).click();
  expect(await cards(page).evaluateAll(elements => elements.map(e => e.getAttribute('data-mentor-id')))).not.toEqual(ids);
  await page.screenshot({ path: 'test-results/new-match-desktop.png', fullPage: true });
});

test('防抖匹配可选择初始16人之外的教师，条件删除恢复随机', async ({ page }) => {
  const initial = await cards(page).evaluateAll(elements => elements.map(e => e.getAttribute('data-mentor-id')));
  const outside = mentors.find(m => !initial.includes(m.id))!;
  let count = 0;
  await page.route('**/api/new-match', async route => { count++; expect(route.request().postDataJSON().profile.grade).toBe(''); await route.fulfill({ json: matchResult(outside, '摄影与图像理解') }); });
  await connect(page);
  await page.getByLabel('你想研究什么？').fill('摄影');
  await page.getByLabel('你想研究什么？').fill('摄影与图像理解');
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toHaveAttribute('data-mentor-id', outside.id);
  expect(count).toBe(1);
  await expect(page.getByRole('region', { name: '动态导师匹配结果' }).getByText('摄影与图像理解', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '移除兴趣与问题', exact: true }).click();
  await expect(cards(page)).toHaveCount(16);
  expect(await cards(page).evaluateAll(elements => elements.map(e => e.getAttribute('data-mentor-id')))).toEqual(initial);
});

test('旧请求晚返回不能覆盖最新输入', async ({ page }) => {
  let release: (() => void) | undefined;
  const old = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  await page.route('**/api/new-match', async route => {
    const interests = route.request().postDataJSON().profile.interests;
    if (interests === '旧问题') { started = true; await old; await route.fulfill({ json: matchResult(mentors[0], '过时结果') }).catch(() => {}); }
    else await route.fulfill({ json: matchResult(mentors[1], '最新结果') });
  });
  await connect(page);
  await page.getByLabel('你想研究什么？').fill('旧问题');
  await expect.poll(() => started).toBe(true);
  await page.getByLabel('你想研究什么？').fill('新问题');
  await expect(page.getByText('最新结果', { exact: true })).toBeVisible();
  release!();
  await expect(cards(page).first()).toHaveAttribute('data-mentor-id', mentors[1].id);
  await expect(page.getByText('过时结果', { exact: true })).toHaveCount(0);
});

test('中文组词不发送半成品，失败可重试且保留卡片', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/new-match', async route => {
    requests++;
    await route.fulfill(requests === 1 ? { status: 400, json: { error: '测试限流，请重试' } } : { json: matchResult(mentors[0], '重试成功') });
  });
  await page.clock.install();
  await page.reload(); await expect(cards(page)).toHaveCount(16);
  await connect(page);
  const input = page.getByLabel('你想研究什么？');
  await input.dispatchEvent('compositionstart');
  await input.fill('图像理解');
  await page.clock.runFor(1500);
  expect(requests).toBe(0);
  await input.dispatchEvent('compositionend');
  await page.clock.runFor(1100);
  await expect(page.getByRole('region', { name: '动态导师匹配结果' }).getByRole('alert')).toContainText('测试限流');
  await expect(cards(page)).toHaveCount(16);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.clock.runFor(1100);
  await expect(cards(page)).toHaveCount(1);
  expect(requests).toBe(2);
});

test('详情查看次数、有效阅读、关闭暂停与刷新持久化', async ({ page }) => {
  await page.clock.install();
  await page.reload(); await expect(cards(page)).toHaveCount(16);
  const card = cards(page).first(), id = await card.getAttribute('data-mentor-id');
  await card.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.clock.runFor(3100);
  await page.getByRole('button', { name: '关闭教师详情', exact: true }).click();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), visitsKey);
  expect(saved[id!].clicks).toBe(1); expect(saved[id!].milliseconds).toBeGreaterThanOrEqual(3000);
  await page.clock.runFor(5000);
  expect(await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key) || '{}')[id].milliseconds, { key: visitsKey, id: id! })).toBe(saved[id!].milliseconds);
  await page.reload(); await expect(cards(page)).toHaveCount(16);
  const sameCard = grid(page).locator(`button[data-mentor-id="${id}"]`);
  await expect(sameCard).toContainText('你已查看 1 次');
  await sameCard.click(); await page.getByRole('button', { name: '关闭教师详情', exact: true }).click();
  await expect(sameCard).toContainText('你已查看 2 次');
  await page.getByRole('button', { name: '清除浏览记录', exact: true }).click();
  await page.getByRole('button', { name: '确认清除', exact: true }).click();
  await expect(sameCard).toContainText('你已查看 0 次');
});

test('详情按需生成个人四周计划', async ({ page }) => {
  await page.route('**/api/new-match/plan', async route => {
    const { mentorId, profile } = route.request().postDataJSON(); const mentor = mentors.find(m => m.id === mentorId)!;
    expect(profile.grade).toBe('');
    await route.fulfill({ json: { reason: '从研究问题入手', gaps: ['线性代数'], firstPaperId: null, firstTask: '整理一个可检查的问题清单', weeks: ['阅读研究介绍', '补基础并记录', '完成小实验', '整理成果'], citations: [mentor.source.id] } });
  });
  await connect(page); await cards(page).first().click();
  await page.getByRole('button', { name: '生成我的入门计划', exact: true }).click();
  await expect(page.getByText('第 4 周', { exact: true })).toBeVisible();
  await expect(page.getByText('整理一个可检查的问题清单', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/new-match-drawer.png' });
});

test('详情闲置60秒及切到后台会暂停计时', async ({ page }) => {
  await page.clock.install();
  await page.reload(); await expect(cards(page)).toHaveCount(16);
  const id = await cards(page).first().getAttribute('data-mentor-id');
  await cards(page).first().click();
  await page.clock.fastForward(65_000);
  const readTime = () => page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key) || '{}')[id]?.milliseconds || 0, { key: visitsKey, id: id! });
  const idle = await readTime(); expect(idle).toBeGreaterThanOrEqual(60_000); expect(idle).toBeLessThan(60_100);
  await page.clock.fastForward(10_000); expect(await readTime()).toBe(idle);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(10_000); expect(await readTime()).toBe(idle);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(5100); expect(await readTime()).toBeGreaterThan(idle);
});

test('独立接口校验空白画像和缺失模型设置', async ({ page }) => {
  const response = await page.request.post('/api/new-match', { data: { profile: {} } });
  expect(response.status()).toBe(400); expect(await response.json()).toEqual({ error: '输入内容不完整或超出长度限制' });
  const plan = await page.request.post('/api/new-match/plan', { data: { mentorId: mentors[0].id } });
  expect(plan.status()).toBe(400);
});

test('手机两列，无页面横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cards(page)).toHaveCount(16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const boxes = await cards(page).evaluateAll(elements => elements.slice(0, 3).map(e => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y })));
  expect(boxes[0].y).toBe(boxes[1].y); expect(boxes[2].y).toBeGreaterThan(boxes[0].y);
  await page.screenshot({ path: 'test-results/new-match-mobile.png', fullPage: true });
});
