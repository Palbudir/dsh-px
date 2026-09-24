

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
