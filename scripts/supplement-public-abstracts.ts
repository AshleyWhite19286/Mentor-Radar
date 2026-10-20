/** Fill public abstracts for the papers shown by default; --all includes older bibliography entries. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as cheerio from 'cheerio';
import { selectRecent } from '../lib/papers';
import { extractPublicAbstract, normalizePaperTitle } from '../lib/public-abstracts';
import type { Catalog, Paper, Source } from '../lib/types';

const seedPath = 'data/seed.json';
const data = JSON.parse(readFileSync(seedPath, 'utf8')) as Catalog;
const all = data.mentors.flatMap(mentor => mentor.papers);
const targets = process.argv.includes('--all') ? all : data.mentors.flatMap(mentor => selectRecent(mentor.papers).papers);
const day = '2026-10-20';
const key = (paper: Paper) => normalizePaperTitle(paper.title);
const known = new Map(all.filter(paper => paper.abstract).map(paper => [key(paper), paper]));
const pending = [...new Map(targets.filter(paper => !paper.abstract && !known.has(key(paper))).map(paper => [key(paper), paper])).values()];
const results = new Map<string, { abstract: string; source: Source }>();
const run = promisify(execFile);
for (const [title, paper] of known) results.set(title, { abstract: paper.abstract!, source: paper.abstractSource || paper.source });
let cursor = 0, checked = 0, fetched = 0;

async function request(url: string) {
  const { stdout } = await run('curl', ['--silent', '--show-error', '--fail', '--location', '--max-time', '18', '--write-out', '\n%{url_effective}\n%{content_type}', url], { maxBuffer: 8 * 1024 * 1024 });
  const typeEnd = stdout.lastIndexOf('\n');
  const urlEnd = stdout.lastIndexOf('\n', typeEnd - 1);
  if (stdout.slice(typeEnd + 1).includes('application/pdf')) throw new Error('PDF');
  return { text: stdout.slice(0, urlEnd), url: stdout.slice(urlEnd + 1, typeEnd) };
}

async function supplement(paper: Paper) {
  const urls = [...new Set([
    ...(paper.arxivId ? [`https://arxiv.org/abs/${paper.arxivId}`] : []),
    paper.url, paper.source.url, ...paper.versions.map(version => version.url),
  ])].filter(url => !/openalex\.org|semanticscholar\.org|scholar\.google\.|icisee\.sjtu\.edu\.cn/.test(url));
  for (const url of urls.slice(0, 3)) {
    try {
      const page = await request(url);
      const abstract = extractPublicAbstract(page.text, paper.title);
      if (abstract) return { abstract, url: page.url };
    } catch { /* A blocked publisher page does not prevent trying another public source. */ }
  }
  if (paper.doi) {
    try {
      const page = await request(`https://api.crossref.org/works/${encodeURIComponent(paper.doi)}`);
      const record = JSON.parse(page.text).message;
      if (record.abstract && record.title?.some((title: string) => normalizePaperTitle(title) === key(paper))) {
        const abstract = cheerio.load(record.abstract).text().replace(/\s+/g, ' ').trim();
        if (abstract.length >= 100) return { abstract, url: page.url };
      }
    } catch { /* Leave missing abstracts explicit. */ }
  }
}

function save() {
  // Re-read so unrelated data edits during the fetch are preserved.
  const latest = JSON.parse(readFileSync(seedPath, 'utf8')) as Catalog;
  let filled = 0;
  for (const mentor of latest.mentors) for (const paper of mentor.papers) {
    const result = results.get(key(paper));
    if (!paper.abstract && result) {
      paper.abstract = result.abstract;
      paper.abstractSource = result.source;
      filled++;
    }
  }
  if (filled) writeFileSync(seedPath, JSON.stringify(latest, null, 2) + '\n');
  return filled;
}

async function main() {
  console.log(JSON.stringify({ pending: pending.length, shared: save() }));
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (cursor < pending.length) {
      const paper = pending[cursor++];
      const result = await supplement(paper);
      if (result) {
        results.set(key(paper), { abstract: result.abstract, source: { id: `abstract-${paper.id}`, title: `${paper.title} · 公开摘要`, url: result.url, kind: 'paper', retrievedAt: day } });
        fetched++;
      }
      checked++;
      if (result || checked % 25 === 0) console.log(JSON.stringify({ checked, total: pending.length, fetched, filled: save(), ...(result ? { title: paper.title } : {}) }));
    }
  }));
  console.log(JSON.stringify({ complete: true, checked, fetched, filled: save() }));

}
main().catch(error => { console.error(error); process.exitCode = 1; });
