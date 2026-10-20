/** Import papers only for author IDs cross-checked against an official Scholar link. */
import { readFileSync, writeFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { authorPapers, type AuthorCandidate } from '../lib/academic';
import { selectRecent } from '../lib/papers';
import type { Catalog, Paper } from '../lib/types';

const seedPath = new URL('../data/seed.json', import.meta.url);
const verified = [{
  mentorId: '3108', scholarUser: 'IFYbb7oAAAAJ', semanticAuthorId: '32879676', name: 'Jiezhang Cao',
}] as const;

function papersFromSemantic(data: { data?: Record<string, unknown>[] }): Paper[] {
  return (data.data || []).map(item => {
    const ids = item.externalIds as Record<string, string> | undefined;
    const date = typeof item.publicationDate === 'string' ? item.publicationDate : String(item.year || '');
    const authors = Array.isArray(item.authors) ? item.authors.map(author => String((author as Record<string, unknown>).name || '')).filter(Boolean) : [];
    const doi = ids?.DOI;
    const arxivId = ids?.ArXiv;
    const url = typeof item.url === 'string' ? item.url : doi ? `https://doi.org/${doi}` : '';
    return { id: `paper-${String(item.paperId)}`, title: String(item.title || '标题待核实'), date, precision: item.publicationDate ? 'day' as const : 'year' as const, venue: String(item.venue || '发表位置待核实'), doi, arxivId, authors, abstract: typeof item.abstract === 'string' && item.abstract.trim() ? item.abstract : undefined, url, status: item.venue ? 'published' as const : 'preprint' as const, versions: [{ kind: item.venue ? '正式发表元信息' : '预印本元信息', date, url }], source: { id: `source-${String(item.paperId)}`, title: String(item.title || '论文元信息'), url, kind: 'paper' as const, retrievedAt: '2026-10-20' }, identity: '' };
  }).filter(paper => /^202[3-6]/.test(paper.date));
}

function papersFromArxiv(xml: string): Paper[] {
  const $ = cheerio.load(xml, { xml: true });
  return $('entry').map((_, entry) => {
    const url = $(entry).find('id').text().trim();
    const arxivId = url.split('/abs/')[1]?.replace(/v\d+$/, '');
    const date = $(entry).find('published').text().slice(0, 10);
    const title = $(entry).find('title').text().replace(/\s+/g, ' ').trim();
    return { id: `paper-arxiv-${arxivId}`, title, date, precision: 'day' as const, venue: 'arXiv (Cornell University)', doi: arxivId ? `10.48550/arXiv.${arxivId}` : undefined, arxivId, authors: $(entry).find('author name').map((_, author) => $(author).text().trim()).get(), abstract: $(entry).find('summary').text().replace(/\s+/g, ' ').trim() || undefined, url, status: 'preprint' as const, versions: [{ kind: '预印本首次公开', date, url }], source: { id: `source-arxiv-${arxivId}`, title, url, kind: 'paper' as const, retrievedAt: '2026-10-20' }, identity: '' };
  }).get();
}

async function main() {
  const catalog = JSON.parse(readFileSync(seedPath, 'utf8')) as Catalog;
  const metadataPath = process.argv.find(value => value.startsWith('--metadata='))?.slice('--metadata='.length);
  const arxivPath = process.argv.find(value => value.startsWith('--arxiv='))?.slice('--arxiv='.length);
  const semanticSnapshot = metadataPath ? JSON.parse(readFileSync(metadataPath, 'utf8')) as { data?: Record<string, unknown>[] } : undefined;
  for (const entry of verified) {
    const mentor = catalog.mentors.find(item => item.id === entry.mentorId);
    if (!mentor) throw new Error(`目录中不存在 ${entry.mentorId}`);
    const scholarUser = mentor.homepage ? new URL(mentor.homepage).searchParams.get('user') : undefined;
    if (scholarUser !== entry.scholarUser) throw new Error(`${mentor.name} 的官网 Scholar 链接已变化，停止导入`);
    const author: AuthorCandidate = { id: entry.semanticAuthorId, name: entry.name, affiliations: [], works: 0, url: `https://www.semanticscholar.org/author/${entry.semanticAuthorId}`, provider: 'semantic' };
    const result = arxivPath ? (() => { const papers = papersFromArxiv(readFileSync(arxivPath, 'utf8')); if (papers.some(paper => !paper.authors.includes(entry.name))) throw new Error(`${mentor.name} 的 arXiv 条目未全部包含已核验作者，停止导入`); const recent = selectRecent(papers, new Date('2026-10-20T23:59:59Z')); return { papers: recent.papers, window: recent.window }; })() : semanticSnapshot ? (() => { const recent = selectRecent(papersFromSemantic(semanticSnapshot), new Date('2026-10-20T23:59:59Z')); return { papers: recent.papers, window: recent.window }; })() : await authorPapers(author, step => console.log(`${mentor.name}：${step}`));
    mentor.papers = result.papers.map(paper => ({ ...paper, identity: `学院官方个人页公开链接到 Google Scholar 用户 ${entry.scholarUser}；该身份与 Semantic Scholar 作者档案 ${entry.semanticAuthorId} 交叉核验。` }));
    mentor.coverageNote = `官网 Google Scholar 链接与 Semantic Scholar 作者档案交叉核验；按${result.window}个月窗口收录${result.papers.length}篇近期论文。`;
    mentor.authorId = `https://www.semanticscholar.org/author/${entry.semanticAuthorId}`;
    console.log(`${mentor.name}：导入 ${mentor.papers.length} 篇近期论文，其中 ${mentor.papers.filter(paper => paper.abstract).length} 篇带公开摘要。`);
  }
  writeFileSync(seedPath, JSON.stringify(catalog, null, 2) + '\n');
}

void main().catch(error => { console.error(error instanceof Error ? error.message : '导入失败'); process.exitCode = 1; });
