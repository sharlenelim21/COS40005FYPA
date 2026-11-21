<#
.SYNOPSIS
    Checks this PC before VisHeart is installed.

.DESCRIPTION
    Writes one result per check (windows, wsl, docker, nvidia, python, disk), each with a status and a plain sentence:
      ok       nothing to do
      missing  the installer installs it (WSL, Docker Desktop, Python)
      warn     VisHeart works with a limitation (no NVIDIA GPU)
      block    VisHeart cannot be installed on this PC
    -OutJson gets a JSON array; -OutText gets one "name|status|message" line per check, which the installer reads.
    Exit code 0 when nothing blocks, 2 otherwise.
#>
param(
    [string]$InstallDrive = 'C:',
    # Updating an existing install: its images and training data already take their space.
    [switch]$ExistingInstall,
    # The installer checks the disk again once the user has chosen the install folder.
    [switch]$SkipDisk,
    [switch]$DiskOnly,
    [string]$OutJson,
    [string]$OutText
)

$script:MinBuild = 19041   # Windows 10 version 2004, the first with WSL2
$script:MinFreeGB = 40     # app + training pack + ~25 GB of images on first start, when both are on one drive
$script:MinFreeGBApp = 10      # the install folder: app files, training pack, UNet Extend Training environment
$script:MinFreeGBDocker = 30   # where Docker Desktop keeps its data: ~25 GB of images on first start
$script:MinFreeGBUpdate = 10   # an update adds new files and, at most, a changed image

# --- Probes: one per fact, so the tests can replace them ---

function Get-WindowsBuild {
    [int](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuildNumber
}

function Test-Is64BitWindows { [Environment]::Is64BitOperatingSystem }

function Get-System32Exe([string]$Name) {
    # The installer is a 32-bit program; from a 32-bit PowerShell, System32 is redirected and has no wsl.exe.
    $sysnative = Join-Path $env:windir "Sysnative\$Name"
    if (Test-Path $sysnative) { return $sysnative }
    return (Join-Path $env:windir "System32\$Name")
}

function Test-WslEnabled {
    $wsl = Get-System32Exe 'wsl.exe'
    if (-not (Test-Path $wsl)) { return $false }
    & $wsl --status *> $null
    return ($LASTEXITCODE -eq 0)
}

function Test-VirtualMachinePlatformEnabled {
    # WSL2, and so Docker Desktop, needs the Windows feature "Virtual Machine Platform". wsl --status succeeds without
    # it (seen 2026-11-21: Docker Desktop then said "Virtual Machine Platform is not enabled"). Readable without
    # administrator rights. If Windows cannot answer, assume it is on rather than ask for a needless restart.
    try {
        $feature = Get-CimInstance -ClassName Win32_OptionalFeature -Filter "Name='VirtualMachinePlatform'" -ErrorAction Stop
        if (-not $feature) { return $false }
        return ([int]$feature.InstallState -eq 1)
    } catch {
        return $true
    }
}

function Test-DockerDesktopInstalled {
    $programFiles = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }
    Test-Path (Join-Path $programFiles 'Docker\Docker\Docker Desktop.exe')
}

function Test-NvidiaDriver {
    $smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if (-not $smi) {
        $smiPath = Get-System32Exe 'nvidia-smi.exe'
        if (-not (Test-Path $smiPath)) { return $false }
        $smi = $smiPath
    } else { $smi = $smi.Source }
    & $smi *> $null
    return ($LASTEXITCODE -eq 0)
}

function Get-PythonVersion {
    # The Microsoft Store "python" stub prints nothing useful; a real install prints "Python 3.x.y".
    foreach ($cmd in @(@('py', '-3', '--version'), @('python', '--version'))) {
        if (-not (Get-Command $cmd[0] -ErrorAction SilentlyContinue)) { continue }
        $text = (& $cmd[0] @($cmd | Select-Object -Skip 1) 2>&1 | Out-String)
        if ($text -match 'Python (\d+\.\d+(\.\d+)?)') { return [version]$Matches[1] }
    }
    return $null
}

function Get-FreeSpaceGB([string]$Drive) {
    $info = New-Object System.IO.DriveInfo ($Drive.TrimEnd('\') + '\')
    return [math]::Round($info.AvailableFreeSpace / 1GB, 1)
}

function Get-DockerDataDrive {
    # The drive Docker Desktop keeps its images on: the folder it was moved to (Settings > Resources > Advanced >
    # Disk image location), or the Windows drive by default.
    param([string]$SettingsPath = (Join-Path $env:APPDATA 'Docker\settings-store.json'))
    try {
        $dir = [string](Get-Content -Raw -LiteralPath $SettingsPath -ErrorAction Stop | ConvertFrom-Json).CustomWslDistroDir
        if ($dir -match '^[A-Za-z]:') { return $dir.Substring(0, 2).ToUpperInvariant() }
    } catch { }
    return $env:SystemDrive
}

# --- Checks ---

function New-Check([string]$Name, [string]$Status, [string]$Message) {
    [pscustomobject]@{ Name = $Name; Status = $Status; Message = $Message }
}

function Get-VisHeartPrerequisites {
    param([string]$InstallDrive = 'C:', [switch]$ExistingInstall, [switch]$SkipDisk, [switch]$DiskOnly)
    if ($DiskOnly) { return Get-DiskCheck -InstallDrive $InstallDrive -ExistingInstall:$ExistingInstall }
    $build = Get-WindowsBuild
    if (-not (Test-Is64BitWindows)) {
        New-Check 'windows' 'block' 'VisHeart needs 64-bit Windows 10 (version 2004 or later) or Windows 11.'
    } elseif ($build -lt $script:MinBuild) {
        New-Check 'windows' 'block' "This Windows (build $build) is too old. VisHeart needs Windows 10 version 2004 (build $($script:MinBuild)) or later, or Windows 11. Run Windows Update, then install again."
    } else {
        New-Check 'windows' 'ok' "Windows build $build."
    }

    if (-not (Test-WslEnabled)) {
        New-Check 'wsl' 'missing' 'WSL2 is not enabled. The installer will turn it on; Windows then needs a restart.'
    } elseif (-not (Test-VirtualMachinePlatformEnabled)) {
        New-Check 'wsl' 'missing' 'The Windows feature Virtual Machine Platform, which WSL2 and Docker Desktop need, is off. The installer will turn it on; Windows then needs a restart.'
    } else {
        New-Check 'wsl' 'ok' 'WSL2 is enabled.'
    }

    if (Test-DockerDesktopInstalled) { New-Check 'docker' 'ok' 'Docker Desktop is installed.' }
    else { New-Check 'docker' 'missing' 'Docker Desktop is not installed. The installer will install it (free for education, research and small organisations).' }

    if (Test-NvidiaDriver) { New-Check 'nvidia' 'ok' 'NVIDIA GPU driver found.' }
    else { New-Check 'nvidia' 'warn' 'No NVIDIA GPU driver found. VisHeart will run in CPU mode: segmentation and reconstruction are slower, and MedSAM is not available.' }

    $python = Get-PythonVersion
    if ($python -and $python -ge [version]'3.11') { New-Check 'python' 'ok' "Python $python." }
    elseif ($python) { New-Check 'python' 'missing' "Python $python is too old for UNet Extend Training (3.11 or later). The installer will install Python 3.13." }
    else { New-Check 'python' 'missing' 'Python is not installed. UNet Extend Training needs it; the installer will install Python 3.13.' }

    if (-not $SkipDisk) { Get-DiskCheck -InstallDrive $InstallDrive -ExistingInstall:$ExistingInstall }
}

function Get-DiskCheck {
    param([string]$InstallDrive, [switch]$ExistingInstall)
    $InstallDrive = $InstallDrive.Substring(0, 2).ToUpperInvariant()
    $free = Get-FreeSpaceGB $InstallDrive
    if ($ExistingInstall) {
        if ($free -lt $script:MinFreeGBUpdate) {
            return New-Check 'disk' 'block' ("Only {0} GB is free on {1}. Updating VisHeart needs at least {2} GB. Free some space, then run the update again." -f $free, $InstallDrive, $script:MinFreeGBUpdate)
        }
        return New-Check 'disk' 'ok' ("{0} GB free on {1}." -f $free, $InstallDrive)
    }
    $dockerDrive = Get-DockerDataDrive
    if ($dockerDrive -eq $InstallDrive) {
        if ($free -lt $script:MinFreeGB) {
            return New-Check 'disk' 'block' ("Only {0} GB is free on {1}. VisHeart needs at least {2} GB (the first start downloads about 25 GB). Free some space or choose another drive, then install again." -f $free, $InstallDrive, $script:MinFreeGB)
        }
        return New-Check 'disk' 'ok' ("{0} GB free on {1}." -f $free, $InstallDrive)
    }
    if ($free -lt $script:MinFreeGBApp) {
        return New-Check 'disk' 'block' ("Only {0} GB is free on {1}. VisHeart's files need at least {2} GB there. Free some space or choose another drive." -f $free, $InstallDrive, $script:MinFreeGBApp)
    }
    $dockerFree = Get-FreeSpaceGB $dockerDrive
    if ($dockerFree -lt $script:MinFreeGBDocker) {
        return New-Check 'disk' 'block' ("Only {0} GB is free on {1}, where Docker Desktop keeps its data. The first start of VisHeart downloads about 25 GB there; it needs at least {2} GB. Free some space, then install again." -f $dockerFree, $dockerDrive, $script:MinFreeGBDocker)
    }
    return New-Check 'disk' 'ok' ("{0} GB free on {1}; {2} GB free on {3} for Docker." -f $free, $InstallDrive, $dockerFree, $dockerDrive)
}

function Invoke-VisHeartPrerequisites {
    param([string]$InstallDrive = 'C:', [switch]$ExistingInstall, [switch]$SkipDisk, [switch]$DiskOnly, [string]$OutJson, [string]$OutText)
    $results = @(Get-VisHeartPrerequisites -InstallDrive $InstallDrive -ExistingInstall:$ExistingInstall -SkipDisk:$SkipDisk -DiskOnly:$DiskOnly)
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    if ($OutJson) { [IO.File]::WriteAllText($OutJson, (ConvertTo-Json -InputObject $results), $utf8) }
    if ($OutText) {
        $lines = $results | ForEach-Object { '{0}|{1}|{2}' -f $_.Name, $_.Status, ($_.Message -replace '[\r\n|]', ' ') }
        [IO.File]::WriteAllText($OutText, (($lines -join "`r`n") + "`r`n"), $utf8)
    }
    $results | ForEach-Object { Write-Host ('{0,-8} {1,-8} {2}' -f $_.Name, $_.Status, $_.Message) }
    if (@($results | Where-Object { $_.Status -eq 'block' }).Count -gt 0) { return 2 }
    return 0
}

# Run only when executed, not when dot-sourced by the tests.
if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-VisHeartPrerequisites -InstallDrive $InstallDrive -ExistingInstall:$ExistingInstall -SkipDisk:$SkipDisk -DiskOnly:$DiskOnly -OutJson $OutJson -OutText $OutText)
}
