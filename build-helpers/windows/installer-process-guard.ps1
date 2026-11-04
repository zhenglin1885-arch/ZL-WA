# Executed by the installer in a separate native Windows PowerShell process.
# Paths are inherited as data; none are interpolated into PowerShell source.
$ErrorActionPreference = 'Stop'
try {
    $mode = $env:ZL_WA_SETUP_MODE
    if ($mode -notin @('check', 'close')) { exit 20 }
    $root = [IO.Path]::GetFullPath($env:ZL_WA_SETUP_DIR)
    $name = $env:ZL_WA_SETUP_EXE
    if ($name -ne 'ZL-WA.exe') { exit 20 }
    $expected = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $name))
    $processName = [IO.Path]::GetFileNameWithoutExtension($name)

    function Get-TargetProcesses {
        $found = @()
        foreach ($process in [Diagnostics.Process]::GetProcessesByName($processName)) {
            try {
                if ($process.HasExited) { continue }
                $path = $process.MainModule.FileName
                if ([string]::IsNullOrEmpty($path)) { throw 'Unverified process' }
                if ([string]::Equals([IO.Path]::GetFullPath($path), $expected, [StringComparison]::OrdinalIgnoreCase)) {
                    $found += $process
                }
            } catch {
                if (-not $process.HasExited) { throw }
            }
        }
        return $found
    }

    $targets = @(Get-TargetProcesses)
    if ($targets.Count -eq 0) { exit 0 }
    if ($mode -eq 'check') { exit 10 }

    # New versions understand update-specific quit; older versions understand --quit.
    # A first-instance --quit-for-update exits without opening accounts.
    Start-Process -FilePath $expected -ArgumentList '--quit-for-update', '--quit' -ErrorAction SilentlyContinue | Out-Null
    $grace = [Diagnostics.Stopwatch]::StartNew()
    do {
        Start-Sleep -Milliseconds 250
        $targets = @(Get-TargetProcesses)
    } while ($targets.Count -gt 0 -and $grace.Elapsed.TotalSeconds -lt 8)

    # The installer has permission to close this installation. Revalidate both
    # executable and start time before terminating, protecting against PID reuse.
    foreach ($target in $targets) {
        try {
            $started = $target.StartTime
            $live = [Diagnostics.Process]::GetProcessById($target.Id)
            if ($live.HasExited) { continue }
            if ($live.StartTime -ne $started -or
                -not [string]::Equals([IO.Path]::GetFullPath($live.MainModule.FileName), $expected, [StringComparison]::OrdinalIgnoreCase)) { continue }
            $live.Kill()
            $null = $live.WaitForExit(2000)
        } catch {
            if (-not $target.HasExited) { exit 30 }
        }
    }
    $wait = [Diagnostics.Stopwatch]::StartNew()
    do {
        $remaining = @(Get-TargetProcesses)
        if ($remaining.Count -eq 0) { exit 0 }
        Start-Sleep -Milliseconds 250
    } while ($wait.Elapsed.TotalSeconds -lt 3)
    exit 30
} catch {
    # Do not turn an access-denied/query failure into "not running".
    exit 20
}
