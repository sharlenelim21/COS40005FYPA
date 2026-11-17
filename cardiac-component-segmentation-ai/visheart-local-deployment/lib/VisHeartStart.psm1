# Helpers for start.ps1: env files of an installed copy, waiting for Docker Desktop, and the first image download.
# Every docker call goes through Invoke-Docker so the tests can mock it.

$script:LastDockerOutput = @()

function Invoke-Docker {
    # Runs docker with the given arguments and returns its exit code. Without -Show the output is kept for
    # Get-LastDockerOutput; with -Show it goes straight to the console (used for the image download progress).
    param([string[]]$Arguments, [switch]$Show)
    $ErrorActionPreference = 'Continue'
    try {
        if ($Show) {
            & docker @Arguments | Out-Host
        } else {
            $script:LastDockerOutput = @(& docker @Arguments 2>&1 | ForEach-Object { "$_" })
        }
        return [int]$LASTEXITCODE
    } catch [System.Management.Automation.CommandNotFoundException] {
        $script:LastDockerOutput = @('docker: command not found')
        return 127
    }
}

function Get-LastDockerOutput {
    return $script:LastDockerOutput
}

function Get-ComposeEnvArgs {
    # The installed copy keeps release.env (shipped) and secrets.env (made on this PC) next to docker-compose.yml.
    # A developer clone has neither, and compose then uses the defaults written in docker-compose.yml.
    param([string]$DeploymentDir)
    $result = @()
    foreach ($name in @('release.env', 'secrets.env')) {
        $file = Join-Path $DeploymentDir $name
        if (Test-Path $file) { $result += @('--env-file', $file) }
    }
    return $result   # callers wrap in @(...) so "no env files" is an empty array
}

function Wait-DockerReady {
    param(
        [int]$TimeoutSec = 180,
        [string]$DesktopExe = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
    )
    # Docker Desktop answers on docker_engine; newer releases point the CLI at dockerDesktopLinuxEngine.
    $pipes = @('\\.\pipe\docker_engine', '\\.\pipe\dockerDesktopLinuxEngine')
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $desktopStarted = $false
    while ($true) {
        if ((Invoke-Docker @('version')) -eq 0) {
            return [pscustomobject]@{ Ready = $true; Reason = 'ok' }
        }
        $output = (@(Get-LastDockerOutput) -join "`n")
        $pipeExists = @($pipes | Where-Object { Test-Path $_ }).Count -gt 0
        if ($output -match 'Access is denied|permission denied' -and $pipeExists) {
            # Docker Desktop is running, but this Windows account is not in the docker-users group.
            return [pscustomobject]@{ Ready = $false; Reason = 'no-access' }
        }
        if (-not $desktopStarted) {
            if (-not (Test-Path $DesktopExe)) {
                return [pscustomobject]@{ Ready = $false; Reason = 'not-installed' }
            }
            Write-Host 'Docker Desktop is not running. Starting it now (this can take a few minutes)...'
            Start-Process -FilePath $DesktopExe
            $desktopStarted = $true
        }
        if ((Get-Date) -ge $deadline) {
            return [pscustomobject]@{ Ready = $false; Reason = 'timeout' }
        }
        Start-Sleep -Seconds 3
    }
}

function Invoke-FirstPull {
    # Downloads the images before `compose up` when any of them is missing, so the first start shows real
    # progress and an honest size instead of a silent wait. Returns 0 when nothing was missing.
    param([string[]]$ComposeArgs, [string[]]$Services)
    if ((Invoke-Docker ($ComposeArgs + @('config', '--images'))) -ne 0) { return 0 }  # let `up` report the error
    $images = @(Get-LastDockerOutput | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() } | Select-Object -Unique)
    $missing = @($images | Where-Object { (Invoke-Docker @('image', 'inspect', $_)) -ne 0 })
    if ($missing.Count -eq 0) { return 0 }
    Write-Host 'First start: downloading VisHeart (about 25 GB). This can take an hour or more; later starts take about a minute.'
    return (Invoke-Docker ($ComposeArgs + @('pull', '--include-deps') + $Services) -Show)
}

function Test-DatabaseVolume {
    # An installed copy makes new passwords on this PC, but MongoDB keeps the ones its data volume was first created
    # with. The volume name comes from this folder's name, so a developer copy or an earlier install whose data was
    # kept without its passwords leaves a volume this copy cannot open. database.owner records that this copy made
    # its volume; it is written before the first start, so a start that fails halfway is not mistaken for a stranger.
    # Returns @{ Ok; Volume }.
    param([string]$DeploymentDir)
    $project = (Split-Path -Leaf $DeploymentDir).ToLowerInvariant()
    $volume = "${project}_mongodb_data"
    $owner = Join-Path $DeploymentDir 'database.owner'
    if (-not (Test-Path (Join-Path $DeploymentDir 'secrets.env')) -or (Test-Path $owner)) {
        return @{ Ok = $true; Volume = $volume }
    }
    if ((Invoke-Docker @('volume', 'inspect', $volume)) -eq 0) {
        return @{ Ok = $false; Volume = $volume }
    }
    Set-Content -LiteralPath $owner ("Database volume $volume was created by this VisHeart install. Do not delete this file.") -Encoding ASCII
    return @{ Ok = $true; Volume = $volume }
}

Export-ModuleMember -Function Invoke-Docker, Get-LastDockerOutput, Get-ComposeEnvArgs, Wait-DockerReady, Invoke-FirstPull,
    Test-DatabaseVolume
