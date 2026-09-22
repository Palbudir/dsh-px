# DSH-PX re.0.7 本机验收

本轮目标是项目任务交接与可核对的执行证据，不代表已达到 Codex、Cursor 或 Trae Work 的全部成熟度。

- 开发分支：feat/task-evidence；PR：https://github.com/Palbudir/dsh-px/pull/3。
- 三套 TypeScript 检查通过，33 项行为测试通过。
- 官方组合树与真实启动检查通过，新增第三个自制插件 dsh-px-taskflow。
- 独立开发实例：端口 3099，用户目录 build-test/taskflow-qa。
- 真实模型：DeepSeek-V41-Flash / High / 标准模式 / 工作区内修改。
- 项目：build-test/taskflow-project。用户需求不指定新工具，要求修复购物金额计算并保留测试。
- 复现：修复前 3 条测试中 2 条失败；npm test 曾因 DSH 沙箱的子进程管道限制失败，Agent 如实报告并执行同一测试文件进行验证。
- 修改：total.js 仅一行，把 price + quantity 改为 price * quantity；total.test.js 未变。
- 验证：Agent 通过两种方式运行原 3 条测试，3/3 通过；仓库外部独立 node --test 复跑也为 3/3。
- 任务侧栏：自动收集 16 条实际执行记录及 1 个文件工具路径，保留命令失败状态。
- 交接：Agent 通过 task_review/task_checkpoint 写入记录；重启服务后从原会话恢复并追加失败复现的证据，未重复修改项目文件。
- 界面：900×600 时面板 clientWidth=scrollWidth=436；长总结折叠，记录可滚动。
- 独立 QA 实例已停止，测试凭据副本已删除；正式用户凭据未改动。

## 原安装版升级验收（2026-09-22）

- PR #3 已合并，提交 c8056e9c9b6ce9df1bf0690af75fe4b73e193e2f；本地 master 干净。
- Windows / Linux PR CI 通过；Release 流水线 35634433128 通过，v0.1.0-beta.re.0.7 已公开发布，包含安装器、ZIP、blockmap 和 latest.yml。
- 从 re.0.6 应用内点击检查更新、重启并安装；下载成功，旧进程退出，安装器自动完成并启动 re.0.7。安装约 8 分钟，Agent 服务于 02:07:25 恢复。
- 安装目录：C:\Users\Administrator\AppData\Local\Programs\dshpx-test\DSH-PX。桌面窗口标题和运行时清单确认 re.0.7。
- 正式用户配置中的 updater、workbench、taskflow 均为 re.0.7，服务端和客户端产物齐全，无指向源码目录的符号链接。
- settings.yaml、.credentials.yaml、用户 cordis.patch.yml 和两份原 dsh-px 会话的 SHA-256 与备份完全一致；四个既有社区插件依赖声明不变。
- 已安装应用的侧栏能读取 re.0.6 验收会话里的 3 条旧工具记录及 1 个文件操作路径。
- 在该验收会话运行真实模型：仅调用 task_review、task_checkpoint，成功保存目标、既有结果与 3 条真实证据引用；没有重复执行命令、写文件或调用子代理。模型明确旧文件验收发生在 re.0.6。
- 安装版页面确认：任务进展显示交接点；版本与更新显示当前 / 最新均为 re.0.7，状态统一为已是最新版本；运行与帮助的诊断默认折叠。
- 原 3080 服务保持不变；当前桌面安装版服务位于 3081。升级备份索引：build-test/taskflow-release-backup.json；原会话哈希索引：build-test/taskflow-original-sessions.json。

此次验收覆盖任务记录、真实执行证据、重启恢复、旧会话兼容与安装更新链路。尚未覆盖复杂多文件任务、多日运行、完整审阅反馈闭环，不据此宣称已达到成熟竞品的全部能力。
