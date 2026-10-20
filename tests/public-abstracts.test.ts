import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPublicAbstract } from '../lib/public-abstracts';

const title = 'H2SVC: Head-Aware Heterogeneous Streaming Video Cache';
const abstract = 'Multimodal models accumulate a large cache during streaming video understanding. We propose separate memory banks for attention heads with different temporal roles and evaluate the resulting memory savings.';

test('公开页面提取完整摘要，允许标题中的数学排版差异', () => {
  const html = `<meta name="citation_title" content="H $$^2$$ SVC: Head-Aware Heterogeneous Streaming Video Cache"><meta name="description" content="Truncated preview..."><section data-title="Abstract"><h2>Abstract</h2><div class="c-article-section__content"><p>${abstract}</p></div></section>`;
  assert.equal(extractPublicAbstract(html, title), abstract);
  assert.equal(extractPublicAbstract(html, 'A different paper'), undefined);
});

test('不把页面预览或通用描述当作完整论文摘要', () => {
  assert.equal(extractPublicAbstract(`<h1>${title}</h1><meta name="description" content="${abstract}">`, title), undefined);
  assert.equal(extractPublicAbstract(`<h1>${title}</h1><blockquote class="abstract">Abstract: ${abstract}...</blockquote>`, title), undefined);
});

test('arXiv 与 IEEE 的公开摘要可提取', () => {
  assert.equal(extractPublicAbstract(`<h1>Title: ${title}</h1><blockquote class="abstract"><span>Abstract:</span> ${abstract}</blockquote>`, title), abstract);
  assert.equal(extractPublicAbstract(`<meta name="citation_title" content="${title}"><script>var metadata={"abstract":${JSON.stringify(abstract)}};</script>`, title), abstract);
});
