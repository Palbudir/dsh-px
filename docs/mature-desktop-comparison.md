# 与成熟桌面客户端的横向对照

这份文档记录**实测**过的对照结论，用来回答"成熟产品在这里怎么做"，
避免再凭感觉做决定。

对照对象（本机实际安装的，逐项读取磁盘与注册表）：

| 产品 | 安装器 | 卸载器 | 更新机制 |
|---|---|---|---|
| Cursor 3.21.16 | Inno Setup | `unins000.exe` | `tools\inno_updater.exe`（逐文件替换，**不重跑安装器**） |
| Trae CN 3.3.76 | Inno Setup | `unins000.exe` | 同上 + `resources\app-update.yml` |
| TRAE SOLO CN | Inno Setup | `unins000.exe` | 同上 + `resources\app-update.yml` |
| Codex (OpenAI) | 无安装器 | 无 | 自带按需下载的 Node 运行时 |

## 结论 1：安装目录固定，不询问用户

三家**都不弹目录选择页**，一律装到 `%LOCALAPPDATA%\Programs\<产品名>\`。

我们此前是 `oneClick: false` + `allowToChangeInstallationDirectory: true`，
于是弹目录选择页，用户装到了 `dshpx-test\DSH-PX`。**这正是路径混乱的根源**：
更新要装回原位、卸载要能找到原位，而"原位"成了每个用户各不相同的自由变量。

已改为 `oneClick: true` + `allowToChangeInstallationDirectory: false`：
一键安装、路径固定，与对照对象一致。

## 结论 2：卸载项要写全（我们已达标）

逐字段对照控制面板的卸载项：

| 字段 | Cursor | 我们 | 判断 |
|---|---|---|---|
| `DisplayName` | ✓ | `DSH-PX` | ✓ |
| `DisplayVersion` | ✓ | ✓ | ✓ |
| `Publisher` | ✓ | `Palbudir` | ✓ |
| `UninstallString` | ✓ | ✓ | ✓ |
| `QuietUninstallString` | ✓ | ✓ | ✓ |
| `DisplayIcon` | ✓ | ✓ | ✓ |
| `EstimatedSize` | ✓ | ✓ | ✓ |
| `NoModify` / `NoRepair` | ✓ | 都是 1 | ✓ |
| `InstallLocation` | ✓ | 见下 | ✓ |

### `InstallLocation` 其实早就写好了（一次被我自己误判的"缺口"）

控制面板读的 `Uninstall` 子键里 `InstallLocation` 是空的，我因此一度判定为缺口。
**这是查错了位置。** electron-builder 把它写在**自己**的键下：

```
HKCU\SOFTWARE\{guid}
  InstallLocation = C:\Users\...\Programs\dshpx-test\DSH-PX
  KeepShortcuts   = true
  ShortcutName    = DSH-PX
```

而这个位置是**故意的**：`templates/nsis/multiUser.nsh` 里的 `setInstallModePerUser`
会读它来决定"这次装到哪里"：

```nsis
ReadRegStr $perUserInstallationFolder HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
${if} $perUserInstallationFolder != ""
  StrCpy $INSTDIR $perUserInstallationFolder
```

**这正是"静默更新能装回原位"的机制** —— 实测升级 re.0.3 → re.0.4 时它确实装回了
`dshpx-test\DSH-PX` 而不是默认路径。

所以在 `Uninstall` 子键里再补一份**没有收益**（只是让控制面板多显示一个字段），
且要付自定义 NSIS 脚本的成本。**决定不做**，并在此记录以免下次又去"补"它。

## 结论 3：VS Code 系的更新器我们套不上

Cursor / Trae 的 `inno_updater.exe` 是 **VS Code 生态专有**做法：
逐文件替换 + 差分，不需要重新运行安装器。它绑定 Inno Setup 与 VS Code 的
更新协议，Electron + NSIS 的项目无法照搬。

对 Electron，`electron-updater` + NSIS 的 `/S` 静默安装**就是正解**，
关键是参数要传对（见下）。

## 结论 4：静默更新必须传对参数（已修，有实测证据）

`electron-updater` 的 `quitAndInstall(isSilent, isForceRunAfter)`：

- **第一个参数**才决定静默。`false` 时 `doInstall()` 不追加 `/S`，NSIS 走向导。
- "退出时自动安装"内部走的是 `install(true, false)`，所以那条路一直是静默的。

实测安装器实际参数：

| | 参数 | 结果 |
|---|---|---|
| 修复前 | `--updated,--force-run` | 弹 NSIS 向导 |
| 修复后 | `--updated,/S,--force-run` | 静默 |

## 结论 5：卸载不删用户数据（我们的取舍）

`deleteAppDataOnUninstall: false` —— 卸载后 `%APPDATA%\dsh-px` 保留
（会话、插件、设置都在那里）。宁可留给用户自己删，也不静默销毁会话历史。
**尚未做**：卸载时提示"数据目录仍占用空间"。这一项仍待补。
