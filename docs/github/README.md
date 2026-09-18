# GitHub 仓库设置与保护

本目录下的 JSON 是**记录**，不是构建输入。它们保存了 `dsh-px` 仓库在 GitHub 上
实际生效的设置，以便在别处重建、或日后审计时对照。

## 当前生效的设置

| 项 | 值 | 如何设置 |
|---|---|---|
| 可见性 | **public** | `gh api -X PATCH repos/Palbudir/dsh-px -f private=false` |
| 默认分支 | `master` | — |
| 密钥扫描 | 启用 | `.github/security.json` |
| 推送保护 | 启用（阻止把密钥推上去） | 同上 |
| 分支保护（master） | 禁止强推、禁止删除、**管理员同样受约束** | `.github/protection.json` |
| 规则集 `protect-master` | `deletion` + `non_fast_forward`，**无绕过者** | `.github/ruleset.json` |

重放命令：

```sh
gh api -X PATCH repos/<owner>/dsh-px --input .github/security.json
gh api -X PUT   repos/<owner>/dsh-px/branches/master/protection --input .github/protection.json
gh api -X POST  repos/<owner>/dsh-px/branches/master/protection/enforce_admins
RULESET_ID=$(gh api -X POST repos/<owner>/dsh-px/rulesets --input .github/ruleset.json --jq .id)
```

## 为什么是公开仓库 —— 一个实测出来的理由

**私有仓库在 GitHub 免费计划下没有分支保护。** 这不是推测，是这台机器上实测到的：

```
$ gh api repos/Palbudir/dsh-px/branches/master/protection
{"message":"Upgrade to GitHub Pro or make this repository public to enable this feature.","status":"403"}
```

同一个调用在转公开之后立刻成功。所以"公开"不只是可见性选择，
它是**解锁分支保护这一步的前置条件**。

## 能封到什么程度，以及封不住什么

必须如实说明，因为这里有一个 GitHub 层面的硬限制：

**能做的（已全部生效）**

- 任何人（包括仓库所有者自己）**都不能强推** master —— 历史不可被改写。
- 任何人**都不能删除** master 分支。
- 管理员**同样受约束**（`enforce_admins: true`），所以不存在"我手滑就毁了"的路径。
- 规则集 `protect-master` 的 `bypass_actors` 为空 —— 没有任何账号能绕过。
- 密钥扫描 + 推送保护：往仓库里推密钥会被拦下。

**做不到的（GitHub 没有提供这个开关）**

- **无法禁止他人创建分支或提交合并请求（PR）。** 在公开仓库上，任何人都可以
  fork 本仓库、在自己的 fork 里随便建分支并开 PR。GitHub 没有"关闭 PR 提交"的选项。
  `allow_forking` 这个设置项**在个人账号的公开仓库上不可用**，实测会被拒绝：

  ```
  $ gh api -X PATCH repos/Palbudir/dsh-px -F allow_forking=false
  {"message":"Allow forks setting can only be changed on org-owned private repositories","status":422}
  ```

**但这不构成风险**，原因值得说清楚：

1. 别人的分支存在于**他们自己的 fork**里，动不了本仓库的 `master`。
2. PR 只是一份**请求**。它不会自动合入，只有仓库所有者点击合并才会生效。
3. `master` 已被保护 + 无绕过者，即便有人成功合入也无法强推改写历史。

换句话说：**能提交 PR ≠ 能改动这个仓库。** 真正的写权限只属于所有者。

如果你希望连"收到 PR"都不发生，唯一的办法是把仓库改回私有 ——
代价是同时失去分支保护。这是一个真实的取舍，取决于你更看重哪一边。

## 给仓库所有者的开发流程提示

由于管理员的强推也被禁止，请注意：

- 日常提交和推送**完全不受影响**（限制的是 `--force` 和删除，不是普通推送）。
- 不要用 `git commit --amend` 去改一个**已经推送**的提交 —— 那需要强推，会被拒绝。
- 尚未推送的提交可以随意 amend / rebase。
- 推送前建议核对 `git log origin/master..HEAD`，确认要推的内容。
