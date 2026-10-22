import type { Mentor, Student } from './types';

export type MatchProfile = Student & { constraints: string };
export const emptyProfile: MatchProfile = { grade: '', interests: '', courses: '', programming: '', hours: '', goal: '', constraints: '' };
export const profileLabels: Record<keyof MatchProfile, string> = { interests: '兴趣与问题', grade: '年级', courses: '已学课程', programming: '编程经验', hours: '每周投入', goal: '探索目标', constraints: '其他条件' };
export type MatchCandidate = { mentorId: string; reason: string; readiness: '可先探索' | '需补基础' | '资料不足'; gaps: string[]; citations: string[] };
export type NewMatchResult = { summary: string; recommendations: MatchCandidate[]; limitations: string };
export type EntryPlan = { reason: string; gaps: string[]; firstPaperId: string | null; firstTask: string; weeks: string[]; citations: string[] };
export type Visit = { clicks: number; milliseconds: number };
export type Visits = Record<string, Visit>;
export const visitsKey = 'mentor-radar:new-match:visits:v1';
export const sessionKey = 'mentor-radar:new-match:session:v1';

export function hasProfile(profile: MatchProfile) { return Object.values(profile).some(value => value.trim()); }
export function sampleMentors(mentors: Mentor[], random = Math.random): string[] {
  const ids = [...new Set(mentors.filter(m => m.role === '导师').map(m => m.id))];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, 16);
}
export function readVisits(value: unknown): Visits {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Visit] => {
    const visit = entry[1];
    return visit && typeof visit === 'object' && Number.isSafeInteger(visit.clicks) && visit.clicks >= 0 && Number.isFinite(visit.milliseconds) && visit.milliseconds >= 0;
  }));
}
export function readingDelta(previous: number, now: number, lastActivity: number, visible: boolean) {
  return visible ? Math.max(0, Math.min(now, lastActivity + 60_000) - previous) : 0;
}
export function formatReading(milliseconds = 0) {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} 分 ${seconds % 60} 秒` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}
