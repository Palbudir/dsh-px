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

`dsh-px` 在构建时会把下列软件装配进生成的 `runtime/` 目录（该目录不入库）：

| 组件                                                                                                                        | 许可         |
| --------------------------------------------------------------------------------------------------------------------------- | ------------ |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`@deepseek-ai/dsh`）及其全部 `@deepseek-ai/*` 传递依赖 | MIT          |
| [Node.js](https://nodejs.org)                                                                                               | MIT 及其他   |
| `dshmarket`、`dsh-better-sidebar`、`dsh-mermaid-render`、`dsh-find-plugin`                                                  | 各自上游许可 |

打包产物会再分发这些组件，因此在分发二进制前请逐一核对各上游许可要求。

DSH-PX 对 `dsh-better-sidebar 0.19.1` 的宿主入口应用版本及摘要限定的终端生命周期兼容补丁；原项目采用 MIT 许可，版权声明为 `Copyright (c) 2026 dsh-external`。原包许可保留在运行时中，补丁来源与范围见 [插件合约](docs/PLUGINS.md)。
