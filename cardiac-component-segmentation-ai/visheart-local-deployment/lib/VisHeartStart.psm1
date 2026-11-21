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

function Get-DockerDesktopExe {
    # Docker Desktop is 64-bit and lives in the 64-bit Program Files. ProgramW6432 names that folder in both 32- and
    # 64-bit processes; ProgramFiles is "Program Files (x86)" in a 32-bit one (such as a start launched by the
    # installer), where Docker Desktop then looked "not installed".
    $programFiles = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }
    return ($programFiles.TrimEnd('\') + '\Docker\Docker\Docker Desktop.exe')
}

function Wait-DockerReady {
    param(
        [int]$TimeoutSec = 180,
        [string]$DesktopExe = (Get-DockerDesktopExe)
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

function Get-ReleaseValues {
    # The KEY=value lines of an installed copy's release.env, as a hashtable (empty for a developer copy).
    param([string]$DeploymentDir)
    $values = @{}
    $releaseEnv = Join-Path $DeploymentDir 'release.env'
    if (Test-Path $releaseEnv) {
        foreach ($line in Get-Content $releaseEnv) {
            if ($line -match '^\s*([A-Z_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2].Trim() }
        }
    }
    return $values
}

function Get-ComposeProjectName {
    # An installed copy names its compose project in release.env (COMPOSE_PROJECT_NAME=visheart), so its containers,
    # network and data volumes never mix with a developer copy's on the same PC. A developer copy has no release.env,
    # and compose names the project after the folder, as before.
    param([string]$DeploymentDir)
    $name = (Get-ReleaseValues $DeploymentDir)['COMPOSE_PROJECT_NAME']
    if ($name) { return $name.ToLowerInvariant() }
    return (Split-Path -Leaf $DeploymentDir).ToLowerInvariant()
}

function Remove-OtherCopyContainers {
    # docker-compose.yml gives every container a fixed name (visheart-local, visheart-mongodb, ...), so containers left
    # by another copy (a developer copy, or one started by hand in Docker Desktop) stop this copy from starting.
    # An installed copy removes them. Only containers: their data volumes are kept, so the other copy still has its
    # data. A developer copy removes nothing, as before. Returns the names removed.
    param([string]$DeploymentDir)
    if (-not (Test-Path (Join-Path $DeploymentDir 'release.env'))) { return @() }
    $project = Get-ComposeProjectName $DeploymentDir
    # {{.Labels}}, not {{.Label "com.docker.compose.project"}}: Windows PowerShell 5.1 strips double quotes inside
    # native arguments, which broke that template ("function "com" not defined").
    if ((Invoke-Docker @('ps', '-a', '--filter', 'name=visheart-', '--format', '{{.Names}}|{{.Labels}}')) -ne 0) {
        Write-Host "Could not list VisHeart containers: $((Get-LastDockerOutput) -join ' ')"
        return @()
    }
    $removed = @()
    foreach ($line in @(Get-LastDockerOutput)) {
        $name, $labels = ([string]$line).Split('|', 2)
        $owner = ''
        if ($labels -match '(?:^|,)com\.docker\.compose\.project=([^,]*)') { $owner = $Matches[1] }
        if (-not $name -or $owner -eq $project) { continue }
        if ((Invoke-Docker @('rm', '-f', $name)) -eq 0) { $removed += $name }
    }
    return $removed
}

function Get-ImageRepository([string]$Reference) {
    # 'a/app:2' and 'a/app@sha256:...' both give 'a/app' (a registry port, 'host:5000/a', stays in the name).
    $name = ($Reference -split '@', 2)[0]
    $slash = $name.LastIndexOf('/')
    $colon = $name.LastIndexOf(':')
    if ($colon -gt $slash) { $name = $name.Substring(0, $colon) }
    return $name
}

function Remove-OldVisHeartImages {
    # Each update names new VisHeart images in release.env, and Docker keeps the old ones (the GPU image alone is about
    # 25 GB). An installed copy removes the images of its own repositories that it no longer uses. It keeps: the images
    # in release.env, any image a container still uses, and the defaults in docker-compose.yml (what a developer copy
    # on the same PC runs). Mongo and Redis are never touched. Removes nothing when a current image cannot be found,
    # and nothing in a developer copy. Returns the removed image names.
    param([string]$DeploymentDir)
    if (-not (Test-Path (Join-Path $DeploymentDir 'release.env'))) { return @() }
    $values = Get-ReleaseValues $DeploymentDir
    $current = @($values.Keys | Where-Object { $_ -match '^VH_[A-Z_]*_IMAGE$' } | Sort-Object | ForEach-Object { $values[$_] } | Where-Object { $_ })
    if ($current.Count -eq 0) { return @() }

    $keep = @{}
    foreach ($ref in $current) {
        if ((Invoke-Docker @('image', 'inspect', '--format', '{{.Id}}', $ref)) -ne 0) { return @() }
        foreach ($id in @(Get-LastDockerOutput)) { if ($id) { $keep[[string]$id] = $true } }
    }
    $compose = Join-Path $DeploymentDir 'docker-compose.yml'
    if (Test-Path $compose) {
        foreach ($m in [regex]::Matches((Get-Content -Raw $compose), '\$\{VH_[A-Z_]+_IMAGE:-([^}\s]+)\}')) {
            if ((Invoke-Docker @('image', 'inspect', '--format', '{{.Id}}', $m.Groups[1].Value)) -eq 0) {
                foreach ($id in @(Get-LastDockerOutput)) { if ($id) { $keep[[string]$id] = $true } }
            }
        }
    }
    if ((Invoke-Docker @('ps', '-a', '-q', '--no-trunc')) -ne 0) { return @() }
    $containers = @(Get-LastDockerOutput | Where-Object { $_ })
    if ($containers.Count -gt 0) {
        if ((Invoke-Docker (@('inspect', '--format', '{{.Image}}') + $containers)) -ne 0) { return @() }
        foreach ($id in @(Get-LastDockerOutput)) { if ($id) { $keep[[string]$id] = $true } }
    }

    $removed = @()
    foreach ($repo in @($current | ForEach-Object { Get-ImageRepository $_ } | Select-Object -Unique)) {
        if ((Invoke-Docker @('images', $repo, '--no-trunc', '--format', '{{.ID}}|{{.Tag}}')) -ne 0) { continue }
        $tags = [ordered]@{}
        foreach ($line in @(Get-LastDockerOutput)) {
            $id, $tag = ([string]$line).Split('|', 2)
            if (-not $id -or $keep.ContainsKey($id)) { continue }
            if (-not $tags.Contains($id)) { $tags[$id] = @() }
            if ($tag -and $tag -ne '<none>') { $tags[$id] += "${repo}:$tag" }
        }
        foreach ($id in $tags.Keys) {
            if ((Invoke-Docker @('image', 'rm', '-f', $id)) -ne 0) { continue }
            if ($tags[$id].Count -gt 0) { $removed += $tags[$id][0] } else { $removed += "$repo ($id)" }
        }
    }
    return $removed
}

function Test-DatabaseVolume {
    # An installed copy makes new passwords on this PC, but MongoDB keeps the ones its data volume was first created
    # with. The volume name comes from this folder's name, so a developer copy or an earlier install whose data was
    # kept without its passwords leaves a volume this copy cannot open. database.owner records that this copy made
    # its volume; it is written before the first start, so a start that fails halfway is not mistaken for a stranger.
    # Returns @{ Ok; Volume }.
    param([string]$DeploymentDir)
    $project = Get-ComposeProjectName $DeploymentDir
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

function Invoke-UpdateFeed {
    # The published latest.json, as an object. Throws when it cannot be read.
    param([string]$Url, [int]$TimeoutSec)
    # Windows PowerShell 5.1 may not offer TLS 1.2 by default, and GitHub refuses anything older.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    return Invoke-RestMethod -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop
}

function Get-UpdateNotice {
    # @{ Version; Download; Note } when the team has published a newer VisHeart than this installed copy, else $null.
    # Only an installed copy checks (its release.env names its version and where to look). The check never stops
    # VisHeart from starting: no internet, a slow network or a bad latest.json all mean "no notice".
    param([string]$DeploymentDir, [int]$TimeoutSec = 5)
    $values = Get-ReleaseValues $DeploymentDir
    if (-not $values['VH_VERSION'] -or -not $values['VH_UPDATE_URL']) { return $null }
    try {
        $feed = Invoke-UpdateFeed -Url $values['VH_UPDATE_URL'] -TimeoutSec $TimeoutSec
        $latest = [version]([string]$feed.version)
        $installed = [version]$values['VH_VERSION']
    } catch {
        return $null
    }
    if ($latest -le $installed) { return $null }
    $download = [string]$feed.download
    if ($download -notmatch '^https://') { $download = $null }
    $note = ([string]$feed.note).Trim()
    if ($note.Length -gt 300) { $note = $note.Substring(0, 300) }
    return @{ Version = [string]$feed.version; Download = $download; Note = $note }
}

function Remove-VisHeartDocker {
    # Used by the uninstaller. Starts Docker Desktop when it is not running (the old uninstaller skipped the clean-up
    # then, leaving containers that point at the deleted install folder). Keeping the data removes this copy's
    # containers only. -DeleteData also removes its data volumes and downloaded images, then any container named
    # visheart-* that is left (one started by hand, or one an earlier version made).
    # Returns 0 when done, 2 when Docker could not be started, otherwise compose's exit code (data not removed).
    param([string]$DeploymentDir, [switch]$DeleteData)
    if (-not (Wait-DockerReady).Ready) { return 2 }
    $arguments = @('compose', '-f', (Join-Path $DeploymentDir 'docker-compose.yml')) + @(Get-ComposeEnvArgs $DeploymentDir) +
        @('--profile', 'cpu', '--profile', 'gpu', 'down', '--remove-orphans')
    if ($DeleteData) { $arguments += @('-v', '--rmi', 'all') }
    $code = Invoke-Docker $arguments
    if ($DeleteData -and (Invoke-Docker @('ps', '-aq', '--filter', 'name=visheart-')) -eq 0) {
        $left = @(Get-LastDockerOutput | Where-Object { $_ })
        if ($left.Count -gt 0) { Invoke-Docker (@('rm', '-f') + $left) | Out-Null }
    }
    return $code
}

function Initialize-BackendFolders {
    # docker-compose.yml mounts the backend's dist folder read-only and puts Docker volumes on dist\temp_jpeg,
    # temp_mesh, temp_upload and temp_exports. Docker cannot create those folders inside a read-only mount ("mkdirat
    # ... read-only file system"), and dist is built, not in git, so a fresh copy lacks them. Creates them, and
    # The same holds for UNETRESNET34\checkpoints (a volume inside the read-only UNETRESNET34 mount of the GPU
    # service): the installer does not ship it and an older git copy has none. Compose.Tests.ps1 finds every such
    # mount in docker-compose.yml and checks that it is listed here.
    # Returns @{ Built; Folders }: whether the backend was built (dist\index.js exists), and the folders made sure of.
    param([string]$DeploymentDir)
    $app = Split-Path -Parent $DeploymentDir
    $dist = Join-Path $app 'Cardiac_Segmentation_FYP_Server\dist'
    $folders = @(@('temp_jpeg', 'temp_mesh', 'temp_upload', 'temp_exports') | ForEach-Object { Join-Path $dist $_ })
    $folders += Join-Path (Split-Path -Parent $app) 'UNETRESNET34\checkpoints'
    foreach ($folder in $folders) { New-Item -ItemType Directory -Force $folder | Out-Null }
    return @{ Built = (Test-Path (Join-Path $dist 'index.js')); Folders = $folders }
}

function Get-PortListeners {
    # The programs listening on the given TCP ports: @{ Port; Process; Id }.
    param([int[]]$Ports)
    foreach ($c in @(Get-NetTCPConnection -State Listen -LocalPort $Ports -ErrorAction SilentlyContinue)) {
        $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        [pscustomobject]@{ Port = [int]$c.LocalPort; Process = [string]$p.ProcessName; Id = [int]$c.OwningProcess }
    }
}

function Get-BusyPorts {
    # Ports VisHeart must have (3000 web page and 5000 backend, both built into the app image; 9000 file storage, which
    # the browser downloads from; 8001 GPU service) that another program holds. VisHeart's own containers hold theirs
    # through Docker's processes, which are not a problem. MongoDB and Redis are left out: an installed copy lets Docker
    # pick free ports for them. Returns @{ Port; Process; Id } per busy port.
    $docker = @('com.docker.backend', 'com.docker.proxy', 'wslrelay', 'vpnkit', 'docker-proxy', 'dockerd')
    @(Get-PortListeners -Ports @(3000, 5000, 9000, 8001)) |
        Where-Object { $docker -notcontains $_.Process } |
        Sort-Object Port -Unique
}

function Test-UrlAnswers {
    # True when the URL answers with any HTTP status within the timeout (a 404 still means the server runs).
    param([string]$Url, [int]$TimeoutSec = 3)
    try {
        Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop | Out-Null
        return $true
    } catch [System.Net.WebException] {
        return ($null -ne $_.Exception.Response)
    } catch {
        return $false
    }
}

function Test-VisHeartAnswering {
    # True when the web page and the backend both answer: the VisHeart desktop icon then just opens the browser.
    return ((Test-UrlAnswers -Url 'http://localhost:3000/') -and (Test-UrlAnswers -Url 'http://localhost:5000/'))
}

function Open-VisHeart {
    # The web page in the default browser.
    Start-Process -FilePath 'http://localhost:3000'
}

Export-ModuleMember -Function Get-DockerDesktopExe, Test-UrlAnswers, Test-VisHeartAnswering, Open-VisHeart, Get-PortListeners, Get-BusyPorts, Invoke-Docker, Get-LastDockerOutput, Get-ComposeEnvArgs, Wait-DockerReady, Invoke-FirstPull,
    Test-DatabaseVolume, Invoke-UpdateFeed, Get-UpdateNotice, Get-ComposeProjectName, Remove-OtherCopyContainers,
    Remove-VisHeartDocker, Initialize-BackendFolders, Remove-OldVisHeartImages
