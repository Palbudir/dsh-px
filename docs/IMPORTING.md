# 从旧 DSH-PX 导入会话副本

导入会话日志、附件、PX 批注和定时配置；保留原文件及父子会话标识，不覆盖目标已有会话，不复制旧凭据、模型设置或插件 Profile。已有模型配置继续使用新版设置。导入的定时任务全部暂停，核对后再启用。

先退出来源和目标应用（关闭窗口可能只是最小化到托盘，应使用“退出”）。默认来源为 `%APPDATA%\dsh-px\dsh-home`，新版目标为 `%USERPROFILE%\.dsh-px`。

在源码仓库中先预览：

```powershell
node scripts/run.mjs import-legacy "--source=$env:APPDATA\dsh-px\dsh-home" "--target=$env:USERPROFILE\.dsh-px"
```

确认会话数量且没有冲突，再执行：

```powershell
node scripts/run.mjs import-legacy "--source=$env:APPDATA\dsh-px\dsh-home" "--target=$env:USERPROFILE\.dsh-px" --apply
```

工具检查现有 Profile 锁、会话目录和附件冲突；有冲突时停止，不覆盖。每份会话先复制并校验摘要，再放入目标目录。导入清单和已有 PX 业务存储备份保存在目标 `backups/px-import-*` 中；不要将这些私人数据提交到仓库。

重新打开新版后，Pack 根据导入清单调用原生只读接口重建标题索引，并恢复普通会话的项目归属；子 Agent 保留父子关系，不另行执行。随后检查会话目录和正文。原生宿主负责读取旧日志并转换其存储格式；旧来源不会被转换。原工作文件夹已删除时，会话可能出现在“未分组”，历史文件链接也可能无法打开。导入日志不会恢复已删除的项目文件或重新启动旧命令。

若操作中途失败，先根据导入清单核对已经复制的会话，不要直接重复执行或删除整份数据目录。旧数据与目标原有会话仍保留。
