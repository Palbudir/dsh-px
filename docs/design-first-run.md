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
  if home 已完成播种 且 种子身份未变: return          # 二次启动零开销
  if 种子身份变了: 覆盖式重新物化（refresh）
  1. 复制种子树的**清单文件**（package.json、cordis*.yml、pnpm-workspace.yaml）
  2. 对 seeds/profiles/<name>/node_modules 逐项：
       - 目录 → 递归
       - 符号链接/Junction → **跟随真实目标**后递归
         （开发态插件是 Junction，若不跟随会失败 —— 实验里就是这么漏掉一个插件的）
       - 文件 → fs.linkSync(src, dst)
         失败（跨卷/不支持）→ 回退 fs.copyFileSync
  3. 写完成标记（含 `seedIdentity=`）
```

### 种子身份：升级后必须重新物化（一次真实事故）

"完成标记存在就直接复用"是**错的**，因为它只看"有没有做完"，从不问"种子换了没有"。
外壳每次升级都会带来一棵**全新的种子树**，而用户的 home 会永远停在首次安装那一版。

实测后果：`0.1.0-beta.re.0.2` 装好后，**设置页里没有「DSH-PX」分区**。
物化出来的自研插件仍是 `re.0.1` 时代的 `package.json`
（858 B，缺少 `exports["./client"]` 与 `dsh.client` 声明），
客户端半边因此根本不会被加载。而日志里看起来一切正常，只有一行
`跳过 12129` 在悄悄说明整棵树都没被更新 —— 这是最难查的一类失败。

修法：

- 标记里记录 **`seedIdentity`**，取 `runtime-manifest.json` 的 `stagedAt`
  （不能用种子目录路径：它会从构建机的 `D:\a\...` 变成用户的安装目录）。
- 身份变了就 **`refresh: true`** 覆盖式重新物化：逐项**先删再写**
  （硬链接不能覆盖，且旧目标可能是上一版的文件）。
- 旧标记里没有 `seedIdentity`，读出来是 `null`，与任何真实身份都不等 ——
  因此**从旧版本升级过来的用户会被正确地刷新一次**，不需要手工删目录。

代价：用户若额外装了插件，刷新后被替换回随附版本。可接受（重新装一次即可），
但值得知道。

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

## 实现结果（2026-09-19 实测）

代码在 `src/main/materialize.ts`，单元测试在 `test/materialize.test.ts`（`npm run test`）。

| 指标 | 实测 |
|---|---|
| 物化耗时 | **5.7 秒**（硬链接 13833、复制 0、跳过 5、共 14788 项） |
| 首启到 harness 监听 | **约 14.6 秒**（含 Electron 自身启动与 harness 初始化） |
| 二次启动 | **约 7 秒**，物化被幂等快路径完全跳过 |
| 额外磁盘占用 | ≈0 |

进度反馈：窗口先显示进度页（`splashHtml()`），物化期间按 120 ms 节流推送
`已处理 N / 总计 M`。进度页是普通页面而非模态框 —— 与"更新交互不打断用户"
的既定原则一致。

## 实现中新增的两条约束（都踩过，务必保留）

### 链接不能一律"原样重建"

种子树里混着两类链接，处理方式**相反**：

| 链接指向 | 处理 | 理由 |
|---|---|---|
| 随附 dsh 安装目录内部 | **原样重建为链接** | 这是 dsh 托管的 module fallback，dsh 启动时断言它必须是链接或自己管理的 proxy；解引用成真目录会被拒绝启动 |
| 其余（含开发态自研插件） | **解引用，按真实内容物化** | 开发态插件是 Junction 指向构建机源码仓库；原样重建会在用户机上留下**悬空链接**，harness 报 `Cannot find package '…'` 而插件静默消失 |

判据在 `collect()` 里用 `isInside(target, dshDir)` 实现。

### Windows 上判定链接类型必须看**真实目标**，不能看 Dirent

对 Junction 调用 `readdirSync({ withFileTypes: true })` 时 `entry.isDirectory()` 是
**false**（Dirent 走 lstat 语义，看到的是重解析点本身）。若据此按"文件"调用
`symlinkSync(..., 'file')`，会以 ENOENT 失败，目标处只留下一个不存在的链接 ——
表现同样是插件静默消失。因此 `recreateLink()` 用 `statSync(...).isDirectory()` 判定。

同理，判断"目标是否已存在"必须用 `lstatSync`：`existsSync` 跟随链接，对悬空链接
返回 false，续传时会重复创建而 EEXIST。

### 硬链接失败一律回退复制，绝不中断首启

NTFS 单文件硬链接上限是 **1024**。种子树的文件来自 pnpm **内容寻址 store**，
每装一个项目就多一条链接（实测本机某个文件的链接数构成：首条就是
`~/.local/pnpm/store/v10/files/…`，另有十几个项目的 `node_modules` 指向同一 inode）。
因此"链接数耗尽"是**必然会发生**的真实情况，不是理论边界。

由此定下的策略：`linkSync` 抛出**任何**错误都回退 `copyFileSync`，只有连复制也失败
才中断。曾经因为只白名单了 `EXDEV`/`ENOTSUP` 等几个错误码，遇到上限错误
（Windows 报 `UNKNOWN: An attempt was made to create more links on a file than the
file system supports`）就直接抛错、首启失败 —— 那是最糟的结果：功能本可完全正常，
只是慢一点、占盘多一点。回退次数与样本路径会写进 `.dsh-px-materialized`。

## 待验证项（P2 实现后必须实测）

1. ✅ 同卷首启实测耗时：**5.7 秒**（原 4–5 分钟）
2. ⚠️ 跨卷场景：本机只有单个卷，**无法真实构造 EXDEV**。已覆盖的部分：
   - 判据级测试确认 `EXDEV` 被正确识别（`fs.linkSync` 跨卷抛 EXDEV、libuv 在
     Windows 上把 `ERROR_NOT_SAME_DEVICE` 映射为 `UV_EXDEV`，见 libuv commit `32f6f6e`）
   - 回退分支本身已用**真实触发的硬链接上限**跑通（与跨卷走的是同一段代码）
   - 仍未验证：真实跨卷环境下首启的耗时与进度显示
3. ✅ 硬链接树被 dsh 写入时行为正常：清单文件是**复制**的，硬链接只覆盖
   `node_modules`，因此 dsh 每次启动重写 `profiles/web/cordis.yml` 不会写到只读区
4. ⚠️ 卸载/更新时"删了安装目录但数据目录仍占盘"的误解：硬链接共享数据，
   两边都删才释放。**尚未**在卸载流程里做用户提示，留待后续版本

