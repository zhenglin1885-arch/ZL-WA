!include "LogicLib.nsh"
!include "FileFunc.nsh"
!define ZL_GUARD_SCRIPT_PATH "${__FILEDIR__}\installer-process-guard.ps1"

!macro ZL_STAGE_IF_INSIDE ROOT
  ReadRegStr $R8 ${ROOT} "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R8 != ""
    GetFullPathName $R8 "$R8\."
    StrLen $R9 "$R8\"
    StrCpy $0 "$EXEDIR\" $R9
    ${If} $0 == "$R8\"
      Goto zl_stage
    ${EndIf}
  ${EndIf}
!macroend

# This runs BEFORE electron-builder's installer mutex and old uninstaller.
# The original installer may be inside the installation directory. Exit it
# before a staged copy starts checking/removing old application files.
!macro preInit
  !ifndef BUILD_UNINSTALLER
    ${GetParameters} $R7
    ClearErrors
    ${GetOptions} $R7 "/ZL-STAGED" $R8
    ${If} ${Errors}
      # Only move installers inside a registered old installation. Normal
      # external/silent deployments keep synchronous completion and exit codes.
      SetRegView 64
      !insertmacro ZL_STAGE_IF_INSIDE HKCU
      !insertmacro ZL_STAGE_IF_INSIDE HKLM
      Goto zl_stage_done
      zl_stage:
      InitPluginsDir
      ClearErrors
      CopyFiles /SILENT "$EXEPATH" "$PLUGINSDIR\ZL-WA-setup.exe"
      ${If} ${Errors}
        MessageBox MB_OK|MB_ICONSTOP "无法准备升级安装包。请确认临时目录有可用空间并允许写入，再重试。" /SD IDOK
        SetErrorLevel 2
        Quit
      ${EndIf}
      System::Call 'kernel32::GetCurrentProcessId() i.r9'
      ClearErrors
      Exec '"$PLUGINSDIR\ZL-WA-setup.exe" /ZL-STAGED /ZL-PARENT=$9 $R7'
      ${If} ${Errors}
        MessageBox MB_OK|MB_ICONSTOP "无法启动临时安装包。请检查安全软件是否阻止了安装程序。" /SD IDOK
        SetErrorLevel 2
        Quit
      ${EndIf}
      SetErrorLevel 0
      Quit
    ${Else}
      ${GetOptions} $R7 "/ZL-PARENT=" $R8
      System::Call 'kernel32::OpenProcess(i 0x100000, i 0, i R8) p.r9'
      ${If} $9 != 0
        System::Call 'kernel32::WaitForSingleObject(p r9, i 10000) i.r8'
        System::Call 'kernel32::CloseHandle(p r9)'
        ${If} $8 != 0
          MessageBox MB_OK|MB_ICONSTOP "上一轮安装程序尚未退出，请关闭后重新运行安装包。" /SD IDOK
          SetErrorLevel 2
          Quit
        ${EndIf}
      ${EndIf}
    ${EndIf}
    zl_stage_done:
  !endif
!macroend

!macro ZL_GUARD_FUNCTIONS PREFIX
Function ${PREFIX}ZLRunGuard
  InitPluginsDir
  File "/oname=$PLUGINSDIR\zl-process-guard.ps1" "${ZL_GUARD_SCRIPT_PATH}"
  System::Call 'kernel32::SetEnvironmentVariable(t "ZL_WA_SETUP_SCRIPT", t "$PLUGINSDIR\zl-process-guard.ps1")'
  System::Call 'kernel32::SetEnvironmentVariable(t "ZL_WA_SETUP_DIR", t "$INSTDIR")'
  System::Call 'kernel32::SetEnvironmentVariable(t "ZL_WA_SETUP_EXE", t "${APP_EXECUTABLE_FILENAME}")'
  System::Call 'kernel32::SetEnvironmentVariable(t "ZL_WA_SETUP_MODE", t "$R6")'
  StrCpy $R7 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$R7" +2 0
  StrCpy $R7 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  nsExec::ExecToStack /TIMEOUT=25000 '"$R7" -NoLogo -NoProfile -NonInteractive -Command "& ([scriptblock]::Create([IO.File]::ReadAllText($$env:ZL_WA_SETUP_SCRIPT)))"'
  Pop $R0
  Pop $R7
  System::Call 'kernel32::SetEnvironmentVariable(t "ZL_WA_SETUP_SCRIPT", p 0)'
  System::Call 'kernel32::SetEnvironmentVariable(t "ZL_WA_SETUP_DIR", p 0)'
  System::Call 'kernel32::SetEnvironmentVariable(t "ZL_WA_SETUP_EXE", p 0)'
  System::Call 'kernel32::SetEnvironmentVariable(t "ZL_WA_SETUP_MODE", p 0)'
FunctionEnd

Function ${PREFIX}ZLCheckRunning
  # Detect an ACL/read-only directory before shutting down or uninstalling.
  IfFileExists "$INSTDIR\*.*" 0 zl_retry
  ClearErrors
  GetTempFileName $R8 "$INSTDIR"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "旧安装目录没有写入权限。请关闭安装器，右键安装包选择以管理员身份运行后重试。本轮尚未卸载旧版。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  Delete "$R8"
  zl_retry:
  StrCpy $R6 "check"
  Call ${PREFIX}ZLRunGuard
  ${If} $R0 == 10
    IfSilent zl_close 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "安装需要退出当前目录中的 ZL-WA。请先完成发送和群发任务，点击确定后继续。" /SD IDCANCEL IDOK zl_close
    SetErrorLevel 2
    Quit
    zl_close:
    StrCpy $R6 "close"
    Call ${PREFIX}ZLRunGuard
  ${EndIf}
  ${If} $R0 != 0
    # A blocked PowerShell may still allow an installation with no app processes.
    # Never kill by image name: another installation/user may own that process.
    nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
    Pop $R7
    ${If} $R7 == 603
      Return
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "无法确认旧版进程已经退出或没有足够权限关闭它。请从托盘退出 ZL-WA；如仍失败，请以管理员身份运行安装包。旧版文件和账号数据尚未删除。" /SD IDCANCEL IDRETRY zl_retry
    SetErrorLevel 2
    Quit
  ${EndIf}
FunctionEnd
!macroend

!macro customHeader
  !ifdef BUILD_UNINSTALLER
    !insertmacro ZL_GUARD_FUNCTIONS "un."
  !else
    !insertmacro ZL_GUARD_FUNCTIONS ""
  !endif
!macroend

!macro customCheckAppRunning
  !ifdef BUILD_UNINSTALLER
    Call un.ZLCheckRunning
  !else
    Call ZLCheckRunning
  !endif
!macroend

!macro ZL_UNINSTALL_RESULT
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "无法启动旧版卸载程序，已停止覆盖安装。请以管理员身份重试，并检查安全软件是否阻止了卸载。请勿手动删除账号数据目录。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${If} $R0 != 0
    MessageBox MB_OK|MB_ICONSTOP "旧版卸载未完成（错误码 $R0）。文件可能仍被占用或安装目录权限不足。请退出托盘程序后以管理员身份运行安装包；请勿删除账号数据目录。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customUnInstallCheck
  !insertmacro ZL_UNINSTALL_RESULT
!macroend
!macro customUnInstallCheckCurrentUser
  !insertmacro ZL_UNINSTALL_RESULT
!macroend
