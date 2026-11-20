<#
.SYNOPSIS
    Creates this PC's VisHeart passwords and secrets (secrets.env) and the first-login note.

.DESCRIPTION
    Run by the installer after the files are copied. An existing secrets.env is never rewritten: MongoDB, MinIO and
    the admin account were created with those values, so new ones would lock VisHeart out of its own data.
    Exit code 0 when the file was written or already exists, 1 on failure.
#>
param(
    [Parameter(Mandatory = $true)][string]$DeploymentDir,
    [Parameter(Mandatory = $true)][string]$LoginNotePath
)

$ErrorActionPreference = 'Stop'

$alphanumeric = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
$rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider

function Get-RandomIndex([int]$Count) {
    # Unbiased: reject bytes from the incomplete last block of 256.
    $limit = 256 - (256 % $Count)
    $buffer = New-Object byte[] 1
    do { $rng.GetBytes($buffer) } while ($buffer[0] -ge $limit)
    return $buffer[0] % $Count
}

function New-RandomString([int]$Length, [string]$Alphabet) {
    $chars = for ($i = 0; $i -lt $Length; $i++) { $Alphabet[(Get-RandomIndex $Alphabet.Length)] }
    return -join $chars
}

function New-AdminPassword {
    # 16 characters with at least one upper, lower, digit and symbol. Symbols are limited to !@#% so the value
    # needs no quoting in an env file or a shell.
    $sets = @('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789', '!@#%')
    $chars = New-Object System.Collections.Generic.List[char]
    foreach ($set in $sets) { $chars.Add($set[(Get-RandomIndex $set.Length)]) }
    $all = -join $sets
    while ($chars.Count -lt 16) { $chars.Add($all[(Get-RandomIndex $all.Length)]) }
    for ($i = $chars.Count - 1; $i -gt 0; $i--) {   # Fisher-Yates shuffle
        $j = Get-RandomIndex ($i + 1)
        $tmp = $chars[$i]; $chars[$i] = $chars[$j]; $chars[$j] = $tmp
    }
    return -join $chars
}

try {
    $secretsPath = Join-Path $DeploymentDir 'secrets.env'
    if (Test-Path $secretsPath) {
        Write-Host "secrets.env already exists; keeping this PC's passwords."
        exit 0
    }
    if (-not (Test-Path $DeploymentDir)) { throw "Folder not found: $DeploymentDir" }

    $mongo = New-RandomString 32 $alphanumeric
    $admin = New-AdminPassword
    $values = [ordered]@{
        VH_MONGO_PASSWORD             = $mongo
        # Alphanumeric, so the URL form needs no percent-encoding.
        VH_MONGO_PASSWORD_URL         = $mongo
        VH_MINIO_PASSWORD             = New-RandomString 32 $alphanumeric
        VH_ADMIN_PASS                 = $admin
        VH_JWT_SECRET                 = New-RandomString 32 $alphanumeric
        VH_SESSION_SECRET             = New-RandomString 32 $alphanumeric
        VH_GPU_ACCESS_SECRET          = New-RandomString 32 $alphanumeric
        VH_GPU_JWT_SECRET             = New-RandomString 32 $alphanumeric
        VH_GPU_SERVER_AUTH_JWT_SECRET = New-RandomString 32 $alphanumeric
    }

    $lines = @()
    foreach ($k in $values.Keys) { $lines += "$k=$($values[$k])" }
    $lines += '# VisHeart passwords and secrets for this PC, created by the installer. Keep this file private.'
    $lines += '# Do not edit or delete it: the database and storage were set up with these values.'
    # UTF-8 without a byte order mark: docker compose rejects a BOM before the first key.
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $content = ($lines -join "`r`n") + "`r`n"
    [IO.File]::WriteAllText($secretsPath, $content, $utf8)

    $note = @(
        'VisHeart - first login',
        '',
        'Open http://localhost:3000 after starting VisHeart (desktop icon "Start VisHeart").',
        '',
        'Username: admin',
        "Password: $admin",
        '',
        'Change this password after your first login.',
        'Then delete this file, or keep it somewhere safe: anyone who can read it can sign in as admin.'
    ) -join "`r`n"
    [IO.File]::WriteAllText($LoginNotePath, $note + "`r`n", $utf8)

    Write-Host "Created this PC's VisHeart passwords in $secretsPath"
    exit 0
} catch {
    Write-Error "Could not create VisHeart passwords: $($_.Exception.Message)" -ErrorAction Continue
    exit 1
} finally {
    $rng.Dispose()
}
