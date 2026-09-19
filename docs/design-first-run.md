# 首启提速设计（P2）

## 问题

现状：首次启动把随附运行时（约 620 MB、4 万多个文件）**复制**到用户数据目录，
实测耗时 **4–5 分钟**，期间界面无响应。这是 beta 阶段最明显的体验短板。

## 已实测验证的方案（不是推测）

实验（`exp-2b`，2026-09-19）在真实环境下验证：

```
=== 用硬链接铺插件依赖 ===
  硬链接 13833 个文件，回退复制 0 个，失败 0 个
  耗时 3498 ms                      ← 3.5 秒

=== 只读 runtime + 可写 DSH_HOME ===
  status=0
  stdout=17552B（配置行 157 条）  stderr=0B
  含 dsh-base 层: true    含 dsh-px-updater 层: true
```

**结论**：
1. 「只读安装目录 + 可写 `DSH_HOME`」架构成立 —— 这正是 dsh 自身"运行本体与数据目录分离"的设计。
2. 硬链接把 13833 个文件铺好只要 **3.5 秒**，且**不额外占盘**（同一份数据，两个目录项）。

## 关键约束：DSH_HOME 必须可写

实验同时证明了一条硬约束（第一次实验的失败原因）：

```
Error: EPERM: operation not permitted, open '...\dsh-home\profiles\web\cordis.yml'
    at prepareProfile (profile-boot-Dk-7KqJc.js:209)
```

`prepareProfile` **每次启动都会重写 profile 根配置**。所以：

- ❌ 不能把 `DSH_HOME` 指向只读的安装目录
- ✅ 必须让 `DSH_HOME` 落在可写的用户目录，运行时本体保持只读

## 目标布局

```
<安装目录>/resources/runtime/          ← 只读，随安装包分发
  node/                                    便携 Node
  dsh/                                     dsh 安装（自包含，239 个嵌套包）
  dsh-home/                                种子 profile（清单 + 插件依赖）

%APPDATA%/DSH-PX/home/                 ← 可写，DSH_HOME
  profiles/web/
    package.json                          从种子树复制（几 KB）
    cordis.patch.yml / cordis.yml         从种子树复制
    pnpm-workspace.yaml                   从种子树复制
    node_modules/                         **硬链接**铺自种子树（3.5 秒，不占盘）
  sessions/ storages/ settings.yaml ...    首次启动后由 dsh 生成
```

启动方式不变：

```
runtime/node/node.exe runtime/dsh/lib/bin.js --profile web --host 127.0.0.1 --port N --no-open
  DSH_HOME = %APPDATA%/DSH-PX/home
```

## 算法

```
materialize(seed, home):
  if home 已完成播种（标记文件存在）: return          # 二次启动零开销
  1. 复制种子树的**清单文件**（package.json、cordis*.yml、pnpm-workspace.yaml）
  2. 对 seeds/profiles/<name>/node_modules 逐项：
       - 目录 → 递归
       - 符号链接/Junction → **跟随真实目标**后递归
         （开发态插件是 Junction，若不跟随会失败 —— 实验里就是这么漏掉一个插件的）
       - 文件 → fs.linkSync(src, dst)
         失败（跨卷/不支持）→ 回退 fs.copyFileSync
  3. 写完成标记
```

### 跨卷回退

硬链接仅在同一卷内有效。安装盘与数据盘不同卷时 `linkSync` 抛 `EXDEV`：

- 逐文件回退到 `copyFileSync`
- 此时耗时回到分钟级 → **必须配进度界面**（这是用户已确认接受的取舍）

因此播种过程要：
- 异步执行（不阻塞主进程事件循环 —— 现在的 `cpSync` 是同步的，会冻结界面）
- 向窗口/托盘报告进度（`已处理 N / 总计 M`）
- 失败时如实弹窗并给出日志路径

## 预期效果

| 场景 | 现状 | 目标 |
|---|---|---|
| 首启（同卷） | 4–5 分钟 | **< 10 秒** |
| 首启（跨卷） | 4–5 分钟 | 4–5 分钟 + 有进度可见 |
| 二次启动 | 秒级 | 秒级（不变） |
| 额外磁盘占用 | 一份完整副本 | **≈0**（硬链接共享数据） |

## 待验证项（P2 实现后必须实测）

1. 同卷首启实测耗时是否确实降到 <10 秒
2. 跨卷场景（可用另一分区的目录模拟）是否正确回退且进度可见
3. 硬链接树被 dsh 写入时行为是否正常（dsh 会往 `profiles/web/` 写 `cordis.yml`；
   硬链接的是 `node_modules`，清单文件是复制的，因此写入不落到只读区）
4. 卸载/更新时硬链接是否会导致"删了安装目录但数据目录仍占盘"的误解
   （实际相反：硬链接共享数据，两边都删才释放）
