# 第三方声明与素材署名

## 应用图标

`build/icon.png` 由 `node scripts/run.mjs build-icon` 在构建时生成，源码位于
`scripts/build-icon.ts`。素材下载后按 SHA-256 校验再缩放，不纳入源码仓库。

| 项         | 内容                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| 素材来源   | [GarfieldZhung/DeepSeek-Whale-Girl](https://github.com/GarfieldZhung/DeepSeek-Whale-Girl) 的 `assets/whale/whale-maid.png` |
| 该仓库许可 | MIT                                                                                                                        |
| 素材摘要   | `20b8c0d6b580e23c88de1f01f68a1326c568edc7951f5f45ae98da3cae3c8ee6`                                                         |

上游的许可声明见 [LICENSE](https://github.com/GarfieldZhung/DeepSeek-Whale-Girl/blob/main/LICENSE)。
本项目不对素材主张原创权利；素材来源或授权问题可通过仓库 Issue 反馈。

## 为什么没有使用官方 favicon

DeepSeek Harness 自己的 `website/public/favicon.svg` 与 wordmark 是**官方品牌素材**，
其《[品牌素材使用规范](https://github.com/deepseek-ai/deepseek-harness/blob/master/BRAND_GUIDELINES.zh.md)》
明确写道：

- "请避免直接使用完整的 **"DeepSeek Harness"** 商标"；
- "避免在宣传或展示时，以容易引起误解的方式使用官方品牌素材，以免让用户产生
  **官方背书、合作或授权**等不实印象"。

所以本项目：

1. **不复用**官方 logo 路径数据；
2. 项目名使用规范建议的缩写 **"DSH"**（`dsh-px`）；
3. 在 README 顶部明确声明**非官方**、与深度求索公司无从属关系；
4. 采用社区二创的鲸鱼娘形象，而不是官方商标素材。

## 随附的第三方软件

DSH-PX Desktop 由锁定提交的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 官方 Desktop 源码构建（MIT，`Copyright (c) 2026 DeepSeek`），包含其随附的 Electron、Node.js 与 `@deepseek-ai/*` 依赖及各自许可。PX 以覆盖层修改应用身份、品牌、更新源与首次配置，不修改官方原始文件；安装界面的文字与位图由 PX 包装脚本替换，安装与卸载逻辑沿用官方实现。

0.8 的私有 Desktop 装配将宿主和桌面进程使用的 Zod 4.4.3 替换为同一官方运行包已随附的 Zod 4.6.7（MIT），修复 [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。来源逐文件校验；原始包声明保留，实际替换记录在运行包的 `px-dependency-overrides.json` 和文件摘要清单中。官方源码与已发布的社区原包不做改写。

DSH-PX Pack 随附 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 0.28.0（MIT，`Copyright (c) 2026 dsh-external`）。该版沿用上游原生认证与传输地址；PX 对固定摘要的宿主和客户端应用会话目录、文件预览及编辑状态兼容补丁，来源与范围见 [插件合约](docs/PLUGINS.md)。

“电脑操作”功能包声明以下精确版本的运行时依赖，由 DSH 插件管理器从 npm 安装，并随 Pack 分发经过摘要校验的匹配 Windows 原生驱动：

- [@trycua/cua-driver](https://github.com/trycua/cua) 0.28.0（MIT）。其 Windows 原生包 `@trycua/cua-driver-win32-x64-msvc` 声明为 MIT AND MPL-2.0，其中 `cua_driver_node_runtime.node` 源自 `uniffi-bindgen-react-native`，按 MPL-2.0 提供，源码说明随该包附带。
- [@playwright/mcp](https://github.com/microsoft/playwright-mcp) 0.0.80（Apache-2.0）及其依赖的 Playwright。浏览器使用本机已安装的 Microsoft Edge。

“接管我的 Edge”模式使用微软发布的 Playwright Extension，由用户自行从扩展商店安装，PX 不分发该扩展。

Pack 以独立社区成员声明 [dsh-context](https://github.com/bowenliang123/dsh-context) 0.75.1（Apache-2.0）、[dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon) 0.5.34（MIT）及 [@xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) 5.6.0（MIT）。社区原包核对固定 SRI 后保持原样，依赖由 DSH 原生插件管理器安装，保留上游名称、许可、版本、配置页与组件信息。

QQ 账号通道另外分发 [dsh-onebot-qq](https://github.com/mario841859784/dsh-onebot) 0.9.6 的 PX 兼容派生版本 0.9.6-px.2（BSD-3-Clause）。原始归档 SRI、源码提交与逐文件修改记录见 [QQ 来源清单](config/qq-community.json)及包内 `dshPx` 元数据；上游 LICENSE 保留。兼容层另附 PX 的 MIT 许可。QQ 文本格式化内联 Marked 16.4.2（MIT），完整许可保存在该派生包的 `LICENSE.marked`。QQ 与 NapCat 由用户另行安装，不随 Pack 分发。

PX 知识通过公开 Source 合约复用 `dsh-mnemon-source-documents` 0.5.11；经验候选、草稿、回测记录与采纳复用 `dsh-mnemon-source-skills` 0.5.1（均为同项目，MIT）。这些包、Mnemon 合约及 YAML 2.9.1（ISC）作为人格功能包的固定运行依赖安装。经验结果校验内联使用 Zod 4.6.7（MIT），完整许可随功能包保存在 `licenses/zod.txt`。

0.6 受管组合一次性采用 PX 四范围知识与 General 策略，原项目档案改为手动来源；保留用户自行安装的 Mnemon 配置及后续设置。经验整理由用户主动发起，不默认启用外部 Provider、自动历史提炼或闲时复盘，不分发 Mnemon CLI。IM 渠道需要用户另行配置自己的机器人。

分发二进制前请逐一核对各上游许可要求。

## Markdown 引用解析

工作区组件内联使用 Marked 16.4.2（MIT）解析格式化消息的可引用正文。其许可和版权声明随组件保存在 `licenses/marked.txt`。
