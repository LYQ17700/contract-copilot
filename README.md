# 合同避坑助手 · Demo

垂直领域（住房租赁）的「合同/协议审查助理」可运行原型：上传一份合同 → 提取文字 → 抽取关键条款 → 命中风险 → 生成带**原文引用 + 法条引用**的避坑报告。

离线可跑：默认不依赖任何外部 API，规则引擎 + BM25 检索即可产出完整结果；配置 API Key 后自动叠加大模型审查。

---

## 30 秒跑起来

\`\`\`powershell
cd contract-copilot
./start.ps1            # 或直接 node server.mjs
\`\`\`

浏览器打开 <http://127.0.0.1:5178/>，点右上角任意「演示样例」按钮即可看到结果。

要求：Node.js 18+（本机已满足）。PDF/DOCX 解析复用 Codex 运行时自带的 \`pdfjs-dist\` / \`jszip\`，无需 \`npm install\`。

## 工程结构

- `server.mjs` + `src/`：可运行的原型（前后端一体，零依赖，评审机上一键演示）
- `backend/`：**Pod1 后端工程骨架**（HTTP 层、上传/解析、OCR Provider、任务表、测试与待填槽位），两名后端在此并行开发，见 `backend/README.md`

## 演示脚本（5 分钟讲法）

1. **痛点**：刚毕业的学生看不懂租房合同，人工逐字审成本高。
2. 点「含坑合同 · PDF」→ 左侧流水线展示 Pod1 解析（PDF 提取 1272 字、切出 13 条）与 Pod2 各步骤耗时。
3. 中间原文区：风险条款直接高亮，点高亮跳右侧卡片，点卡片跳回原文（可解释性）。
4. 右侧风险清单：每条都有「合同原文 / 大白话解读 / 为什么是坑 / 建议改法 / 法条依据」，并标注法条是**规则绑定**还是**BM25 检索命中**。
5. 关键条款页：押金折合月数 3、单次预付 12 个月、租期 25 年、逾期日费率 10%、电费 1.5 元/度——量化校验不是关键词匹配。
6. 知识库页：46 条法条，其中若干条标记「⚠ 条号待法学专家复核」→ 共享资源池（法学专业同学/老师）的真实工作界面。
7. 审计日志页：每次审查落一条记录（引擎、命中数、通过校验数、是否脱敏）。
8. 对照实验：点「规范合同 · TXT」→ 0 命中、评级 A。说明它不是「凡合同都吓你一跳」。
9. 导出避坑报告（.md）/ 打印存 PDF。

## 目录与 Pod 分工映射

\`\`\`
contract-copilot/
├── server.mjs                 HTTP 入口：上传接口 + 静态页 + 只读数据接口
├── src/pipeline.mjs           编排层（Pod1 → Pod2，含各阶段耗时打点）
├── src/pod1/                  文档解析组
│   ├── parse.mjs              类型分发、UTF-8/GBK 解码
│   ├── pdf.mjs                pdfjs-dist 提取（含 CJK CMap）
│   ├── docx.mjs               jszip + OOXML 提取
│   ├── ocr.mjs                tesseract.js 适配（缺语言包时明确降级）
│   └── preprocess.mjs         归一化、按「第×条」切分、偏移量映射
├── src/pod2/                  风险识别组
│   ├── kb.mjs                 RAG 检索层：中文分词 + BM25
│   ├── agent.mjs              关键条款抽取 + 量化校验 + 规则命中
│   ├── prompts.mjs / llm.mjs  提示词与可选大模型增强（Responses API）
│   ├── report.mjs             避坑报告结构化生成
│   └── trust.mjs              可信校验、PII 脱敏、审计日志
├── data/kb_laws.json           法条知识库（可编辑，含 review 标记）
├── data/risk_rules.json        风险规则库（可编辑，27 条）
├── data/samples/               含坑合同（txt/pdf）、规范对照合同（txt/docx）
├── tools/                     自测与样例生成脚本
└── outputs/                   运行期产物：报告 .json/.md、audit.jsonl（仓库内保留界面截图与 1 份示例报告）
\`\`\`

## 可信设计（Pod2「可信校验&隐私专员」）

- **强制双引用**：每条结论必须带合同原文引用 + 至少一条法条引用，否则状态降级为「待人工复核」，UI 与报告都会显式标注。
- **防编造**：法条只能来自 \`kb_laws.json\`，引用不存在的条目会被判为未通过；原文引用做去空白逐字比对，比对不上不放行。
- **专家复核标记**：\`review: "pending"\` 的条目在结论卡片、报告「待复核与局限」、审计日志三处同时出现，形成给法学专家的待办清单。
- **隐私**：落盘产物对身份证号、手机号做掩码（\`maskPii\`），审计记录只保留元数据。

## 接入真实模型 / OCR（可选）

\`\`\`powershell
# 大模型（OpenAI 兼容 Responses 接口）：叠加在规则引擎之上，同样受原文校验约束
$env:CONTRACT_COPILOT_LLM_KEY = "sk-..."
$env:CONTRACT_COPILOT_LLM_BASE_URL = "https://api.openai.com/v1"   # 可换自建/兼容网关
$env:CONTRACT_COPILOT_LLM_MODEL = "gpt-5.2"
node server.mjs

# 图片 OCR：提供本地中文语言包即可（否则前端会明确提示降级，不会假装成功）
$env:TESSDATA_PREFIX = "C:/path/to/tessdata"   # 需包含 chi_sim.traineddata
\`\`\`

依赖目录若不在默认位置：\`$env:CONTRACT_COPILOT_NODE_MODULES = "…/node_modules"\`。

## 自测

\`\`\`powershell
node tools/selftest_pod1.mjs        # 解析链路：txt / pdf / docx
node tools/selftest_pipeline.mjs    # 端到端：评级、命中数、校验结果
node tools/selftest_http.mjs        # 接口层：上传、粘贴、样例、页面
node tools/screenshot_ui.mjs        # 用本机 Chrome 跑真实 UI 并截图到 outputs/
node tools/make_sample_report.mjs     # 需服务在跑：生成 outputs/示例报告-含坑合同.md
\`\`\`

当前基线：含坑合同（PDF 与 TXT 结果一致）28 处命中、28 处通过双校验、评级 D；规范对照合同 0 命中、评级 A；非合同短文本 0 命中并提示「未识别为住房租赁合同」。

## 边界与免责声明

- 演示用产品原型，**不构成法律意见**；正式场景需执业律师复核规则库与法条库。
- 规则命中表示「值得核对」，不代表条款必然无效。
- 法条库以住房租赁、格式条款、个人信息保护为主，\`pending\` 条目的条号/表述需专家复核后再对外使用。
- 扫描件/图片型 PDF 需要 OCR 或视觉模型；当前 PDF 链路针对文字型 PDF。
