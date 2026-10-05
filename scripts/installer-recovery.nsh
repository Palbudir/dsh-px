; Per-user installer diagnostics. No conversation, credential or request data is logged.
; `reason` is the installer's own user-facing failure text ($InstallerError), empty until a check fails.
!macro PxInstallerTrace Stage
  !ifndef BUILD_UNINSTALLER
    Push $R6
    Push $R7
    Push $R9
    StrCpy $R7 0
    ${If} ${Errors}
      StrCpy $R7 1
    ${EndIf}
    System::Call 'kernel32::GetCurrentProcessId() i.R6'
    CreateDirectory "$LOCALAPPDATA\dsh-px-desktop-updater\installer-logs"
    FileOpen $R9 "$LOCALAPPDATA\dsh-px-desktop-updater\installer-logs\install-${VERSION}.log" a
    ${IfNot} ${Errors}
      FileSeek $R9 0 END
      FileWrite $R9 "pid=$R6 stage=${Stage} reason=$InstallerError$\r$\n"
      FileClose $R9
    ${EndIf}
    ${If} $R7 == 1
      SetErrors
    ${Else}
      ClearErrors
    ${EndIf}
    Pop $R9
    Pop $R7
    Pop $R6
  !endif
!macroend

!macro PxInstallerFail
  !ifndef BUILD_UNINSTALLER
    Call PxRecoverInstallFailure
  !endif
  SetErrorLevel 2
  Quit
!macroend

!macro PxInstallerRecoveryFunctions
  Function PxRecoverInstallFailure
    !insertmacro PxInstallerTrace "failed"
    ${If} $dshFinalDirectory != ""
      Call dshRollbackDirectories
    ${EndIf}
    ${If} ${isUpdated}
      ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
      ; Never execute a file from an unregistered /D directory during recovery.
      ${If} $0 == $INSTDIR
      ${AndIf} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        SetOutPath $TEMP
        ExecShell "open" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--updated"
        !insertmacro PxInstallerTrace "relaunch-available"
      ${EndIf}
    ${EndIf}
    ; A silent update has no other UI: the application already quit, so always say why it did not return.
    ; Unattended acceptance runs pass --px-quiet-failure and read the trace instead.
    ${If} ${Silent}
      ${GetParameters} $R0
      ClearErrors
      ${GetOptions} $R0 "--px-quiet-failure" $R1
      ${If} ${Errors}
        System::Call 'user32::MessageBoxW(p 0, w "$(INSTALLER_FAILED)$\r$\n$InstallerError$\r$\n$\r$\n$LOCALAPPDATA\dsh-px-desktop-updater\installer-logs", w "DSH-PX Desktop", i 48)'
      ${EndIf}
    ${EndIf}
  FunctionEnd
!macroend
