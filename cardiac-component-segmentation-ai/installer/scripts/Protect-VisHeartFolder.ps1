<#
.SYNOPSIS
    Sets the permissions of the VisHeart install folder.

.DESCRIPTION
    C:\VisHeart would inherit "Authenticated Users: Modify" from C:\, so any account on the PC could read the
    passwords or change stop.bat, which the installer runs as administrator on the next update. Instead:
      - Administrators and SYSTEM: full control.
      - docker-users (the accounts that can run VisHeart; Docker already gives them full control of the PC): modify.
      - Users: read and run, so another account still gets VisHeart's own "cannot use Docker" message.
      - The passwords, the login note, the training data, training jobs and exports: no access for Users.
      - -Account (the account that installed VisHeart): modify, on the folder and the private files. The installer adds
        it to docker-users, but Windows applies a new group only after signing out and in, and an administrator's
        normal window has no administrator rights; without its own entry its first Start VisHeart is denied access.
    Run by the installer as administrator on every install and update. Exit code 0 when done; 3 when the docker-users
    group does not exist (Docker Desktop is not installed), in which case nothing is changed; 1 when icacls fails.
#>
param(
    [Parameter(Mandatory = $true)][string]$AppDir,
    [string]$DockerGroup = 'docker-users',
    [string]$Account
)

$admins = '*S-1-5-32-544'
$system = '*S-1-5-18'
$users = '*S-1-5-32-545'
$app = 'cardiac-component-segmentation-ai'
$private = @(
    "$app\visheart-local-deployment\secrets.env",
    "$app\visheart-local-deployment\release.env",
    'FIRST-LOGIN.txt',
    "$app\visheart-training-data",
    "$app\visheart-retraining\jobs",
    "$app\Cardiac_Segmentation_FYP_Server\dist\temp_exports"
)

function Invoke-Icacls([string[]]$Arguments) {
    $output = & icacls @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "icacls $($Arguments -join ' ') failed: $output"
        exit 1
    }
}

try {
    [void](New-Object System.Security.Principal.NTAccount($DockerGroup)).Translate([System.Security.Principal.SecurityIdentifier])
} catch {
    Write-Host "The $DockerGroup group does not exist (is Docker Desktop installed?). The folder permissions were not changed."
    exit 3
}

$accountGrant = @()
$accountGrantPrivate = @()
if ($Account) {
    try {
        [void](New-Object System.Security.Principal.NTAccount($Account)).Translate([System.Security.Principal.SecurityIdentifier])
        $accountGrant = @("${Account}:(OI)(CI)M")
    } catch {
        Write-Host "Account $Account was not found; only $DockerGroup gets access."
    }
}

# The whole folder: no inherited rights from C:\. Windows passes these grants down to every file and subfolder that
# inherits (no /T: that would also cut each file off from the folder, leaving it with no rights at all).
Invoke-Icacls (@($AppDir, '/inheritance:r', '/grant:r', "${admins}:(OI)(CI)F", "${system}:(OI)(CI)F",
    "${DockerGroup}:(OI)(CI)M", "${users}:(OI)(CI)RX") + $accountGrant + @('/C', '/Q'))

foreach ($relative in $private) {
    $path = Join-Path $AppDir $relative
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $inherit = if (Test-Path -LiteralPath $path -PathType Container) { '(OI)(CI)' } else { '' }
    $own = @()
    if ($accountGrant) { $own = @("${Account}:${inherit}M") }
    Invoke-Icacls (@($path, '/inheritance:r', '/grant:r', "${admins}:${inherit}F", "${system}:${inherit}F",
        "${DockerGroup}:${inherit}M") + $own + @('/C', '/Q'))
}

Write-Host "Set the permissions of $AppDir."
exit 0
