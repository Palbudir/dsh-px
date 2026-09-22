# 来源与证据登记

检索/核对日期：2026-09-22。产品能力参照使用厂商官方文档；DSH-PX 的现状使用本机实际装配、源码及评测。官网描述表示厂商提供该能力，不代表所有平台、套餐、模型或当前账号都可用，也不代表本轮做过竞品同题实测。下列资料不是安装新插件、开通服务或改变权限的授权。

## 产品官方资料

<a id="r01"></a>

- **R01 · OpenAI 功能总览**：[Features](https://learn.chatgpt.com/docs/features)。原 `developers.openai.com/codex/app/features` 本次跳转至此；页面同时出现 Codex 与 ChatGPT 产品上下文。用作项目/会话、工具和产物入口的范围参照，不把所有 ChatGPT 功能自动当作每个 Codex 客户端已有功能。

<a id="r02"></a>

- **R02 · OpenAI 代码审阅**：[Code review](https://learn.chatgpt.com/docs/code-review)。参照差异审阅、反馈、暂存/回退和审查工作流。

<a id="r03"></a>

- **R03 · OpenAI 工作树**：[Git worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)。参照任务隔离和工作目录交接；不能把 Git 命令支持直接等同于托管任务生命周期。

<a id="r04"></a>

- **R04 · OpenAI 长任务**：[Long-running work](https://learn.chatgpt.com/docs/long-running-work)。参照目标、约束、验收、转向和继续；不据此承诺无条件无限自主执行。

<a id="r05"></a>

- **R05 · OpenAI 自动化**：[Automations](https://learn.chatgpt.com/docs/automations)。参照定时和任务延续。桌面本地任务的机器可用性约束与云端机制应分别说明。

<a id="r06"></a>

- **R06 · Cursor Agent**：[Agent overview](https://cursor.com/docs/agent/overview)。参照项目调查、代码修改、工具使用、运行中指导等完整任务能力。

<a id="r07"></a>

- **R07 · Cursor 搜索**：[Search](https://cursor.com/docs/agent/tools/search)。本次文档描述 Instant Grep 等代码搜索；不可沿用“其当前搜索必然基于向量 embedding”的过时假设。DSH-PX 索引方案仍应通过本机任务比较后选择。

<a id="r08"></a>

- **R08 · Cursor 计划**：[Plan mode](https://cursor.com/docs/agent/plan-mode)。参照调查、澄清、计划编辑和执行切换。

<a id="r09"></a>

- **R09 · Cursor 浏览器**：[Browser](https://cursor.com/docs/agent/tools/browser)。参照实际页面操作、截图和调试信息；这与网页 iframe 展示的能力层级不同。

<a id="r10"></a>

- **R10 · Claude Code 扩展能力**：[Features overview](https://code.claude.com/docs/en/features-overview)。参照 Skills、子任务、LSP、MCP、hooks 与插件的组合；报告中的 DSH 实现路线是我们自己的适配判断。

<a id="r11"></a>

- **R11 · Claude Code 记忆**：[Memory](https://code.claude.com/docs/en/memory)。参照项目规则与跨会话记忆的区别、作用范围和可管理性。

<a id="r12"></a>

- **R12 · Cursor 执行与权限**：[Run Modes](https://cursor.com/docs/agent/security/run-modes)。参照审批策略与沙箱边界分工。自动审查分类器不是安全边界，不能据此省略本机工具隔离。

<a id="r13"></a>

- **R13 · Claude Code 检查点**：[Checkpointing](https://code.claude.com/docs/en/checkpointing)。参照代码/对话恢复，以及文件快照对外部副作用的限制。DSH-PX 的 `task_checkpoint` 当前只是工作记录。

<a id="r14"></a>

- **R14 · Claude Code MCP**：[MCP](https://code.claude.com/docs/en/mcp)。参照服务器配置、连接、认证及工具接入；具体协议能力须以 DSH 已实现范围为准。

<a id="r15"></a>

- **R15 · Trae Work 工作流**：[Web 与桌面端快速上手](https://docs.trae.cn/work_trae-work-web-and-desktop-quickstart)。参照任务摘要、待办、上下文、产物与预览，以及文档、表格、幻灯片等工作成果；不能用“能生成文件”替代格式与内容验收。辅助范围核对：[Trae Work 概览](https://docs.trae.cn/work_what-is-trae-work?_lang=zh)、[产品介绍](https://docs.trae.cn/ide_trae-solo-is-now-available)。

<a id="r16"></a>

- **R16 · GitHub Copilot 云 Agent**：[About cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)。参照调查、分支、修改、测试和 PR 反馈闭环。云环境本身属于比较范围，当前 DSH-PX 不投入云端部署。

<a id="r17"></a>

- **R17 · Claude Code 钩子**：[Hooks reference](https://code.claude.com/docs/en/hooks)。参照执行前参数检查和执行后事件处理；后置文件变动通知不能阻止已经发生的写入。

## DSH-PX 与 DSH 本机依据

源码基线：`c8056e9c9b6ce9df1bf0690af75fe4b73e193e2f`；桌面/自制插件 `0.1.0-beta.re.0.7`，DSH `0.1.5-rc.2`，Node `24.16.0`。运行时文件位于未入库的 `runtime/`，这些链接用于本机查阅；远程仓库读者可核对对应发布版本的 npm 包和 [官方 DSH 仓库](https://github.com/deepseek-ai/deepseek-harness)。

<a id="c01"></a>

- **C01 · 任务证据实现**：[evidence.ts](../../packages/dsh-px-taskflow/src/evidence.ts)、[插件宿主](../../packages/dsh-px-taskflow/src/index.ts)、[行为测试](../../test/taskflow.test.ts)。80 条展示窗口、文本退出码判断、路径归因、stale 与 404 均可定位到此。

<a id="c02"></a>

- **C02 · 桌面、运行帮助与更新**：[外壳](../../src/main/index.ts)、[工作台插件](../../packages/dsh-px-workbench)、[更新插件](../../packages/dsh-px-updater)、[发布流程](../RELEASING.md)。本次评测连接原安装版的 3081 服务；最初用户提供的 3080 未被关闭或替换。

<a id="c03"></a>

- **C03 · better-sidebar 0.19.1**：[本机 README](../../runtime/dsh-home/profiles/web/node_modules/dsh-better-sidebar/README.md)、[社区项目](https://github.com/omdsh-dev/DSH-better-sidebar)。文件/编辑器、PDF/HTML 预览、终端、Git diff/stage/commit/worktree、作业与子任务视图是已有基础；本轮实际点验的是 Git 列表与 unified diff。Office 扩展不因 README 提到生态插件就视为已经装配。

<a id="c04"></a>

- **C04 · 标准预设与执行**：[standard agent 配置](../../runtime/dsh/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml)、[pwsh 文档](../../runtime/dsh/node_modules/@deepseek-ai/dsh-tool-pwsh/README.zh.md)。计划、goal、subagents、workflow、文件/Shell、jobs、Skills 等按预设挂载。根组合里某工具 disabled 不能直接推出标准预设无此能力。Windows 受限 token 的命名管道约束属于已记录实现限制。

<a id="c05"></a>

- **C05 · 会话检查点**：[session-checkpoint-policy](../../runtime/dsh/node_modules/@deepseek-ai/dsh-session-checkpoint-policy/README.zh.md)。关注副作用前持久化与未知结果，不等于文件快照回滚。当前本轮只做浏览器刷新恢复；服务重启来自 C08 历史记录。

<a id="c06"></a>

- **C06 · 装配与门禁**：[stage-runtime.ts](../../scripts/stage-runtime.ts)、[verify-capabilities.ts](../../scripts/verify-capabilities.ts)、[package.json](../../package.json)。组合树和启动校验有价值，但不证明当前模型会正确使用每种能力。生产组合记录的社区版本为 dshmarket 1.48.0、better-sidebar 0.19.1、mermaid 0.1.11、find-plugin 0.3.7。

<a id="c07"></a>

- **C07 · 项目指令**：[dsh-agent-instructions](../../runtime/dsh/node_modules/@deepseek-ai/dsh-agent-instructions/README.zh.md)。支持规则发现与范围；本轮 E01 实测读取了 fixture 的 AGENTS/README。大项目、嵌套规则和持续变化仍需验收。

<a id="c08"></a>

- **C08 · 同日历史发布验收**：[原本机记录](../../build-test/TASKFLOW-VERIFICATION.md)、[保留的摘录](evidence/re07-history.md)、[PR #3](https://github.com/Palbudir/dsh-px/pull/3)、[re.0.7 Release](https://github.com/Palbudir/dsh-px/releases/tag/v0.1.0-beta.re.0.7)。包括此前 33 项测试、安装更新、原配置/会话保持及服务重启恢复；不计作本轮重新执行。

<a id="c09"></a>

- **C09 · 基线文档漂移**：[旧 README](https://github.com/Palbudir/dsh-px/blob/c8056e9c9b6ce9df1bf0690af75fe4b73e193e2f/README.md)、[旧 ROADMAP](https://github.com/Palbudir/dsh-px/blob/c8056e9c9b6ce9df1bf0690af75fe4b73e193e2f/docs/ROADMAP.md)、[产品目标](../PRODUCT.md)。旧“官方能力是上限”等描述在本轮路线图修订中纠正。

<a id="c10"></a>

- **C10 · 搜索/抓取与代理**：[web-fetch-http](../../runtime/dsh/node_modules/@deepseek-ai/dsh-web-fetch-http/README.zh.md)、[实际实现](../../runtime/dsh/node_modules/@deepseek-ai/dsh-web-fetch-http/lib/index.js)、[tool-web](../../runtime/dsh/node_modules/@deepseek-ai/dsh-tool-web/README.zh.md)。直接抓取进行公开 IP 校验与地址固定，实现中已有 proxyRouteFor 分支。E10 证明本机实际仍走入非公网解析拒绝路径；配置原因尚待后续定位。

<a id="c11"></a>

- **C11 · DSH MCP 基础**：[mcp-client](../../runtime/dsh/node_modules/@deepseek-ai/dsh-mcp-client/README.zh.md)。默认无服务器，只桥接工具，不支持 MCP resources/prompts；当前部署不能仅因包存在就宣称 MCP 已开箱可用。

<a id="c12"></a>

- **C12 · DSH 定时基础**：[schedule](../../runtime/dsh/node_modules/@deepseek-ai/dsh-schedule/README.zh.md)。可选 overlay 的根会话提醒/继续工作机制；当前未启用，冷会话与最低重复间隔等限制需考虑，不等价独立后台任务调度器。

## 证据编号约定

`Rxx` 是外部官方参照；`Cxx` 是源码/部署/历史依据；`Exx` 是 [本轮评测](evaluations.md)。功能编号的 `Lxx` 专指长期功能，与证据编号不混用。外部来源链接应在未来实施前重新检查；本报告冻结为本次调查快照。
