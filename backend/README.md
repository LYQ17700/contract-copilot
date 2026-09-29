# 合同避坑助手 · 后端骨架（Pod1）

两名后端可以**立刻并行**开发的工程骨架：目录边界 = 人员分工，模块之间只通过 `src/domain/contracts.mjs` 里的数据结构通信。

当前状态（已在本机验证）：`npm test` 17 用例全绿；`npm start` 后用真实 PDF 走通「上传 → 提取 → 切条款 → 风险识别(mock)」。

## 30 秒跑起来

```powershell
cd contract-copilot/backend
npm start          # 或 node server.mjs      → http://127.0.0.1:5180/health
npm run dev        # 带 --watch
npm test           # node --test，零依赖
npm run todo       # 列出所有待填槽位（可按人过滤：npm run todo 后端B）
node tools/smoke.mjs ../data/samples/租房合同-含坑.pdf   # 需服务已启动
```

没有 npm 也能跑：`node server.mjs`、`node --test`、`node tools/list-todo.mjs`、`node tools/smoke.mjs`。

零依赖：不需要 `npm install` 就能跑。PDF/DOCX 解析库通过 `src/lib/runtime-deps.mjs` 自动定位（本机运行时目录或 `backend/node_modules`）。正式化时执行 `npm i pdfjs-dist jszip` 即可，代码不用改。

## 目录与归属

| 路径 | 归属 | 职责 |
| --- | --- | --- |
| `server.mjs` | 后端 A | 组装根：注入依赖、中间件链、启动 |
| `src/config/index.mjs` | 后端 A | 环境变量集中读取 + 启动期校验（自带极简 .env 解析） |
| `src/http/` | 后端 A | 路由、上下文、multipart、中间件（request-id / 日志 / CORS / 错误） |
| `src/ingest/` | 后端 A | 接收与保管文件、sha1 去重、解析器注册表、PDF/DOCX/TXT 解析 |
| `src/jobs/` | 后端 A | 异步任务表（内存实现，接口按可换 Redis/DB 设计） |
| `src/textproc/` | 后端 B | OCR Provider、文本归一化、条款切分、回流文本与偏移映射、流水线编排 |
| `src/domain/` | 共用 | 数据契约 + 错误类型（改这里必须群里同步） |
| `src/observability/` | 共用 | 结构化日志 |
| `src/analyze/pod2.client.mjs` | 共用 | 与 Pod2 的调用边界（mock / remote 可切） |
| `tests/` | 共用 | 契约、文本处理、HTTP 三条线 |

## 两人怎么并行不挡彼此

1. **契约先行**：A 产出 `ParsedDocument`，B 产出 `PreprocessedDocument`，字段与不变量都写在 `src/domain/contracts.mjs`，并有 `tests/contracts.test.mjs` 守着。
2. **stub 先通**：`OCR_PROVIDER=stub` 时图片链路返回带标记的占位文本，B 可以慢慢换 `tesseract` / `vision-llm`，A 的代码一行不用改（`src/ingest/parsers/image.parser.mjs` 只调 Provider 接口）。
3. **边界固定**：扫描件判定在 A（`pdf.parser.mjs` 发现无文字层 → 转 OCR），识别能力在 B（缺语言包/缺 Key 时抛 `NotImplementedError`，`/health` 会如实报告而不是把服务搞崩）。
4. **各自 DoD**：
   - 后端 A：`POST /api/v1/documents` 支持 multipart 与 JSON 文本；413/415/400 分支有测试；上传大文件不 OOM。
   - 后端 B：任意真实合同（含扫描件）都能出 `clauses[]` 且 `start/end` 与原文严格对齐（这条必须有测试，前端高亮全靠它）。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 依赖与 OCR 能力探测（只查本地依赖，不真调 OCR）、解析器清单、Pod2 模式 |
| GET | `/version` · `/__routes` | 版本 / 路由表（联调对账用） |
| POST | `/api/v1/documents` | 上传（multipart `file` 字段）或粘贴（JSON `{text}`）→ 201 |
| GET | `/api/v1/documents` · `/api/v1/documents/:id` | 列表 / 详情 |
| POST | `/api/v1/documents/:id/extract` | 提取文字 + 切条款；`?async=1` 返回 202 + jobId |
| POST | `/api/v1/documents/:id/analyze` | 端到端：提取 + 风险识别 |
| GET | `/api/v1/jobs` | 任务列表（新→旧，`?limit=` 上限 200） |
| GET | `/api/v1/jobs/:id` | 异步任务状态与步骤耗时 |

```bash
curl -F "file=@../data/samples/租房合同-含坑.pdf" localhost:5180/api/v1/documents
curl -X POST localhost:5180/api/v1/documents/<id>/extract
curl -X POST localhost:5180/api/v1/documents/<id>/analyze
```

## 任务与运维

- `?async=1` 立即返回 202（不再先等解析跑完），解析在后台执行，步骤进度实时写回任务，前端轮询 `GET /api/v1/jobs/:id` 即可。
- 任务表 TTL 与清理周期由 `JOB_TTL_MIN` / `JOB_SWEEP_MIN` 控制，进程内定时器自动 sweep，无需外部调度。
- `SIGINT` / `SIGTERM` 优雅退出：停止接收新请求 → 释放常驻 OCR worker → 退出；10 秒内没退完则强制结束。
- `/health` 的 OCR 探测走各 Provider 的 `ready()`，只查本地依赖（模块 / 语言包 / API Key），不会发起任何外部调用；结果形如 `{ ready, reason?, worker?, placeholder? }`。

**给前端的约定**：`preprocessed.flow` 与 `preprocessed.map` 是服务端内部索引（长度≈字符数），**不下发**；高亮用 `clauses[].start/end` + `findings[].start/end`，单位是 `preprocessed.text` 的字符下标。

## 待填槽位

`npm run todo` 会列出全部 `@todo(...)`，当前重点：

- `后端A-1` multipart 改流式落盘（现在整体进内存，12MB 上限）
- `后端A-2` 解析超时与失败重试；PDF 首次加载 pdfjs 约 3s，需要预热
- `后端A-3` 任务表换持久化 + worker 并发
- `后端A-4` 与 Pod2 对齐 `/v1/analyze` 正式契约（字段名、错误码、幂等键）
- `后端B-1/2` tesseract worker 常驻复用、识别超时、多页 TIFF 与矫正
- `后端B-3` 视觉模型转写链路与 Pod2 联调
- `后端B-4` 更多条款编号体系（`一、`、`附件一`、`Article 3`）与条下款/项

## 设计取舍

- **为什么先不引框架**：课程项目最大的成本是环境，`node server.mjs` 直接可跑，评审机器上也不会翻车。中间件签名 `(ctx, next)` 与 Koa/Express 一致，真要换 Express 只需替换 `server.mjs` 与 `src/http/*`，控制器与业务层不动。
- **不写死依赖**：解析库通过运行时定位，`npm i` 之后自动走 `backend/node_modules`。
- **一切可回滚**：`domain/contracts.mjs` 是唯一事实来源；新增字段先加契约 + 测试，再动实现。
- **下一步**：持久化（SQLite/PG）、真正的任务队列、限流与鉴权、文件加密与到期清理（隐私专员要求）。

## 与原型的关系

上一级目录 `contract-copilot/` 是可运行的原型（含前端与已验证的规则引擎/法条库）。本骨架把原型里跑通过的 PDF/DOCX/预处理实现搬了过来并标注「已验证」，同时把 OCR、异步任务、Pod2 调用留成清晰槽位——即“原型验证过的部分直接复用，没做的部分有明确位置”。
