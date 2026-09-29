# DSH-PX

DSH-PX 是面向 Windows 本机工作的 Agent 工作能力，基于 DeepSeek Harness（DSH）的原生插件架构。它由两个独立发布的产品组成：

- **DSH-PX Pack**：原生 DSH 插件整合包，提供会话标签、执行记录、产物、批注、定时任务和运行诊断，可在 `dsh web` 与 PX Desktop 中使用。
- **DSH-PX Desktop**：以锁定版本的官方 Desktop 源码为基础构建的 Windows 客户端，首次启动自动安装同版本 Pack。

> 本项目为第三方客户端，与深度求索（DeepSeek）无从属、合作或授权关系。品牌与依赖说明见 [NOTICE.md](NOTICE.md)。

## 使用

从 [GitHub Releases](https://github.com/Palbudir/dsh-px/releases) 获取已发布的预览版本：`desktop-v<版本>` 为 Desktop 安装程序，`pack-v<版本>` 为 Pack 归档。模型访问需要自行配置提供商和凭据，具体项目仍可能需要 Git、包管理器或语言运行环境。

1. 安装并打开 DSH-PX Desktop，按欢迎页配置模型提供商。
2. 添加本机项目文件夹，新建会话并描述任务。
3. 按提示审阅工具权限，在文件、终端、执行记录及文件变动面板检查结果。

Pack 也可以通过原生插件管理器安装到 `dsh web`。**设置 → 运行与帮助**显示当前连接、依赖和网页读取诊断；**设置 → DSH-PX 版本**显示 Pack 版本并检查签名更新清单。

## 与旧客户端的关系

旧版 DSH-PX（`v0.1.0-beta.re.*`）是另一套已停止开发的 Electron 外壳，继续按原方式使用，不会收到新产品的更新。新 Desktop 使用独立的应用身份、安装目录和数据目录（`%USERPROFILE%\.dsh-px`），两者可以并行安装。历史版本与资产保持不变。

## 更新与数据

Desktop 通过签名更新清单检查新版本；更新只选择完整安装包，不使用差分下载。Pack 更新只做提示，在插件管理器中安装新版本后按提示重启服务。

模型、会话、凭据与插件业务数据保存在 `%USERPROFILE%\.dsh-px`。卸载 Desktop 时始终保留这个目录，安装器不提供删除选项；需要清理时请先备份后手动处理。界面缓存（`%APPDATA%\dsh-px-desktop`）和更新下载缓存会随卸载删除，其中不含会话与凭据。不要将凭据、会话或项目文件放入发布包。

## 开发

需要 Node 24 或更新的兼容版本、npm 和 Git。

```powershell
npm ci
npm run build
npm run test
```

提交与检查见 [CONTRIBUTING.md](CONTRIBUTING.md)，产品与版本边界见 [EDITIONS.md](docs/EDITIONS.md)，构建结构见 [PACKAGING.md](docs/PACKAGING.md)，发布门禁见 [RELEASING.md](docs/RELEASING.md)。

## 范围

当前面向 Windows 本机使用，不承诺跨平台安装、远程多人服务或云端常驻。安装程序未进行 Authenticode 签名，系统可能要求确认安装；更新清单另有 PX 的 Ed25519 签名，两者不是同一种签名。用户自行添加的第三方插件可能需要 pnpm、网络或额外运行环境。

旧 Pack 中的社区插件 dshmarket、dsh-mermaid-render 与 dsh-find-plugin 首发不随 Pack 提供，后续逐个迁移到原生宿主接口；需要时可通过官方插件管理器自行安装。文件版本保护、工具权限与原生网络限制仍由 DSH 执行。

## 许可证

[MIT](LICENSE)
