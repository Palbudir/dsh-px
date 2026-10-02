# GitHub 维护

本项目采用个人维护流程：分支与小 PR、一次有重点的独立 DeepSeek Flash 审查、普通 CI、本机验收，然后发布。其他适合委派的 agent 工作也优先使用 DS Flash。

## 必需检查

[protection.json](protection.json) 要求 GitHub Actions 的 `quality (windows-latest)` 和 `quality (ubuntu-latest)`。保持主分支保护、禁止强制推送及删除。源码审查由独立 agent 完成，记录精确提交、范围和结论；维护者在合并前核对，不再依赖专用 App 的自动判定。

候选稳定后审查当前 PR 增量。修复只复核受影响部分，不把每次小改动变成全仓审计。遇到疑点先核对真实合约和运行结果；误报应保留依据并明确说明，不能靠添加无用依赖来迎合模型。确认影响本机使用、数据或升级的问题先修复，其余建议单独排期。

## 构建与发布

`verify.yml` 执行普通 CI。`release.yml` 由维护者针对受保护主分支的精确 SHA 和产品标签手动触发，只构建和上传 Actions 产物，不发布、不读取签名密钥。

核对独立审查、CI、资产摘要与实际安装后，使用正常 GitHub Release 发布预览版。产品更新清单仍在本机离线签名；旧客户端的 Latest 和历史资产不改变。具体步骤见 [RELEASING.md](../RELEASING.md)。

## 停用的重复链路

`review-request.yml` 和 `trusted-quality.yml` 已停用，不作为当前门禁。仓库外旧 review worker 的自动启动应关闭。原专用 App 检查、证明和历史失败记录保留，不伪造成功，也不作为当前发布条件。

旧 `review-*` 和专用 `release-controller.mjs` 脚本不再是推荐维护入口；其历史实现与测试暂保留，避免把一次发布收尾扩大成审查框架重写。无需重新部署 worker、修改 App 权限或创建另一套签名审查系统。
