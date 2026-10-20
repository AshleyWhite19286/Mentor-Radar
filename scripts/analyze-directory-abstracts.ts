/**
 * Add evidence-bounded paper explanations to the seeded directory catalog.
 *
 * The script intentionally processes only papers that already have a public
 * abstract. It never infers methods or results from a title alone.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { analysisSchema, structured } from '../lib/model';
import { selectRecent } from '../lib/papers';
import type { Catalog, ModelSettings, Paper } from '../lib/types';

const ROOT = new URL('..', import.meta.url);
const seedPath = new URL('../data/seed.json', import.meta.url);
const statePath = new URL('../data/directory-analysis-progress.json', import.meta.url);
const snapshotDate = new Date('2026-10-20T23:59:59Z');

type State = { papers: Record<string, { status: 'enriched' | 'error'; reason?: string; updatedAt: string }> };
type Job = { mentorId: string; mentorName: string; paper: Paper };

function argument(name: string) {
  return process.argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function readState(): State {
  try { return JSON.parse(readFileSync(statePath, 'utf8')) as State; }
  catch { return { papers: {} }; }
}

function writeJson(path: URL, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function settings(): ModelSettings {
  const apiKey = process.env.ANALYSIS_API_KEY;
  if (!apiKey) throw new Error('请设置 ANALYSIS_API_KEY；凭证仅从环境变量读取，不会写入数据或日志。');
  return {
    baseUrl: process.env.ANALYSIS_BASE_URL || 'https://models.sjtu.edu.cn/api/v1',
    apiKey,
    model: process.env.ANALYSIS_MODEL || 'deepseek-chat',
  };
}

function jobs(catalog: Catalog, state: State, retryErrors: boolean): Job[] {
  return catalog.mentors.flatMap(mentor => selectRecent(mentor.papers, snapshotDate).papers
    .filter(paper => paper.abstract && !paper.analysis)
    .filter(paper => retryErrors || state.papers[paper.id]?.status !== 'error')
    .map(paper => ({ mentorId: mentor.id, mentorName: mentor.name, paper })));
}

async function analyze(paper: Paper, modelSettings: ModelSettings) {
  const result = await structured(
    modelSettings,
    `你正在为本科低年级学生解释一篇论文。只能依据下方给出的公开摘要；不声称读过全文，也不把摘要中没有的信息说成事实。返回JSON字段：summary（80至140字的通俗说明）,problem（论文想解决的具体问题）,method（摘要明确提到的方法，用清楚中文解释）,significance（研究意义或可理解的价值，必须保留适用边界）,limitations（明确“当前解读仅基于公开摘要”，并说明摘要未交代的实验条件、对照或限制不能据此判断）,keywords（3至5个中文关键词）,difficulty（可直接探索/需补基础/需较强基础）,prerequisites（3至5项课程或技能）,reading（学生先理解哪些概念）,reproduction（不夸大可复现性，说明可做的简化练习及仍需核对的资源）,research（继续做研究还需要哪些工作）,task（以“AI学习建议：”开头，不依赖专用设备、可以检查结果的具体练习）,citations。citations只能填写证据ID ${paper.source.id}。论文标题：${paper.title}。公开摘要：${paper.abstract}`,
    analysisSchema,
    [paper.source],
  );
  return { ...result, basis: 'abstract' as const, model: `批量摘要解读 · ${modelSettings.model}` };
}

async function main() {
  const limitText = argument('--limit');
  const limit = limitText ? Number(limitText) : 0;
  if (!Number.isInteger(limit) || limit < 0) throw new Error('--limit 必须是非负整数。');
  const retryErrors = process.argv.includes('--retry-errors');
  const modelSettings = settings();
  const catalog = JSON.parse(readFileSync(seedPath, 'utf8')) as Catalog;
  const state = readState();
  const pending = jobs(catalog, state, retryErrors).slice(0, limit || undefined);

  console.log(JSON.stringify({ event: 'started', pending: pending.length }, null, 0));
  for (const [index, job] of pending.entries()) {
    try {
      job.paper.analysis = await analyze(job.paper, modelSettings);
      state.papers[job.paper.id] = { status: 'enriched', updatedAt: new Date().toISOString() };
      writeJson(seedPath, catalog);
      writeJson(statePath, state);
      console.log(JSON.stringify({ event: 'progress', current: index + 1, total: pending.length, mentor: job.mentorName, paper: job.paper.id, status: 'enriched' }));
    } catch (error) {
      state.papers[job.paper.id] = { status: 'error', reason: error instanceof Error ? error.message : 'unknown error', updatedAt: new Date().toISOString() };
      writeJson(statePath, state);
      console.log(JSON.stringify({ event: 'progress', current: index + 1, total: pending.length, mentor: job.mentorName, paper: job.paper.id, status: 'error' }));
    }
  }
  const complete = Object.values(state.papers).filter(item => item.status === 'enriched').length;
  console.log(JSON.stringify({ event: 'complete', enriched: complete }));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : '批处理失败');
  process.exitCode = 1;
});
