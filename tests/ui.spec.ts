import { test,expect } from '@playwright/test';
test('目录搜索、机构筛选、详情三列和审阅表可用',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await expect(page.locator('.mentor-card')).toHaveCount(273);
 await page.getByRole('textbox',{name:'搜索姓名或研究方向'}).fill('戴文睿');await expect(page.locator('.mentor-card')).toHaveCount(1);await page.locator('.mentor-card').click();await expect(page.locator('.mentor-profile h1')).toContainText('戴文睿');await expect(page.locator('.paper-row')).toHaveCount(5);await expect(page.locator('.paper-header')).toContainText('通俗解读与入门');
  await page.getByRole('button',{name:'研究所导览',exact:true}).click();await expect(page.locator('.institute-card')).toHaveCount(12);await page.locator('.institute-card').first().click();await expect(page.locator('.mentor-card')).toHaveCount(3);await expect(page.locator('.institute-summary')).toContainText('尚不能覆盖整个机构');
  await page.getByRole('button',{name:'收录审阅',exact:true}).click();await expect(page.locator('.review-table tbody tr')).toHaveCount(273);await expect(page.locator('.review-table')).toContainText('正高级实验师');expect(errors).toEqual([]);
});
test('模型凭证只在内存，刷新清除；无Key给出可操作入口',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'模型设置',exact:true}).click();await page.getByLabel('API Key',{exact:true}).fill('test-session-only');await page.getByRole('button',{name:'完成',exact:true}).click();
 expect(await page.evaluate(()=>localStorage.length+sessionStorage.length)).toBe(0);await page.reload();await page.getByRole('button',{name:'模型设置',exact:true}).click();await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByRole('button',{name:'我的科研起点',exact:true}).click();await page.getByLabel('好奇的方向或想解决的问题').fill('图像质量评价');await page.getByRole('button',{name:'找到我的入门路径'}).click();await expect(page.getByRole('dialog')).toContainText('连接你的模型');
});
test('匹配结果与追问进度能正确呈现（模拟模型结果）',async({page})=>{
 await page.goto('/');const catalog=await (await page.request.get('/api/catalog')).json();const m=catalog.mentors[0];
 await page.getByRole('button',{name:'模型设置',exact:true}).click();await page.getByLabel('API Key',{exact:true}).fill('test-key');await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.route('**/api/match',r=>r.fulfill({json:{taskId:'ui-match'}}));await page.route('**/api/tasks/ui-match',r=>r.fulfill({json:{id:'ui-match',kind:'个人匹配',status:'complete',steps:[{label:'核验引用完成',at:''}],createdAt:'',result:{recommendations:[{mentorId:m.id,reason:'根据你的基础，可以先了解数据重建。',gaps:['概率统计'],firstPaperId:m.papers[0].id,firstTask:'对一条时间序列插值',weeks:['画出数据','加入缺失','比较方法','整理报告'],citations:[m.source.id]}],sources:[m.source],limitations:'不代表招生名额。'}}}));
 await page.getByRole('button',{name:'我的科研起点',exact:true}).click();await page.getByLabel('好奇的方向或想解决的问题').fill('数据重建');await page.getByRole('button',{name:'找到我的入门路径'}).click();await expect(page.locator('.recommendation')).toHaveCount(1);await expect(page.locator('.week-plan li')).toHaveCount(4);await expect(page.locator('.recommendation .source-links a')).toHaveCount(1);
});
test('手机与桌面无横向溢出，截图留存供审阅',async({browser})=>{
  for(const [label,width,height] of [['desktop',1440,1050],['compact',900,1000],['mobile',390,844],['narrow',360,800]] as const){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});await page.goto('/');await page.locator('.mentor-card').last().waitFor();await page.evaluate(()=>document.fonts.ready);await expect(page.locator('header')).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:`docs/screenshots/${label}-home.png`,fullPage:false});
  await page.locator('.mentor-card').first().click();await expect(page.locator('.paper-row')).toHaveCount(5);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:`docs/screenshots/${label}-mentor.png`,fullPage:false});await page.close();
 }
});

test('追问回答渲染Markdown，放大字号后桌面和手机仍可阅读',async({page})=>{
 const answer=[
  '## 建议先学的基础',
  '',
  '1. **通信原理**：涉及信号传输、调制解调和信道编码。',
  '2. **概率统计**：帮助理解噪声与误码率。',
  '',
  '> 先从一个可以运行的小实验开始。',
  '',
  '用 `Python` 画一段信号，参考[学习资料](https://example.com/learning)。',
  '',
  '| 课程 | 学习内容 | 可检查的产出 | 下一步 |',
  '| --- | --- | --- | --- |',
  '| 通信原理 | 信号传输与调制解调 | 画出调制前后的波形 | 比较不同噪声条件 |',
  '',
  '```python',
  'print("hello signal")',
  '```',
  '',
  '[无效链接](javascript:alert(1))',
  '<script>alert("unsafe")</script>',
  '![外部图片](https://example.com/tracking.png)',
 ].join('\n');
 for(const [label,width,height] of [['desktop',1440,1050],['mobile',390,844]] as const){
  await page.setViewportSize({width,height});await page.goto('/');
  await expect(page.locator('.mentor-card')).toHaveCount(273);
  expect(await page.locator('body').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(16.1,1);
  await page.getByRole('button',{name:'模型设置',exact:true}).click();
  await page.getByLabel('API Key',{exact:true}).fill('test-ui-only');
  await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.route('**/api/chat',r=>r.fulfill({json:{taskId:'ui-markdown'}}));
  await page.route('**/api/tasks/ui-markdown',r=>r.fulfill({json:{id:'ui-markdown',kind:'证据问答',status:'complete',steps:[],createdAt:'',result:{answer,citations:[],sources:[],gaps:[]}}}));
  await page.locator('.mentor-card').first().click();
  await page.getByRole('button',{name:'继续追问',exact:true}).first().click();
  await page.getByRole('button',{name:'基于证据回答',exact:true}).click();
  const content=page.locator('.answer-text');
  await expect(content.locator('h2')).toHaveText('建议先学的基础');
  await expect(content.locator('ol>li')).toHaveCount(2);
  await expect(content.locator('strong').first()).toHaveText('通信原理');
  await expect(content).not.toContainText('**');
  await expect(content.locator('table')).toHaveCount(1);
  await expect(content.locator('pre code')).toContainText('print("hello signal")');
  await expect(content.getByRole('link',{name:'学习资料'})).toHaveAttribute('href','https://example.com/learning');
  await expect(content.locator('script,img,a[href^="javascript:"]')).toHaveCount(0);
  expect(await content.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await content.scrollIntoViewIfNeeded();
  await page.screenshot({path:`docs/screenshots/${label}-markdown-answer.png`,fullPage:false});
 }
});
