# Pester 3.4 tests for installer/scripts/New-VisHeartSecrets.ps1.
# Run from cardiac-component-segmentation-ai:  Invoke-Pester .\installer\tests

$script = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\New-VisHeartSecrets.ps1'

$expectedKeys = @('VH_MONGO_PASSWORD', 'VH_MONGO_PASSWORD_URL', 'VH_MINIO_PASSWORD', 'REDIS_PASSWORD', 'VH_ADMIN_PASS',
    'VH_JWT_SECRET', 'VH_SESSION_SECRET', 'VH_GPU_ACCESS_SECRET', 'VH_GPU_JWT_SECRET', 'VH_GPU_SERVER_AUTH_JWT_SECRET')
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function New-TempDir {
    $d = Join-Path $env:TEMP ("vh-secrets-" + [guid]::NewGuid())
    New-Item -ItemType Directory $d | Out-Null
    return $d
}

function Read-EnvFile([string]$Path) {
    $map = [ordered]@{}
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        if ($line -match '^([A-Z0-9_]+)=(.*)$') { $map[$Matches[1]] = $Matches[2] }
    }
    return $map
}

function Invoke-Secrets([string]$Dir) {
    & $script -DeploymentDir $Dir -LoginNotePath (Join-Path $Dir 'FIRST-LOGIN.txt')
    return $LASTEXITCODE
}

Describe 'New-VisHeartSecrets.ps1' {
    It 'writes all secret keys' {
        $d = New-TempDir
        try {
            Invoke-Secrets $d | Should Be 0
            $env = Read-EnvFile (Join-Path $d 'secrets.env')
            (@($env.Keys) | Sort-Object) -join ',' | Should Be (($expectedKeys | Sort-Object) -join ',')
            $env['VH_MONGO_PASSWORD_URL'] | Should Be $env['VH_MONGO_PASSWORD']
        } finally { Remove-Item -Recurse -Force $d }
    }

    It 'machine secrets are 32 alphanumeric chars' {
        $d1 = New-TempDir; $d2 = New-TempDir
        try {
            Invoke-Secrets $d1 | Out-Null; Invoke-Secrets $d2 | Out-Null
            $a = Read-EnvFile (Join-Path $d1 'secrets.env')
            $b = Read-EnvFile (Join-Path $d2 'secrets.env')
            foreach ($k in $expectedKeys | Where-Object { $_ -ne 'VH_ADMIN_PASS' }) {
                $a[$k] | Should Match '^[A-Za-z0-9]{32}$'
                if ($k -ne 'VH_MONGO_PASSWORD_URL') { $a[$k] | Should Not Be $b[$k] }
            }
            # Every generated secret differs from the others on the same PC.
            @($a.Keys | Where-Object { $_ -notin 'VH_MONGO_PASSWORD_URL' } | ForEach-Object { $a[$_] } | Select-Object -Unique).Count |
                Should Be ($expectedKeys.Count - 1)
        } finally { Remove-Item -Recurse -Force $d1, $d2 }
    }

    It 'admin password meets the login rules' {
        $d = New-TempDir
        try {
            Invoke-Secrets $d | Out-Null
            $p = (Read-EnvFile (Join-Path $d 'secrets.env'))['VH_ADMIN_PASS']
            $p.Length | Should Be 16
            $p | Should Match '[A-Z]'
            $p | Should Match '[a-z]'
            $p | Should Match '[0-9]'
            $p | Should Match '[!@#%]'
            $p | Should Match '^[A-Za-z0-9!@#%]{16}$'
        } finally { Remove-Item -Recurse -Force $d }
    }

    It 'secrets file is not rewritten on second run' {
        $d = New-TempDir
        try {
            Invoke-Secrets $d | Out-Null
            $file = Join-Path $d 'secrets.env'
            $before = [IO.File]::ReadAllBytes($file)
            $stamp = (Get-Item $file).LastWriteTimeUtc
            Start-Sleep -Milliseconds 50
            Invoke-Secrets $d | Should Be 0
            [Convert]::ToBase64String([IO.File]::ReadAllBytes($file)) | Should Be ([Convert]::ToBase64String($before))
            (Get-Item $file).LastWriteTimeUtc | Should Be $stamp
        } finally { Remove-Item -Recurse -Force $d }
    }

    It 'an older secrets.env without REDIS_PASSWORD gets only that key added' {
        $d = New-TempDir
        try {
            $file = Join-Path $d 'secrets.env'
            # As versions before REDIS_PASSWORD wrote it: every other key, then the comment lines.
            $old = (@($expectedKeys | Where-Object { $_ -ne 'REDIS_PASSWORD' } | ForEach-Object { "$_=Older$($_ -replace '_', '')" }) +
                '# VisHeart passwords and secrets for this PC, created by the installer. Keep this file private.') -join "`r`n"
            $old += "`r`n"
            [IO.File]::WriteAllText($file, $old, $utf8NoBom)
            Invoke-Secrets $d | Should Be 0
            $after = [IO.File]::ReadAllText($file)
            $after.StartsWith($old) | Should Be $true
            $after.Substring($old.Length) | Should Match '^REDIS_PASSWORD=[A-Za-z0-9]{32}\r\n$'
            # The admin password did not change, so no new login note.
            Test-Path (Join-Path $d 'FIRST-LOGIN.txt') | Should Be $false
            # The next run finds the key and leaves the file alone.
            Invoke-Secrets $d | Should Be 0
            [IO.File]::ReadAllText($file) | Should Be $after
        } finally { Remove-Item -Recurse -Force $d }
    }

    It 'the added key gets its own line when the older file has no final line break' {
        $d = New-TempDir
        try {
            $file = Join-Path $d 'secrets.env'
            [IO.File]::WriteAllText($file, 'VH_MONGO_PASSWORD=KeepMe', $utf8NoBom)
            Invoke-Secrets $d | Should Be 0
            $env = Read-EnvFile $file
            $env['VH_MONGO_PASSWORD'] | Should Be 'KeepMe'
            $env['REDIS_PASSWORD'] | Should Match '^[A-Za-z0-9]{32}$'
        } finally { Remove-Item -Recurse -Force $d }
    }

    It 'writes UTF-8 without a byte order mark' {
        $d = New-TempDir
        try {
            Invoke-Secrets $d | Out-Null
            $bytes = [IO.File]::ReadAllBytes((Join-Path $d 'secrets.env'))
            ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB) | Should Be $false
            [char]$bytes[0] | Should Be 'V'
        } finally { Remove-Item -Recurse -Force $d }
    }

    It 'login note' {
        $d = New-TempDir
        try {
            Invoke-Secrets $d | Out-Null
            $p = (Read-EnvFile (Join-Path $d 'secrets.env'))['VH_ADMIN_PASS']
            $note = Get-Content -Raw (Join-Path $d 'FIRST-LOGIN.txt')
            $note | Should Match 'admin'
            $note.Contains($p) | Should Be $true
            $note | Should Match ([regex]::Escape('http://localhost:3000'))
            $note | Should Match ([regex]::Escape('Change this password after your first login:'))
            $note | Should Match ([regex]::Escape('Profile Settings'))
            $note | Should Match ([regex]::Escape('http://localhost:3000/profile'))
            $note | Should Match ([regex]::Escape('If you already changed the admin password, this password no longer works'))
        } finally { Remove-Item -Recurse -Force $d }
    }

    It 'returns 1 when the folder cannot be written' {
        $missing = Join-Path $env:TEMP ("vh-missing-" + [guid]::NewGuid() + '\no\such')
        & $script -DeploymentDir $missing -LoginNotePath (Join-Path $missing 'FIRST-LOGIN.txt') 2>$null
        $LASTEXITCODE | Should Be 1
    }
}
