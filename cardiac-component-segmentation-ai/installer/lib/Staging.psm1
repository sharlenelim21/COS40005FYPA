# Building blocks for make-installer.ps1: what goes into the installer, and the checks that stop a bad release.

$script:App = 'cardiac-component-segmentation-ai'

# What the installed app needs, relative to the repository root. The installed copy keeps the repository's two
# levels because docker-compose.yml mounts ../../UNETRESNET34. The frontend is baked into the visheart-local image,
# so its source is not shipped; the backend runs from the dist/ folder compose mounts.
$script:Roots = @(
    'UNETRESNET34',
    "$($script:App)\start.bat",
    "$($script:App)\stop.bat",
    "$($script:App)\visheart-local-deployment",
    "$($script:App)\Cardiac_Segmentation_FYP_Server\dist",
    "$($script:App)\Cardiac_Segmentation_FYP_Server\src\python",
    "$($script:App)\visheart-inference-gpu\start_server.py",
    "$($script:App)\visheart-inference-gpu\app",
    "$($script:App)\visheart-retraining"
)

# Folders never shipped, wherever they appear.
$script:ExcludedDirNames = @('.git', 'node_modules', '.venv', '__pycache__', 'tests', '.pytest_cache')
# Folders never shipped at these places: per-PC data, scratch output, and files compose masks anyway.
$script:ExcludedDirPaths = @(
    'UNETRESNET34\checkpoints',   # masked by an anonymous volume in compose; the image has its own
    "$($script:App)\visheart-local-deployment\volumes",
    "$($script:App)\Cardiac_Segmentation_FYP_Server\dist\temp_exports",
    "$($script:App)\Cardiac_Segmentation_FYP_Server\dist\temp_jpeg",
    "$($script:App)\Cardiac_Segmentation_FYP_Server\dist\temp_mesh",
    "$($script:App)\Cardiac_Segmentation_FYP_Server\dist\temp_upload",
    "$($script:App)\visheart-inference-gpu\app\models\active",
    "$($script:App)\visheart-inference-gpu\app\models\atlas_rv_backup_pre_lengthwise",
    "$($script:App)\visheart-retraining\jobs"
)
# Files that are per PC or secret, never shipped.
$script:ExcludedFileNames = @('secrets.env', 'release.env', '.env', 'FIRST-LOGIN.txt', 'database.owner')
# The only files and folders in visheart-inference-gpu\app\models that ship. Anything else there (a test checkpoint,
# a version trained on the build PC) stops the build, so it can never reach users. Keep in step with the
# "app/models" lines of visheart-inference-gpu\.dockerignore, which keep the same files out of the GPU image.
$script:ShippedModelNames = @(
    '24April2025-single-stage-usethis.engine', '24April2025-single-stage-usethis.onnx',
    '24April2025-single-stage-usethis.pt', 'fourd_model_epoch_250.pth', 'fourd_rv_epoch_50.pth',
    'medsam_vit_b.pth', 'unet.pth', 'atlas', 'atlas_rv'
)

function Get-ShippedModelNames { return $script:ShippedModelNames }

function Get-UnexpectedModelFiles {
    # Names of the files and folders in app\models that would ship but are not shipped models. The folders staging
    # already leaves out (active, the atlas backup) are not reported.
    param([string]$RepoRoot)
    $modelsRel = "$($script:App)\visheart-inference-gpu\app\models"
    $models = Join-Path $RepoRoot $modelsRel
    if (-not (Test-Path $models)) { return @() }
    return @(Get-ChildItem -LiteralPath $models -Force | Where-Object {
        $script:ShippedModelNames -notcontains $_.Name -and
        -not (Test-Excluded (Join-Path $modelsRel $_.Name) $_.PSIsContainer)
    } | ForEach-Object { $_.Name })
}

function Test-Excluded([string]$Relative, [bool]$IsDirectory) {
    $name = Split-Path -Leaf $Relative
    if ($IsDirectory) {
        if ($script:ExcludedDirNames -contains $name -or $name -like 'venv*') { return $true }
        return ($script:ExcludedDirPaths -contains $Relative)
    }
    return ($script:ExcludedFileNames -contains $name -or $name -like '*.pyc')
}

function Get-StagingSelection {
    # Returns one { Source; Target } per file to ship; Target is relative to the staging root.
    param([string]$RepoRoot)
    $root = (Resolve-Path $RepoRoot).Path.TrimEnd('\')
    $result = New-Object System.Collections.Generic.List[object]
    $pending = New-Object System.Collections.Generic.Stack[string]
    foreach ($rel in $script:Roots) {
        $full = Join-Path $root $rel
        if (Test-Path $full -PathType Leaf) {
            $result.Add([pscustomobject]@{ Source = $full; Target = $rel })
        } elseif (Test-Path $full -PathType Container) {
            $pending.Push($rel)
        }
    }
    while ($pending.Count -gt 0) {
        $dirRel = $pending.Pop()
        foreach ($item in Get-ChildItem -LiteralPath (Join-Path $root $dirRel) -Force) {
            $rel = Join-Path $dirRel $item.Name
            if (Test-Excluded $rel $item.PSIsContainer) { continue }
            if ($item.PSIsContainer) { $pending.Push($rel) }
            else { $result.Add([pscustomobject]@{ Source = $item.FullName; Target = $rel }) }
        }
    }
    return $result.ToArray()
}

function Invoke-ManifestInspect([string]$Reference) {
    # Exit code of `docker manifest inspect`, which asks the registry directly (no running Docker daemon needed).
    $ErrorActionPreference = 'Continue'
    & docker manifest inspect $Reference *> $null
    return $LASTEXITCODE
}

function Test-ImageOnRegistry {
    # True when the registry has this reference. Tries three times, so a dropped connection or a Docker Hub rate
    # limit does not fail the build.
    param([string]$Reference, [int]$DelaySec = 10)
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        if ((Invoke-ManifestInspect $Reference) -eq 0) { return $true }
        if ($attempt -lt 3 -and $DelaySec -gt 0) { Start-Sleep -Seconds $DelaySec }
    }
    return $false
}

function Test-PinnedReference([string]$Reference) {
    if ($Reference -match '@sha256:[0-9a-f]{64}$') { return $true }
    $lastPart = ($Reference -split '/')[-1]          # a registry host may carry a port: localhost:5000/name
    if ($lastPart -notmatch ':(.+)$') { return $false } # no tag means :latest
    return ($Matches[1] -ne 'latest')
}

function Test-ReleaseImages {
    # Returns every image reference that is unpinned (:latest or no tag) or missing on the registry.
    param([hashtable]$Images)
    $bad = @()
    foreach ($ref in $Images.Values) {
        if (-not (Test-PinnedReference $ref)) { $bad += $ref; continue }
        if (-not (Test-ImageOnRegistry $ref)) { $bad += $ref }
    }
    return $bad
}

function Test-ModelMatchesPack {
    # The training pack's registry checks the original model by hash, so the unet.pth shipped in app/models must be
    # the one the pack was made with.
    param([string]$UnetPath, [string]$PackRoot)
    $manifest = Get-Content -Raw (Join-Path $PackRoot 'PACKED.json') | ConvertFrom-Json
    $entry = $manifest.files.PSObject.Properties | Where-Object { $_.Name -eq 'repo-models/unet.pth' }
    if (-not $entry) { return $false }
    $actual = (Get-FileHash -LiteralPath $UnetPath -Algorithm SHA256).Hash
    return ($actual -ieq [string]$entry.Value)
}

function Read-EnvValues([string]$Path) {
    $map = [ordered]@{}
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') { $map[$Matches[1]] = $Matches[2].Trim() }
    }
    return $map
}

function Get-LongPaths {
    # The relative paths that, under Root, pass Windows' 260-character path limit (259 plus the terminating null).
    # Copy-Item and many programs fail on them unless long paths are switched on, which a user's PC may not have.
    param([string[]]$Targets, [string]$Root, [int]$Limit = 259)
    $prefix = $Root.TrimEnd('').Length + 1
    return @($Targets | Where-Object { $prefix + $_.Length -gt $Limit })
}

function Write-ReleaseEnv {
    # release.env is shipped and replaced on every update: pinned images, the support mail account, and the
    # settings that keep an installed copy private to this PC.
    # Version and UpdateUrl let Start VisHeart tell the user when the team publishes a newer version.
    param([hashtable]$Images, [string]$SmtpEnvPath, [string]$OutPath, [string]$Version, [string]$UpdateUrl)
    if (-not (Test-Path $SmtpEnvPath)) {
        throw "installer\smtp.release.env not found ($SmtpEnvPath). Copy smtp.release.env.example to smtp.release.env and fill in the team support account; without it the FAQ cannot send mail."
    }
    $smtp = Read-EnvValues $SmtpEnvPath
    foreach ($key in @('VH_SUPPORT_EMAIL', 'VH_SMTP_USER', 'VH_SMTP_PASS')) {
        if (-not $smtp[$key]) { throw "smtp.release.env has no value for $key." }
    }
    $lines = @('# VisHeart release settings. Shipped by the installer and replaced on every update; do not edit.')
    foreach ($key in @('VH_APP_IMAGE', 'VH_GPU_IMAGE', 'VH_MINIO_IMAGE')) {
        if (-not $Images[$key]) { throw "release.json has no image for $key." }
        $lines += "$key=$($Images[$key])"
    }
    foreach ($key in @('VH_SUPPORT_EMAIL', 'VH_SMTP_USER', 'VH_SMTP_PASS')) { $lines += "$key=$($smtp[$key])" }
    $lines += 'VH_BIND=127.0.0.1'      # patient data: nothing is reachable from other computers
    $lines += 'VH_MINIO_ANON=none'     # no anonymous downloads from the storage bucket
    # Its own compose project: containers, network and data volumes stay apart from a developer copy on the same PC.
    $lines += 'COMPOSE_PROJECT_NAME=visheart'
    if ($Version) { $lines += "VH_VERSION=$Version" }
    if ($UpdateUrl) { $lines += "VH_UPDATE_URL=$UpdateUrl" }
    $utf8 = New-Object System.Text.UTF8Encoding($false)   # compose rejects a byte order mark
    [IO.File]::WriteAllText($OutPath, (($lines -join "`r`n") + "`r`n"), $utf8)
}

function Get-InnoCandidates {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
        (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
    )
    $onPath = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($onPath) { $candidates += $onPath.Source }
    return @($candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique)
}

function Get-FileVersion([string]$Path) {
    $info = (Get-Item -LiteralPath $Path).VersionInfo
    return [version]('{0}.{1}.{2}' -f $info.FileMajorPart, $info.FileMinorPart, $info.FileBuildPart)
}

function Find-InnoCompiler {
    # Path of an ISCC.exe from Inno Setup 6.5.2 or later (needed for installers over 2 GB), or $null.
    # Inno Setup 6.7+ ships ISCC.exe with no version resource (0.0.0): such a compiler is used only when no
    # known-good one exists, and visheart.iss then refuses to compile on anything older than 6.5.2.
    $unknown = $null
    foreach ($candidate in Get-InnoCandidates) {
        $version = Get-FileVersion $candidate
        if ($version -ge [version]'6.5.2') { return $candidate }
        if ($version -eq [version]'0.0.0' -and -not $unknown) { $unknown = $candidate }
    }
    return $unknown
}

Export-ModuleMember -Function Get-StagingSelection, Get-ShippedModelNames, Get-UnexpectedModelFiles, Test-ImageOnRegistry, Test-ReleaseImages, Test-ModelMatchesPack, Get-LongPaths,
    Write-ReleaseEnv, Get-InnoCandidates, Get-FileVersion, Find-InnoCompiler
