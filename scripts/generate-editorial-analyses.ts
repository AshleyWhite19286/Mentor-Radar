/** Generate conservative, evidence-bounded seed explanations from public abstracts. */
import { readFileSync, writeFileSync } from 'node:fs';
import { selectRecent } from '../lib/papers';
import type { Analysis, Catalog, Mentor, Paper } from '../lib/types';

const seedPath = new URL('../data/seed.json', import.meta.url);
const curatedPath = new URL('../data/selected-papers.json', import.meta.url);
const snapshotDate = new Date('2026-10-20T23:59:59Z');
const curatedMentorIds = new Set(Object.keys(JSON.parse(readFileSync(curatedPath, 'utf8')) as Record<string, unknown>));

type Topic = { name: string; problem: string; value: string; task: string; keywords: string[]; difficulty: Analysis['difficulty'] };

function topicFor(paper: Paper): Topic {
  const text = `${paper.title} ${paper.abstract}`.toLowerCase();
  if (/ocean|marine|dissolved oxygen|vertical velocity/.test(text)) return { name: '海洋时空数据', problem: '海洋观测稀疏，许多深度、区域和时间点没有直接测量。', value: '它把数据科学方法放进地球科学问题中，帮助比较不同重建或诊断思路。', task: 'AI学习建议：用一张规则网格制造随机缺失值，比较最近邻补全和均值补全，并画出两者误差。', keywords: ['海洋观测', '时空重建', '科学数据'], difficulty: '需较强基础' };
  if (/quantum|continuous-variable|entanglement|qkd|teleportation/.test(text)) return { name: '量子光通信', problem: '量子态在传输、测量和真实信道噪声下需要同时考虑信息安全与物理限制。', value: '它提供理解量子通信协议、器件和信道条件如何关联的具体案例。', task: 'AI学习建议：用概率树表示一次密钥分发中的发送、测量和丢弃步骤，标注哪些量需要由实验或协议给出。', keywords: ['量子通信', '光子学', '信道噪声'], difficulty: '需较强基础' };
  if (/photon|optical|laser|fiber|microring|waveguide|electro-optic|spectroscopy|metasurface|liquid crystal/.test(text)) return { name: '光子器件与光通信', problem: '光信号的产生、调控、传输或测量常受带宽、损耗、稳定性和器件制造约束。', value: '它展示了物理器件、信号处理和系统性能如何在同一个问题中相互制约。', task: 'AI学习建议：画出光源、调制器、传输链路和探测器的框图，为每一环标注可能的损耗或噪声来源。', keywords: ['集成光子学', '光通信', '光学器件'], difficulty: '需较强基础' };
  if (/wireless|uav|beamform|antenna|\brf\b|spectrum|electromagnetic|ofdm|vehicular|\bris\b|semantic communication/.test(text)) return { name: '无线通信与电磁系统', problem: '无线链路会受到移动、干扰、资源有限和传播环境变化的共同影响。', value: '它把通信理论、算法和具体网络场景联系起来，适合用简化仿真理解取舍。', task: 'AI学习建议：用两个用户和一条共享无线链路设定不同信噪比，比较平均分配与按信道条件分配资源的结果。', keywords: ['无线通信', '信号处理', '网络优化'], difficulty: '需补基础' };
  if (/mri|ct|medical|disease|thyroid|brain|mitochondrial|alzheimer|delirium|neuron/.test(text)) return { name: '医学影像与生物医学', problem: '医学数据往往有限、噪声较多，并且模型结论需要面对实际诊断和实验条件。', value: '它说明机器学习或光学工具如何服务于测量、表征和辅助研究，而不能替代临床判断。', task: 'AI学习建议：选择一个公开分类数据集，先写清输入、标签和可能偏差，再完成一个不超过两类的基线分类器。', keywords: ['生物医学', '医学数据', '机器学习'], difficulty: '需补基础' };
  if (/chip|memory|sram|rram|tsv|hfo|ferroelectric|capacitor|semiconductor|carrier transport|drAM|memrist/.test(text)) return { name: '芯片与电子器件', problem: '器件材料、制造工艺和电路运行条件会共同决定速度、能耗、可靠性或可制造性。', value: '它把器件层机制与系统层指标连接起来，但具体工艺和测量条件仍需查阅全文。', task: 'AI学习建议：用电阻、电容和开关组成一个简化电路，改变一个参数并记录输出曲线如何变化。', keywords: ['集成电路', '电子器件', '可靠性'], difficulty: '需较强基础' };
  if (/compression|image|video|vision|rendering|visual|frame interpolation|neural radiance/.test(text)) return { name: '视觉与媒体计算', problem: '图像和视频需要在质量、计算量、存储或传输可靠性之间取得平衡。', value: '它提供了观察表示方式、生成模型和编码策略如何影响视觉结果的具体切入点。', task: 'AI学习建议：把一张图片分别缩小、压缩或加入噪声，记录文件大小和可见失真，再写下自己的评价规则。', keywords: ['计算机视觉', '图像视频', '高效表示'], difficulty: '需补基础' };
  if (/graph|recommend|retrieval|name disambiguation|federated|reinforcement learning|language model|llm|deep residual|machine learning|neural/.test(text)) return { name: '机器学习与数据智能', problem: '数据中的关系、分布偏差或计算成本会限制模型在实际任务中的表现。', value: '它展示了如何把任务结构编码进模型，并通过对照实验判断改动是否有意义。', task: 'AI学习建议：在一个小数据集上先实现朴素基线，再只改变一个特征或训练设置，比较并解释结果差异。', keywords: ['机器学习', '表示学习', '数据建模'], difficulty: '需补基础' };
  return { name: '工程与计算方法', problem: '实际工程问题需要把物理约束、数据和计算过程放在同一套可检验的模型中。', value: '它提供了从问题定义、方法设计到评估边界的研究案例。', task: 'AI学习建议：把论文问题画成“输入—处理—输出—评价”四格图，并列出一个可被数据验证的假设。', keywords: ['工程计算', '建模', '实验设计'], difficulty: '需补基础' };
}

function methodFor(paper: Paper) {
  const text = `${paper.title} ${paper.abstract}`.toLowerCase();
  if (/diffusion/.test(text)) return '扩散式生成或重建过程，逐步从扰动状态得到目标表示';
  if (/transformer|attention/.test(text)) return '注意力模型，用不同位置或特征之间的关联组织信息';
  if (/\bgraph(?: neural| attention| learning| representation|[- ]?based)?\b/.test(text)) return '图结构建模，把对象及其关系放进消息传递或图表示学习过程';
  if (/dataset|benchmark|data set/.test(text)) return '整合公开数据或模拟数据，构建可比较的任务与评估设置';
  if (/optimization|inverse design|variational|regularized|sparse/.test(text)) return '优化建模，在目标指标与约束之间寻找可行解';
  if (/contrastive/.test(text)) return '对比学习，通过拉近相关样本并拉开不相关样本学习表示';
  if (/federated/.test(text)) return '联邦学习，在数据不集中汇总的条件下协调多个参与方训练';
  if (/photonic|optical|laser|waveguide|microring/.test(text)) return '光学器件或光信号处理设计，并以器件、链路或系统指标进行评估';
  if (/quantum/.test(text)) return '量子态、量子信道或量子器件的理论与实验建模';
  if (/simulation|first-principles|finite element/.test(text)) return '物理仿真与模型分析，用计算结果研究参数变化';
  return '摘要描述的模型或系统设计，并在相应任务上进行比较评估';
}

function analysisFor(mentor: Mentor, paper: Paper): Analysis {
  const topic = topicFor(paper);
  const method = methodFor(paper);
  const title = paper.title.replace(/[：:].*$/, '').trim();
  const prerequisites = [...new Set([...mentor.prerequisites, 'Python'])].slice(0, 5);
  const sourceText = `${paper.title} ${paper.abstract}`;
  const keywords = [...new Set([
    ...topic.keywords,
    ...( /transformer|attention/i.test(sourceText) ? ['注意力机制'] : []),
    ...( /diffusion/i.test(sourceText) ? ['扩散模型'] : []),
  ])].slice(0, 5);
  return {
    summary: `《${title}》围绕${topic.name}中的一个具体难题展开：${topic.problem}摘要提出${method}，尝试让系统在已有数据或约束下得到更可靠的结果。`,
    problem: topic.problem,
    method: `摘要的核心做法是${method}。具体网络层、器件参数或训练配置需要回到原文和公开代码核对。`,
    significance: topic.value,
    limitations: '当前解读仅基于公开摘要。摘要未完整交代数据划分、实验条件、全部对照、失败情形和适用范围，不能据此判断真实部署效果。',
    keywords,
    difficulty: topic.difficulty,
    prerequisites,
    reading: `先理解${prerequisites.join('、')}中的基础概念，再把摘要中的研究对象、输入、输出和评价指标画成流程图。`,
    reproduction: '先做一个小规模基线或仿真练习；完整复现仍需核对原文、代码、数据许可、硬件和实验设置。',
    research: '继续研究还需要阅读相关工作，明确评价指标与对照方案，并在可靠数据或实验条件下检验结论。',
    task: topic.task,
    basis: 'abstract',
    model: 'Codex · 目录摘要解读',
    citations: [paper.source.id],
  };
}

const catalog = JSON.parse(readFileSync(seedPath, 'utf8')) as Catalog;
let analyses = 0;
for (const mentor of catalog.mentors) {
  if (curatedMentorIds.has(mentor.id)) continue;
  const recentIds = new Set(selectRecent(mentor.papers, snapshotDate).papers.map(paper => paper.id));
  for (const paper of mentor.papers) {
    if (!recentIds.has(paper.id)) continue;
    if (paper.abstract && (!paper.analysis || process.argv.includes('--replace'))) {
      paper.analysis = analysisFor(mentor, paper);
      analyses++;
    }
  }
}
writeFileSync(seedPath, JSON.stringify(catalog, null, 2) + '\n');
console.log(`已生成 ${analyses} 篇基于公开摘要的预置解读。`);
