; Per-user installer diagnostics. No conversation, credential or request data is logged.
!macro PxInstallerTrace Stage
  !ifndef BUILD_UNINSTALLER
    Push $R6
    Push $R7
    Push $R8
    Push $R9
    StrCpy $R7 0
    ${If} ${Errors}
      StrCpy $R7 1
    ${EndIf}
    System::Call 'kernel32::GetLastError() i.R8'
    System::Call 'kernel32::GetCurrentProcessId() i.R6'
    CreateDirectory "$LOCALAPPDATA\dsh-px-desktop-updater\installer-logs"
    FileOpen $R9 "$LOCALAPPDATA\dsh-px-desktop-updater\installer-logs\install-${VERSION}.log" a
    ${IfNot} ${Errors}
      FileSeek $R9 0 END
      FileWrite $R9 "pid=$R6 stage=${Stage} error=$R8$\r$\n"
      FileClose $R9
    ${EndIf}
    ${If} $R7 == 1
      SetErrors
    ${Else}
      ClearErrors
    ${EndIf}
    Pop $R9
    Pop $R8
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
        ${If} ${Silent}
          System::Call 'user32::MessageBoxW(p 0, w "$(INSTALLER_FAILED)$\r$\n$LOCALAPPDATA\dsh-px-desktop-updater\installer-logs", w "DSH-PX Desktop", i 48)'
        ${EndIf}
      ${EndIf}
    ${EndIf}
  FunctionEnd
!macroend
