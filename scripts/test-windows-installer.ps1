$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$root = Join-Path ([IO.Path]::GetTempPath()) ('zl-installer-' + [guid]::NewGuid())
$target = Join-Path $root ("ZL-WA install's " + [char]0x6d4b + [char]0x8bd5)
$sibling = $target + '-other'
$owned = @()
$proof = [ordered]@{}
New-Item -ItemType Directory -Path $target, $sibling | Out-Null

function Assert-True($value, $label) {
    if (-not $value) { throw $label }
}
function Run-Guard([string]$mode, [string]$directory) {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $start.Arguments = '-NoLogo -NoProfile -NonInteractive -Command "& ([scriptblock]::Create([IO.File]::ReadAllText($env:ZL_WA_SETUP_SCRIPT)))"'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.EnvironmentVariables['ZL_WA_SETUP_SCRIPT'] = Join-Path $repo 'build-helpers\windows\installer-process-guard.ps1'
    $start.EnvironmentVariables['ZL_WA_SETUP_MODE'] = $mode
    $start.EnvironmentVariables['ZL_WA_SETUP_DIR'] = $directory
    $start.EnvironmentVariables['ZL_WA_SETUP_EXE'] = 'ZL-WA.exe'
    $process = [Diagnostics.Process]::Start($start)
    if (-not $process.WaitForExit(25000)) { $process.Kill(); throw 'Guard exceeded its deadline' }
    Write-Host "Guard mode=$mode exit=$($process.ExitCode)"
    return $process.ExitCode
}

try {
    $source = @'
using System;
using System.Threading;
class Fixture {
    static void Main(string[] args) {
        if (Array.IndexOf(args, "--quit-for-update") >= 0) return;
        Thread.Sleep(Timeout.Infinite);
    }
}
'@
    $fixture = Join-Path $target 'ZL-WA.exe'
    Add-Type -TypeDefinition $source -OutputAssembly $fixture -OutputType ConsoleApplication
    Copy-Item -LiteralPath $fixture -Destination (Join-Path $sibling 'ZL-WA.exe')
    Copy-Item -LiteralPath $fixture -Destination (Join-Path $target 'OtherTool.exe')
    $other = Start-Process -FilePath (Join-Path $sibling 'ZL-WA.exe') -PassThru
    $tool = Start-Process -FilePath (Join-Path $target 'OtherTool.exe') -PassThru
    $owned += $other, $tool
    Assert-True ((Run-Guard 'check' $target) -eq 0) 'Sibling/other executable was incorrectly detected as the app'
    $app = Start-Process -FilePath $fixture -PassThru
    $owned += $app
    Assert-True ((Run-Guard 'check' $target) -eq 10) 'Installed app was not detected'
    Assert-True ((Run-Guard 'close' $target) -eq 0) 'Orphan/background app could not be closed'
    $app.Refresh(); $other.Refresh(); $tool.Refresh()
    Assert-True ($app.HasExited -and -not $other.HasExited -and -not $tool.HasExited) 'Guard terminated the wrong installation or executable'
    Assert-True ((Run-Guard 'invalid' $target) -eq 20) 'Invalid guard request was treated as not running'
    Assert-True ((Run-Guard 'check' $target) -eq 0) 'Closed app still detected'
    $proof.exactPathAndName = $true
    $proof.orphanProcessClosed = $true
    $proof.otherInstallationPreserved = $true
    $proof.unrelatedExecutablePreserved = $true
    $proof.pathsWithSpacesApostropheUnicode = $true
    $proof.invalidRequestFailsClosed = $true
    # The legacy uninstaller scans all paths. Remove our unrelated test programs
    # before testing compatibility with that scan.
    $other.Kill(); $other.WaitForExit(); $tool.Kill(); $tool.WaitForExit()

    $compiler = Join-Path $env:ZL_NSIS_HOME 'Bin\makensis.exe'
    $plugins = Join-Path $env:ZL_NSIS_RESOURCES 'plugins\x86-unicode'
    $setup = Join-Path $target 'ZL-WA-setup-smoke.exe'
    & $compiler -INPUTCHARSET UTF8 /V2 "/DPROJECT_DIR=$repo" "/DZL_PLUGINS=$plugins" "/DSMOKE_OUTPUT=$setup" (Join-Path $PSScriptRoot 'fixtures\windows-installer-smoke.nsi')
    if ($LASTEXITCODE -ne 0) { throw 'NSIS smoke compilation failed' }
    $marker = Join-Path $root 'stage-result.txt'
    $env:ZL_WA_SMOKE_TARGET = $target
    $env:ZL_WA_SMOKE_MARKER = $marker
    $original = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru
    $owned += $original
    Assert-True ($original.WaitForExit(20000)) 'Original installer did not exit before the staged install'
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    while (-not (Test-Path -LiteralPath $marker) -and $deadline.Elapsed.TotalSeconds -lt 30) { Start-Sleep -Milliseconds 200 }
    Assert-True (Test-Path -LiteralPath $marker) 'Staged installer failed its guard or legacy-directory scan'
    $staged = [IO.File]::ReadAllText($marker)
    Assert-True (-not $staged.StartsWith($target, [StringComparison]::OrdinalIgnoreCase)) 'Installer still executing inside the installation directory'
    $proof.installerInsideOldDirectory = $true
    $proof.originalInstallerExited = $true
    $proof.legacyDirectoryScanPasses = $true
    $proof.stagedInstallerGuardRuns = $true
    Remove-Item -LiteralPath $marker
    $uninstallBuilder = Join-Path $target 'uninstall-builder.exe'
    & $compiler -INPUTCHARSET UTF8 /V2 /DBUILD_UNINSTALLER "/DPROJECT_DIR=$repo" "/DZL_PLUGINS=$plugins" "/DSMOKE_OUTPUT=$uninstallBuilder" (Join-Path $PSScriptRoot 'fixtures\windows-installer-smoke.nsi')
    if ($LASTEXITCODE -ne 0) { throw 'NSIS uninstaller compilation failed' }
    $builder = Start-Process -FilePath $uninstallBuilder -ArgumentList '/S' -PassThru
    $owned += $builder
    Assert-True ($builder.WaitForExit(15000)) 'Uninstaller builder timed out'
    $uninstaller = Start-Process -FilePath (Join-Path $target 'ZL-WA-guard-uninstall.exe') -ArgumentList '/S' -PassThru
    $owned += $uninstaller
    Assert-True ($uninstaller.WaitForExit(15000)) 'Uninstaller guard timed out'
    $deadline.Restart()
    while (-not (Test-Path -LiteralPath $marker) -and $deadline.Elapsed.TotalSeconds -lt 15) { Start-Sleep -Milliseconds 100 }
    Assert-True (Test-Path -LiteralPath $marker) 'New uninstaller detected itself as the app'
    $proof.uninstallerDoesNotDetectItself = $true
    $proof | ConvertTo-Json | Write-Output
} finally {
    foreach ($process in $owned) { try { if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit(2000) | Out-Null } } catch {} }
    Remove-Item Env:ZL_WA_SMOKE_TARGET, Env:ZL_WA_SMOKE_MARKER -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
