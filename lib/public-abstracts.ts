import * as cheerio from 'cheerio';

export const normalizePaperTitle = (title: string) => title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Only accept an abstract attached to the expected paper, never a generic page description. */
export function extractPublicAbstract(html: string, expectedTitle: string): string | undefined {
  const $ = cheerio.load(html);
  const titles = $('meta[name="citation_title"],meta[name="dc.Title"],meta[name="DC.Title"],meta[property="og:title"]')
    .map((_, element) => $(element).attr('content') || '').get();
  titles.push($('h1').first().text().replace(/^Title:\s*/i, '').trim());
  if (!titles.some(title => normalizePaperTitle(title) === normalizePaperTitle(expectedTitle))) return;

  const clean = (value: string) => cheerio.load(value).text().replace(/^\s*Abstract\s*[:：]?\s*/i, '').replace(/\s+/g, ' ').trim();
  for (const selector of [
    'section[data-title="Abstract"] .c-article-section__content',
    '#Abs1-content', 'blockquote.abstract', '.abstractSection', '#abstract .abstract-text',
    '.abstract.author', '#eng-abstract', '[role="doc-abstract"]',
    'meta[name="citation_abstract"]', 'meta[name="dc.Description"]', 'meta[name="DC.Description"]',
  ]) {
    const element = $(selector).first();
    element.find('script,style,h2,h3,.u-visually-hidden').remove();
    const abstract = clean(element.attr('content') || element.text());
    if (abstract.length >= 100 && !/(?:\.\.\.|…)\s*$/.test(abstract)) return abstract;
  }
  // IEEE embeds the full public abstract in its page metadata.
  const embedded = html.match(/"abstract"\s*:\s*("(?:\\.|[^"\\])*")/);
  if (embedded) {
    try {
      const abstract = clean(JSON.parse(embedded[1]));
      if (abstract.length >= 100) return abstract;
    } catch { /* Not a valid metadata string. */ }
  }
}
