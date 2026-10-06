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

DSH-PX Pack 随附 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 0.24.1（MIT，`Copyright (c) 2026 dsh-external`），并对其宿主入口应用版本及摘要限定的认证补丁；补丁来源与范围见 [插件合约](docs/PLUGINS.md)。

“电脑操作”功能包不随 Pack 打包第三方代码，而是声明以下精确版本的运行时依赖，由 DSH 插件管理器从 npm 安装：

- [@trycua/cua-driver](https://github.com/trycua/cua) 0.28.0（MIT）。其 Windows 原生包 `@trycua/cua-driver-win32-x64-msvc` 声明为 MIT AND MPL-2.0，其中 `cua_driver_node_runtime.node` 源自 `uniffi-bindgen-react-native`，按 MPL-2.0 提供，源码说明随该包附带。
- [@playwright/mcp](https://github.com/microsoft/playwright-mcp) 0.0.80（Apache-2.0）及其依赖的 Playwright。浏览器使用本机已安装的 Microsoft Edge。

“接管我的 Edge”模式使用微软发布的 Playwright Extension，由用户自行从扩展商店安装，PX 不分发该扩展。

分发二进制前请逐一核对各上游许可要求。

## Markdown 引用解析

工作区组件内联使用 Marked 16.4.2（MIT）解析格式化消息的可引用正文。其许可和版权声明随组件保存在 `licenses/marked.txt`。
