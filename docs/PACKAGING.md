# 构建结构与数据边界

## 制品

| 制品                                | 内容                                                      | 构建方式                                    |
| ----------------------------------- | --------------------------------------------------------- | ------------------------------------------- |
| `dsh-px-pack-<版本>.tgz`            | 七个自制组件、侧栏及基础/功能包的版本组合，含原生聚合入口 | `scripts/build-native-pack.ts`              |
| `DSH-PX-Desktop-<版本>-win-x64.exe` | 官方 Desktop 源码 + PX 覆盖层 + 同提交的 Pack             | GitHub Windows runner 上的 electron-builder |
| `artifact.json`                     | 版本、来源提交、宿主锁定、大小与 SHA-256/SHA-512          | 随对应制品生成                              |

Pack 的依赖与 peer 固定在 [native-pack.json](../config/native-pack.json)。Desktop 的上游提交、编译产物与构建工厂摘要固定在 [native-desktop.json](../config/native-desktop.json)。

## Desktop 构建顺序

可信构建在 `windows-2025` runner 上执行，不读取任何 secret：

1. 按锁定提交检出官方源码并核对 `native-desktop.json`；`pnpm@11.7.0 install --frozen-lockfile`。
2. `build:official`，打包官方 dsh / vendor / landlock 闭包，再运行 `prepare:runtime`、`prepare:packages`、`prepare:dsh`；随后确认上游 tracked 树保持干净。
3. 在 PX 检出中运行质量门禁，构建同提交的干净 release Pack。
4. `scripts/prepare-native-desktop.mjs` 生成覆盖层及独立的运行时装配副本：应用身份、签名更新源、基础包与配套功能包预装，不修改官方原始文件。基础包加入副本的 installation 清单，避免多个文件映射覆盖同一清单。
5. `scripts/brand-native-installer.mjs` 生成安装界面品牌：PX 包装脚本预先定义官方 `installer.nsh` 以 `!define /ifndef` 读取的 `INSTALLER_STRINGS_FILE` 与 `INSTALLER_BUILD_DIR`，再原样包含官方脚本；品牌位图由 `build/icon.png` 生成，官方安装器辅助库仍由官方准备步骤从源码编译。
6. `electron-builder --win nsis --x64 --publish never`，只接受一个完整安装程序，不生成差分 blockmap；发布目录不携带任何 `*.yml`。

安装器依赖官方安装界面辅助库，需要 x86 VC++ 编译器与 Windows SDK，因此正式构建只在 CI 进行。本机调试可用官方目录构建（`--dir`）配合 `DSH_PX_DIRECTORY_PROBE=1`，该模式不生成安装程序，也不能证明 NSIS 可用。

## 数据与卸载

Desktop 的 Electron 用户数据位于 `%APPDATA%\dsh-px-desktop`，DSH_HOME 位于 `%USERPROFILE%\.dsh-px`，文档目录位于 `Documents\DSH-PX`。官方卸载程序只清理 Electron 用户数据与更新缓存，从不处理 DSH_HOME；PX 不提供删除数据的选项，会话、凭据、profile 与 Pack 缓存在卸载后保留。

首次预装校验组合清单与每个功能归档，把受管功能归档复制到 profile 缓存，再通过一次原生安装应用依赖组合。写入使用临时文件、fsync 与原子替换；迁移前保留配置与锁文件恢复记录。安装失败恢复原依赖树，无法恢复时停止启动，避免运行不一致组合。用户凭据、会话、业务存储和自定义插件声明不被默认配置覆盖。

## 集成约束

- 插件组合通过 DSH bundle 与 profile 声明。组合成员变化需要重启；补丁热重载不等于动态装卸整个组合包。
- 文件更新采用临时文件加原子替换，避免原地写入共享的依赖或构建产物。
- 发布载荷不得包含凭据、会话、本项目验收夹具、个人设置或构建机路径。

`build-scripts/`、`build-test/` 与 `build/icon*.png` 为生成内容，不入库。插件 `lib` 是受控交付产物，必须与源码构建结果一致。

发布来源、顺序和安装后检查见 [RELEASING.md](RELEASING.md)。
