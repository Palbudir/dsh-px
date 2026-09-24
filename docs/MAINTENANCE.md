# 本机数据维护

这些命令面向仓库维护者，只处理显式选择的记录。它们不会成为 Agent 工具，也没有删除数据的 HTTP 接口。

从仓库目录运行。`--user-data` 是桌面应用的数据目录，工具只支持其中的标准 `dsh-home` 布局。实际目录可从应用设置中查看。先运行 `help` 了解参数；下面的路径与 ID 均需替换成自己的值。

## 停机要求

列表与状态查询只读。制定和执行维护计划、恢复及清理前，必须等待任务结束并正常退出目标桌面应用。工具核对正常停机记录及桌面、Agent PID；进程仍存在、记录缺失或状态不确定时拒绝操作，不提供跳过检查的开关。

维护与插件迁移使用同一把互斥锁。维护期间新启动的应用不能越过数据准备阶段；未完成事务会阻止原生服务启动，避免读取部分更新的数据。不要同时手工启动共享该数据目录的独立 DSH。

## 清理旧 profile 备份

```powershell
node scripts/run.mjs manage-backups list --user-data 'C:\Path\To\Data' --offset 0 --limit 20
node scripts/run.mjs manage-backups plan --user-data 'C:\Path\To\Data' --id '<备份ID>'
node scripts/run.mjs manage-backups apply --user-data 'C:\Path\To\Data' --plan '<计划ID>' --confirm '<计划给出的确认值>'
```

每个待删除备份都要单独提供 `--id`。计划列出目标和受保护的备份，执行时再次检查。每个 profile 最近两份完整备份始终保留；未知记录、外部路径、根目录链接和未完成迁移都会使操作停止。

清理是永久删除所选旧依赖备份。目录先移到同一数据目录内的隔离位置，再逐项删除；内部 Junction 和符号链接只移除链接本身，不进入目标目录。中断后可以继续同一事务。

## 归档隔离测试记录

```powershell
node scripts/run.mjs archive-qa list --user-data 'C:\Path\To\Data'
node scripts/run.mjs archive-qa plan --user-data 'C:\Path\To\Data' --session '<会话ID>' --schedule '<暂停任务ID>'
node scripts/run.mjs archive-qa apply --user-data 'C:\Path\To\Data' --plan '<计划ID>' --confirm '<计划给出的确认值>'
```

只选择能够确认工作目录位于当前仓库 `build-test` 内的会话。工具只解析独立的 Zstd 首帧会话头，不读取后续对话帧；未知格式和有歧义的 ID 不进入计划。计划之后有新增日志或业务数据时，旧计划失效。

会话通过原生归档标志隐藏，日志和工作区归属保持原样。只能归档指向这些测试会话、已暂停且没有未结算投递的定时任务。私有归档只保存所需标识和暂停任务，不复制批注正文、对话或模型凭据。

## 恢复与中断处理

```powershell
node scripts/run.mjs archive-qa info --user-data 'C:\Path\To\Data' --id '<归档ID>'
node scripts/run.mjs archive-qa restore --user-data 'C:\Path\To\Data' --id '<归档ID>' --confirm '<恢复确认值>'
```

恢复只撤销本次加入的会话归档标志；原本已经归档的会话继续保持原状。任务恢复为暂停状态，不自动补发。新增记录会保留，同 ID 的不同任务不会被覆盖。原测试文件夹已删除时仍可恢复日志可见性，但工具不会重建项目文件。

中断后用对应入口的 `status` 查看事务及确认值，再使用 `recover --confirm '<恢复确认值>'` 继续。若数据已经变化，恢复停止并保留现场。核对后可用 `keep-current --confirm '<保留当前数据确认值>'` 结束未完成事务；此操作保留当前数据和私有恢复记录，不声称已经回滚或全部清理完毕。随后可针对归档单独恢复。

计划、归档和维护回执位于用户数据中的 `dsh-home/backups/maintenance`，不得提交到公开仓库。清理旧依赖备份与恢复 QA 记录是不同操作；被明确删除的旧依赖备份不能通过 QA 恢复命令找回。
