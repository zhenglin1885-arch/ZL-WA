Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "ZL-WA installer smoke"
OutFile "${SMOKE_OUTPUT}"
!addplugindir /x86-unicode "${ZL_PLUGINS}"
!define APP_EXECUTABLE_FILENAME "ZL-WA.exe"
!include "${PROJECT_DIR}/build-helpers/windows/installer.nsh"
!insertmacro customHeader

Function .onInit
  !insertmacro preInit
FunctionEnd

!ifdef BUILD_UNINSTALLER
Section
  WriteUninstaller "$EXEDIR\ZL-WA-guard-uninstall.exe"
SectionEnd
Section "Uninstall"
  ReadEnvStr $INSTDIR "ZL_WA_SMOKE_TARGET"
  !insertmacro customCheckAppRunning
  ReadEnvStr $R8 "ZL_WA_SMOKE_MARKER"
  FileOpen $R9 "$R8" w
  FileWrite $R9 "uninstaller-guard-passed"
  FileClose $R9
SectionEnd
!else
Section
  ClearErrors
  StrCpy $R0 0
  !insertmacro customUnInstallCheck
  !insertmacro customUnInstallCheckCurrentUser
  ReadEnvStr $INSTDIR "ZL_WA_SMOKE_TARGET"
  !insertmacro customCheckAppRunning
  # Simulate the old uninstaller's overly broad directory scan. A staged
  # installer must not still be executing from the installation directory.
  StrCpy $R7 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$R7" +2 0
  StrCpy $R7 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  nsExec::ExecToStack /TIMEOUT=10000 '"$R7" -NoProfile -NonInteractive -Command "if (@(Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$env:ZL_WA_SMOKE_TARGET, [StringComparison]::OrdinalIgnoreCase) }).Count) { exit 11 } else { exit 0 }"'
  Pop $R0
  Pop $R7
  ${If} $R0 != 0
    SetErrorLevel 2
    Quit
  ${EndIf}
  ReadEnvStr $R8 "ZL_WA_SMOKE_MARKER"
  FileOpen $R9 "$R8" w
  FileWrite $R9 "$EXEPATH"
  FileClose $R9
SectionEnd

!endif
