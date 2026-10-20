import type { Paper } from './types';

export function monthsAgo(date: Date, months: number) {
  const d = new Date(date); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d;
}
function normalize(s: string) { return s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, ''); }
function sameTitle(a: string, b: string) {
  const left=normalize(a),right=normalize(b);
  if(left===right)return true;
  const suffix=(title:string)=>{const index=title.indexOf(':');return index>0&&index<=32?normalize(title.slice(index+1)):'';};
  return suffix(a)===right||suffix(b)===left;
}
export function deduplicate(papers: Paper[]) {
  const result: Paper[] = [];
  for (const p of papers) {
    const old = result.find(x => (x.doi && p.doi && normalize(x.doi) === normalize(p.doi)) || (x.arxivId && p.arxivId && x.arxivId.replace(/v\d+$/, '') === p.arxivId.replace(/v\d+$/, '')) || sameTitle(x.title,p.title));
    if (!old) result.push(structuredClone(p));
    else {
      const arxivId=old.arxivId||p.arxivId,doi=old.doi||p.doi;
      const versions = [...old.versions, ...p.versions].filter((v,i,all) => all.findIndex(a => a.url === v.url && a.date === v.date) === i);
      const evidenceSource=old.analysis?old.source:p.analysis?p.source:undefined;
      if (p.status === 'published' && old.status !== 'published') Object.assign(old, p);
      else if (p.status === 'published' && old.status === 'published' && p.date < old.date) Object.assign(old,p);
      old.versions = versions; old.abstract ||= p.abstract; old.analysis ||= p.analysis;old.arxivId=arxivId;old.doi=doi;
      if(evidenceSource)old.source=evidenceSource;
    }
  }
  return result;
}
export function dateRange(p: Paper) {
  if (p.precision === 'year') return [new Date(`${p.date.slice(0,4)}-01-01T00:00:00Z`), new Date(`${p.date.slice(0,4)}-12-31T23:59:59Z`)];
  if (p.precision === 'month') { const [y,m] = p.date.split('-').map(Number); return [new Date(Date.UTC(y,m-1,1)),new Date(Date.UTC(y,m,0,23,59,59))]; }
  const d = new Date(`${p.date.slice(0,10)}T00:00:00Z`); return [d,d];
}
export function selectRecent(papers: Paper[], now = new Date()) {
  const unique = deduplicate(papers); const dateOnly=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));const cutoff24 = monthsAgo(dateOnly,24), cutoff36 = monthsAgo(dateOnly,36);
  const confirmed = (cutoff: Date) => unique.filter(p => { const [min,max]=dateRange(p); return min >= cutoff && max <= now; });
  const short = confirmed(cutoff24); const window = short.length >= 5 ? 24 : 36;
  const candidates = window === 24 ? short : confirmed(cutoff36);
  const boundary = unique.filter(p => { const [min,max]=dateRange(p); const cutoff=window===24?cutoff24:cutoff36; return min <= now && max >= cutoff && !(min >= cutoff && max <= now); });
  return { papers: candidates.sort((a,b) => b.date.localeCompare(a.date)).slice(0,5), window, available: candidates.length, boundary, historical: unique.filter(p => dateRange(p)[1] < cutoff36).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,2) };
}
