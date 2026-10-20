import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { selectRecent } from '../lib/papers';
import type { Catalog,Institute,Mentor,Paper,Source } from '../lib/types';
import { createHash } from 'node:crypto';
const read=(name:string)=>JSON.parse(readFileSync(`data/${name}.json`,'utf8'));
const profiles=read('source-profiles'),works=read('selected-papers'),notes=read('editorial-notes'),backgrounds=read('institute-backgrounds');
for(const [mentor,values] of Object.entries(read('supplemental-notes')))for(const [index,note] of Object.entries(values as object))notes[mentor][Number(index)]=note;
const day='2026-10-20';
const rows=[
 ['data','数据智能研究所','数据智能','DATA INTELLIGENCE','让数据成为理解世界的线索','从搜索引擎的文档处理，到稀疏海洋观测的补全，当前样本展示了数据与机器学习的交叉。','线性代数、概率统计、Python','数据挖掘、机器学习、科学计算','王新兵的官方方向包括物联网、移动互联网和大数据。近期样本进一步涉及大模型检索效率与海洋数据重建。'],
 ['intelligence','信息智能研究所','信息智能','INFORMATION INTELLIGENCE','从信息表示到机器理解','图像怎样压缩、几何形状怎样表达、医学数据怎样采样，背后都涉及如何保留有用信息。','线性代数、概率论、Python、深度学习基础','信号处理、机器学习、信息论','戴文睿的样本涉及几何表示、图像压缩、稀疏表示与任务相关医学成像。'],
 ['image','图像通信与网络工程研究所','图像与网络','IMAGE, COMMUNICATION & NETWORKS','让机器理解图像，也理解人的感受','除了判断图像是什么，还要判断生成内容是否自然、视频是否连贯，以及人的观看体验。','Python、线性代数、数字图像处理','多媒体、计算机视觉、多模态评价','闵雄阔的近期样本涉及生成内容、情绪理解、图像编辑与数字人视频的质量评价。'],
 ['wireless','无线通信技术研究所','无线通信','WIRELESS COMMUNICATIONS','让信息在复杂无线环境中可靠抵达','信号在传输中会衰减和丢失。当前样本关注哪些信息值得传、怎样恢复，以及智能体如何协作。','概率论、信号与系统、通信原理、Python或MATLAB','6G、语义通信、边缘智能','陶梅霞的近期样本涉及智能体通信、图像语义传输以及信道修复。'],
 ['photonics','光子学与通信研究所','光子与通信','PHOTONICS & COMMUNICATIONS','用光传信息，也尝试用光做计算','把计算或传感任务映射到光学器件，可以探索新的处理方式；真实器件仍有精度、噪声和制造约束。','大学物理、光学、线性代数、Python','光计算、光通信、光子芯片','张文甲的近期样本涉及光子伊辛机、光学组合优化与光纤传感内计算。'],
 ['electromagnetics','电磁与智能系统研究所','电磁与智能','ELECTROMAGNETICS & INTELLIGENT SYSTEMS','研究无线信号怎样传播和被调控','可以把智能反射面理解成能调节反射方式的墙面，让无线信号绕开障碍或服务特定方向。','电磁场、通信原理、线性代数、最优化','智能反射面、卫星网络、通感一体化','武庆庆的样本涉及智能反射面与卫星通信、近场信道和通信感知协同。部分论文暂缺摘要，主题观察仍有限。'],
 ['eda','芯片设计与EDA研究所','芯片与EDA','IC DESIGN & EDA','让算法在芯片上跑得更高效','大模型的速度不仅取决于算法，也受存储、数据搬运和芯片连接限制；硬件与软件需要一起设计。','数字逻辑、计算机组成、Verilog、Python','存内计算、三维集成、AI芯片','孙亚男的样本涉及异构存内计算、三维逻辑与存储堆叠，以及从数据手册生成硬件行为模型。'],
 ['microsystems','微纳器件与集成系统研究所','微纳系统','MICRO/NANO DEVICES & SYSTEMS','把微小物理变化变成可读取的信号','微型传感器通过结构、材料和电路，把压力、温度或化学变化转为电信号。入门可以先从模型和仿真开始。','大学物理、电路基础、半导体基础、数值仿真','MEMS、微型传感器、微纳加工','刘景全的样本涉及微压力传感、低温测量、压电水声器件和离子敏感晶体管。'],
 ['nanoelectronics','纳电子材料与器件研究所','纳电子材料','NANOELECTRONIC MATERIALS & DEVICES','从材料尺度探索电子器件的新可能','器件缩小到纳米尺度后，边缘、缺陷和材料结构都可能改变电流。研究需要把材料物理与器件测量联系起来。','大学物理、半导体物理、材料基础、电路','二维材料、纳米器件、忆阻器','陈长鑫的样本涉及黑磷纳米带、二维铁电材料与忆阻器。为补足5篇，检索窗口扩展到36个月。'],
 ['media','未来媒体网络协同创新中心','未来媒体网络','FUTURE MEDIA NETWORKS','把媒体内容和通信网络一起优化','当许多人观看相同内容时，广播和蜂窝网络可以协同；高速移动中的信号检测与新波形也是当前样本的主题。','通信原理、信号与系统、概率论、MATLAB','广播蜂窝融合、6G、信道编码','徐胤的近期样本涉及AFDM、可移动天线、广播与蜂窝融合网络和分地区内容传输。'],
 ['teaching','电子信息与集成电路实验教学中心','实验教学','EXPERIMENTAL TEACHING','从课程原理走向工程实践','本分类是实验教学中心，介绍应关注实践学习。当前收录人员的科研样本可以作为课程与科研之间的补充入口。','电路基础、数字逻辑、Python、信号与系统','实验教学、嵌入式系统、图像处理','方向忠的近期论文样本涉及模型压缩、小样本学习与推理数据。它们是个人科研线索，不代表中心整体教学方向。'],
 ['aemd','先进电子材料与器件平台','先进材料平台','ADVANCED ELECTRONIC MATERIALS & DEVICES','为微纳器件研究提供加工与测试能力','可把平台理解为支持多个学科研究的专业加工与测试设施。平台人员的工作与独立招收研究生的导师角色需要分别了解。','材料基础、半导体工艺、实验规范、图像处理','微纳加工、器件表征、公共平台','王英的已收录近期论文涉及多层薄膜扫描电镜图像的边缘检测。当前仅核实1篇，不足以描述整个平台的研究活动。']
];
const names=['Xinbing Wang','Wenrui Dai','Xiongkuo Min','Meixia Tao','Wenjia Zhang','Qingqing Wu','Yanan Sun','Jingquan Liu','Changxin Chen','Yin Xu','Xiangzhong Fang','Ying Wang'];
const institutes:Institute[]=[],mentors:Mentor[]=[];
for(let n=0;n<rows.length;n++) {
 const [id,name,shortName,english,tagline,plain,bases,tags,observation]=rows[n],p=profiles[n],entry=works[p.id];
 const source:Source={id:'profile-'+p.id,title:p.name+' · 学院官方个人页',url:p.url,retrievedAt:day,kind:'official',excerpt:p.profile+'\n研究方向：'+(p.sections['研究方向']||'')};
 const prerequisites=bases.split('、');
 const institute:Institute={id,name,shortName,english,kind:n===11?'平台':n>=9?'中心':'研究所',official:n===11?'AEMD平台面向校内外提供微纳加工与测试服务，支持电子、物理、材料等学科的交叉研究。':'学院教师目录将本单位列为人员所属分类。当前官方资料样本为'+p.name+'：'+(p.sections['研究方向']||'研究方向参见个人页').slice(0,160)+'。完整机构独立简介仍待补充。',plain,observation,prerequisites,tags:tags.split('、'),sources:[{id:'directory',title:'学院教师目录',url:'https://icisee.sjtu.edu.cn/jiaoshiml.html',retrievedAt:day,kind:'official'},source],updatedAt:day};
 if(n===11)institute.sources.unshift({id:'aemd-official',title:'学院公共平台介绍',url:'https://icisee.sjtu.edu.cn/ggpt-pt.html',retrievedAt:day,kind:'official'});
 institute.official=backgrounds[id][0];institute.sources.unshift({id:'institute-'+id,title:backgrounds[id][2],url:backgrounds[id][1],retrievedAt:day,kind:'official'});
 const papers:Paper[]=entry.papers.map((w:any,index:number)=>{
  if(w.abstract)w.abstract=w.abstract.replace(/<[^>]+>/g,'');
  const doi=w.doi?.replace('https://doi.org/',''),isArxiv=doi?.startsWith('10.48550/arxiv.');const paperId='paper-'+w.id.split('/').pop();const paperSource:Source={id:'source-'+paperId,title:w.title,url:w.abstractSource||w.id,retrievedAt:day,kind:'paper'};
  const note=notes[p.id]?.[index];
  const paper:Paper={id:paperId,title:w.title,titleZh:note?.[0],date:w.date,precision:w.precision||'day',venue:w.venue||'发表位置待核实',doi,arxivId:isArxiv?doi.slice('10.48550/arxiv.'.length):undefined,authors:w.authors.map((a:any)=>a[0]),abstract:w.abstract||undefined,url:isArxiv?'https://arxiv.org/abs/'+doi.slice('10.48550/arxiv.'.length):w.url,status:isArxiv?'preprint':'published',versions:[{kind:isArxiv?'预印本首次公开':'正式发表元信息',date:w.date,url:w.url}],source:paperSource,identity:n===11?'官方个人页明确列出的论文；标题与DOI记录交叉核对':'已检查作者姓名、交大单位或官方研究方向及稳定合作者；来自公开学术索引',dateNote:w.metadataNote};
  if(note&&w.abstract)paper.analysis={summary:note[1],problem:note[1].split('。')[0]+'。',method:note[2],significance:'这项工作为理解'+note[4].slice(0,2).join('与')+'的联系提供了具体研究案例；适用边界需结合全文实验确认。',limitations:'当前解读仅基于公开摘要。未核验完整实验设置、全部对照和适用边界，不将论文结果等同于已部署能力。',keywords:note[4],difficulty:n===11?'需补基础':'需较强基础',prerequisites,reading:'先理解'+prerequisites.slice(0,2).join('与')+'，再画出论文的输入、处理过程与输出。',reproduction:n>=7&&n<=8?'局部可从数值模型和公开数据练习；真实器件制备与测量需要实验室设备、培训及指导。':'先尝试公开数据上的简化实验；完整复现还需核对代码、硬件资源和训练配置。',research:'完成同等级研究还需要阅读相关工作、设计可靠对照并获得研究指导，不能仅凭一个入门练习判断。',task:'AI学习建议：'+note[3],basis:'abstract',model:'Codex · 预置摘要解读',citations:[paperSource.id]};
  return paper;
 });
 const recent=selectRecent(papers,new Date('2026-10-20T23:59:59Z'));
 const allText=Object.values(p.sections).join('\n');
 const mentor:Mentor={id:p.id,name:p.name,englishName:names[n],title:p.profile.split('\n')[1],instituteId:id,photo:p.photo,email:p.profile.match(/电子邮件：[ ]*([^\s]+)/)?.[1],homepage:p.profile.match(/个人主页：[ ]*(https?:\/\/[^\s]+)/)?.[1],officialDirections:p.sections['研究方向']||'官方个人页未单列研究方向',tagline,tags:tags.split('、'),prerequisites,advisorStatus:/博士生导师|博导/.test(allText)?'官方个人页明确提及博士生导师':n===11?'导师资格待核实；当前按平台人员展示':'导师资格待核实；请联系官方确认',role:n===11?'机构人员':'导师',source,selectionReason:n===11?'平台按真实职称选择正高级实验师；不标为教授，导师资格待核实。':'官网明确列为'+p.profile.split('\n')[1]+'；个人信息可追溯，近期论文可核查。同档优先考虑数据可用性。',papers,feedback:[],identity:'姓名、职称和机构归属已与学院个人页核对',searchedAt:day,coverageNote:`检索采用${recent.window}个月窗口；当前核实${recent.papers.length}篇，${recent.papers.filter(p=>!!p.abstract).length}篇有公开摘要。学术索引可能漏收或误归属，所列不代表完整发表记录。`,authorId:entry.authorId};
 institutes.push(institute);mentors.push(mentor);
}
for(const i of institutes)i.evidenceFingerprint=createHash('sha256').update(JSON.stringify(mentors.filter(m=>m.instituteId===i.id).map(m=>({id:m.id,directions:m.officialDirections,papers:m.papers.map(p=>({id:p.id,title:p.title,abstract:p.abstract}))})))).digest('hex');
const catalog:Catalog={institutes,mentors,revisions:[]};writeFileSync('data/seed.json',JSON.stringify(catalog,null,2));
mkdirSync('docs',{recursive:true});
let report='# 第一阶段选人审阅表\n\n数据检索日期：2026-10-20。每类先1位，扩展为每类2位须经用户明确确认。以下为数据覆盖优先的候选，不是教师排名。\n\n|机构|姓名|官方职称|选取依据|近期论文／有摘要|窗口|来源|\n|---|---|---|---|---|---|---|\n';
for(const m of mentors){const i=institutes.find(i=>i.id===m.instituteId)!,s=selectRecent(m.papers,new Date('2026-10-20T23:59:59Z'));report+=`|${i.name}|${m.name}|${m.title}|${m.selectionReason}|${s.papers.length}／${s.papers.filter(p=>p.abstract).length}|${s.window}个月|[官方个人页](${m.source.url})|\n`;}
report+='\n## 数据限制\n\n- 各机构官方定位来自研究所官网、学院机构建设报道、教学中心及公共平台介绍；部分报道覆盖多个单位，摘要保留这一范围，不据此混淆机构归属。近期观察仅代表已收录样本。\n- 预置解读只基于已获取的公开摘要，缺摘要条目不生成完整解读。\n- 不自动把学术索引中的同名作者档案视为准确；已排除可识别的异机构、异领域误归属。首次在线日期未确认时保留日期备注。\n- 当前没有收录经核验的个人体验反馈，页面明确留空。\n- 无法证明全量检索完整性，不把未找到论文解释为教师没有科研活动。\n';
writeFileSync('docs/第一阶段选人审阅表.md',report);console.log(`${institutes.length}机构，${mentors.length}人员，${mentors.reduce((s,m)=>s+selectRecent(m.papers,new Date('2026-10-20T23:59:59Z')).papers.length,0)}篇近期论文`);
