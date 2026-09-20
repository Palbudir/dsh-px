/**
 * NSIS 自定义卸载逻辑（经 electron-builder 的 `nsis.include` 注入）。
 *
 * ## 为什么需要它
 *
 * 我们把**程序**装在安装目录、把**用户数据**（会话、插件、设置）放在
 * `%APPDATA%\dsh-px`。卸载程序只删前者，后者会留着 —— 这是**有意**的：
 * 宁可留着让用户自己删，也不静默销毁他的会话历史。
 *
 * 但"留着"必须**告诉用户**，否则他会以为数据已经删干净、或者疑惑磁盘为什么
 * 没释放。成熟桌面客户端在这一步都会问一句。
 *
 * ## 钩子来自 electron-builder 的模板
 *
 * `templates/nsis/uninstaller.nsh` 里预留了 `customUnInstall` 与
 * `customUnInstallSection` 两个 `!ifmacrodef` 钩子，宏名固定，定义在本文件里即可。
 * 这里选 `customUnInstall`：它在删除文件**之前**执行，`$INSTDIR` 仍然有效。
 *
 * ## 静默卸载必须跳过询问
 *
 * `IfSilent` 分支不能问 —— 静默安装/卸载（`/S`）常见于无人值守与自动化，
 * 一旦弹窗就会永久挂住。所以静默时直接跳过，保持"保留数据"的默认行为。
 */

!macro customUnInstall
  ; 静默卸载（/S）不问：无人值守场景下一个模态框会让流程永久挂住。
  IfSilent dshPxSkipDataPrompt

  ; $APPDATA 即 %APPDATA%，我们的 userData 目录是它下面的 dsh-px。
  IfFileExists "$APPDATA\dsh-px\*.*" 0 dshPxSkipDataPrompt

  MessageBox MB_YESNO|MB_ICONQUESTION \
    "是否同时删除 DSH-PX 的本地数据？$\r$\n$\r$\n\
     包含会话记录、已安装插件与设置，位置：$\r$\n$APPDATA\dsh-px$\r$\n$\r$\n\
     选择“否”将保留这些数据，以便日后重新安装时继续使用。$\r$\n\
     注意：随附运行时与这里的插件依赖是共享数据（硬链接），$\r$\n\
     因此保留数据目录时磁盘空间不会完全释放。" \
    IDNO dshPxSkipDataPrompt

  RMDir /r "$APPDATA\dsh-px"

  dshPxSkipDataPrompt:
!macroend
