import { z } from 'zod';
import { structured } from './model';
import type { Catalog, ModelSettings } from './types';
import { hasProfile, type MatchProfile, type NewMatchResult } from './new-match';

export const matchProfileSchema = z.object({
  interests: z.string().max(1000), grade: z.string().max(100), courses: z.string().max(1500),
  programming: z.string().max(500), hours: z.string().max(100), goal: z.string().max(500), constraints: z.string().max(1000),
});
function planSchema(allowed: ReadonlyMap<string, unknown>) {
  return z.object({
    summary: z.string().min(1).max(500),
    mentorIds: z.array(z.string().trim().superRefine((id, ctx) => {
      if (!allowed.has(id)) ctx.addIssue({ code: 'custom', message: `教师ID ${JSON.stringify(id)} 不在本次目录中；请逐字复制目录的id，不能使用姓名、sourceId或自造编号。` });
    })).transform(ids => [...new Set(ids)]).refine(ids => ids.length <= 48, '最多返回48位不同的候选教师'),
  });
}
const resultSchema = z.object({
  recommendations: z.array(z.object({
    mentorId: z.string(), reason: z.string().min(1).max(300),
    readiness: z.enum(['可先探索', '需补基础', '资料不足']), gaps: z.array(z.string().max(100)).max(3), citations: z.array(z.string()).min(1).max(4),
  })).max(16), limitations: z.string().max(1000),
});

export async function newMatch(profile: MatchProfile, data: Catalog, settings: ModelSettings, signal?: AbortSignal): Promise<NewMatchResult> {
  if (!hasProfile(profile)) throw new Error('请先补充一点兴趣或背景');
  const mentors = data.mentors.filter(m => m.role === '导师');
  if (!mentors.length) return { summary: '暂未收录可匹配的教师。', recommendations: [], limitations: '可先补充教师资料。' };
  // Every request searches the complete catalog, independently of the visible/random batch.
  const directory = mentors.map(m => ({
    id: m.id, name: m.name, institute: data.institutes.find(i => i.id === m.instituteId)?.name,
    directions: m.officialDirections.slice(0, 180), tags: m.tags.slice(0, 6),
  }));
  const allowed = new Map(mentors.map(m => [m.id, m]));
  const plan = await structured(settings,
    `理解学生当前输入，从完整教师目录中召回最多48位相关候选。mentorIds必须逐字复制目录的id，每位教师只出现一次；不能使用姓名、sourceId或自造编号。空字符串表示未知，不能补造年级、技能、时间或偏好。兴趣宽泛时覆盖相关的不同研究方向；具体问题优先语义相关性；用户明确排除的方向和机构必须遵守。背景不足不能直接排除相关教师。只有背景而无兴趣时保持方向多样性。不要按名气或目录先后选择。返回{summary:简短中文需求理解,mentorIds:相关候选ID数组}，没有符合明确条件的候选可返回空数组。学生：${JSON.stringify(profile)}。完整目录：${JSON.stringify(directory)}`,
    planSchema(allowed), [], signal);
  const candidates = plan.mentorIds.map(id => allowed.get(id)!);
  if (!candidates.length) return { summary: plan.summary, recommendations: [], limitations: '当前资料中没有找到符合这些条件的教师，可尝试放宽条件。' };
  const evidence = candidates.map(m => ({
    id: m.id, name: m.name, institute: data.institutes.find(i => i.id === m.instituteId)?.name,
    directions: m.officialDirections, prerequisites: m.prerequisites, sourceId: m.source.id,
    papers: [...m.papers].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3).map(p => ({
      title: p.titleZh || p.title, date: p.date, sourceId: p.source.id, abstract: p.abstract?.slice(0, 700),
    })),
  }));
  const sources = candidates.flatMap(m => [m.source, ...[...m.papers].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3).map(p => p.source)]);
  // Check every entry before deduplication, including duplicate entries' citations.
  // Semantic errors belong inside structured() so its correction turn can fix them.
  const checkedResultSchema = resultSchema.superRefine((result, ctx) => {
    result.recommendations.forEach((recommendation, index) => {
      const entry = evidence.find(e => e.id === recommendation.mentorId);
      if (!entry) {
        ctx.addIssue({ code: 'custom', path: ['recommendations', index, 'mentorId'], message: `教师ID ${JSON.stringify(recommendation.mentorId)} 不在本轮候选中，请逐字复制候选教师的id。` });
        return;
      }
      const ids = new Set([entry.sourceId, ...entry.papers.map(p => p.sourceId)]);
      recommendation.citations.forEach((id, citationIndex) => {
        if (!ids.has(id)) ctx.addIssue({ code: 'custom', path: ['recommendations', index, 'citations', citationIndex], message: `引用 ${JSON.stringify(id)} 不属于教师 ${entry.id} 的本轮证据，请使用该教师的sourceId：${JSON.stringify([...ids])}` });
      });
    });
  }).transform(result => {
    const seen = new Set<string>();
    return { ...result, recommendations: result.recommendations.filter(r => {
      if (seen.has(r.mentorId)) return false;
      seen.add(r.mentorId);
      return true;
    }) };
  });
  const result = await structured(settings,
    `根据学生输入及候选证据精排，按适配次序返回最多16位教师。mentorId必须逐字复制候选证据的id，每位教师只出现一次。研究问题相关性优先，其次明确条件，再考虑基础和目标。严格遵守学生的明确排除条件。不要为了凑满16位选择无关对象；只有背景而无兴趣时可提供不同方向供探索。用户基础不足只提示差距，不轻率淘汰。不得推断名额、接收意愿或指导风格。每位给出一句中文reason（建议80字内）、readiness（可先探索/需补基础/资料不足）、最多3项gaps、该教师自身证据的citations。没有用户基础信息时不声称基础适配；资料不足时如实说明。仅凭论文标题不推测方法或结论。返回{recommendations:[{mentorId,reason,readiness,gaps,citations}],limitations:简短边界}。学生：${JSON.stringify(profile)}。需求理解：${plan.summary}。证据：${JSON.stringify(evidence)}`,
    checkedResultSchema, sources, signal);
  return { ...result, summary: plan.summary };
}

export async function newMatchPlan(mentorId: string, profile: MatchProfile, data: Catalog, settings: ModelSettings, signal?: AbortSignal) {
  const mentor = data.mentors.find(m => m.id === mentorId && m.role === '导师');
  if (!mentor) throw new Error('教师不存在');
  const papers = [...mentor.papers].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const sources = [mentor.source, ...papers.map(p => p.source)];
  const result = await structured(settings,
    `为学生了解这位教师的研究生成一个入门计划。空白背景表示未知，不假定年级、编程能力和投入时间。建议与事实分开；基础未知时给出可以调整的轻量方案。不要编造论文内容或招生意愿。返回{reason:简短适配解释,gaps:最多5项可补基础,firstPaperId:下面已列论文ID或null,firstTask:一个具体可检查的小任务,weeks:恰好4条字符串，每条包含学习内容和可检查成果,citations:该教师的真实证据ID}。学生：${JSON.stringify(profile)}。教师：${JSON.stringify({ id: mentor.id, name: mentor.name, directions: mentor.officialDirections, sourceId: mentor.source.id, prerequisites: mentor.prerequisites, papers: papers.map(p => ({ id: p.id, title: p.title, abstract: p.abstract?.slice(0, 1500), sourceId: p.source.id })) })}`,
    z.object({ reason: z.string().min(1).max(1000), gaps: z.array(z.string()).max(5), firstPaperId: z.string().nullable(), firstTask: z.string().min(1).max(1500), weeks: z.array(z.string().min(1).max(1500)).length(4), citations: z.array(z.string()).min(1).max(6) }), sources, signal);
  if (result.firstPaperId && !papers.some(p => p.id === result.firstPaperId)) throw new Error('入门论文与教师不一致，请重试');
  return result;
}
