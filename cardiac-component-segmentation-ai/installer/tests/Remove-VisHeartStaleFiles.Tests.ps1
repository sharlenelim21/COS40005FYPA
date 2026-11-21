# Pester 3.4 tests for installer/scripts/Remove-VisHeartStaleFiles.ps1: on an update, files the old version shipped
# that the new one no longer ships are removed; nothing else is.
# Run from installer:  Invoke-Pester .\tests\Remove-VisHeartStaleFiles.Tests.ps1

$script:Remove = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\Remove-VisHeartStaleFiles.ps1'

function New-UpdatedApp {
    # An install folder after the new version's files were copied, with the old version's list saved apart.
    $root = Join-Path $env:TEMP ("vh-stale-" + [guid]::NewGuid())
    $app = Join-Path $root 'VisHeart'
    foreach ($f in @('app\kept.py', 'app\gone.py', 'app\old-only\gone2.py', 'app\mixed\gone3.py', 'app\mixed\user-data.json',
            'app\secrets.env', 'outside.txt')) {
        $p = if ($f -eq 'outside.txt') { Join-Path $root $f } else { Join-Path $app $f }
        New-Item -ItemType Directory (Split-Path -Parent $p) -Force | Out-Null
        Set-Content $p 'x' -Encoding ASCII
    }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllLines((Join-Path $app 'shipped-files.txt'), [string[]]@('app\kept.py'), $utf8)
    [IO.File]::WriteAllLines((Join-Path $root 'old.txt'), [string[]]@('app\kept.py', 'app\gone.py', 'app\old-only\gone2.py',
        'app\mixed\gone3.py', '..\outside.txt', 'C:\Windows\win.ini', '\outside.txt', ''), $utf8)
    return @{ Root = $root; App = $app; Old = (Join-Path $root 'old.txt') }
}

Describe 'Remove-VisHeartStaleFiles' {
    It 'removes the files only the old version shipped, and the folders that become empty' {
        $t = New-UpdatedApp
        try {
            & $script:Remove -AppDir $t.App -OldList $t.Old | Out-Null
            $LASTEXITCODE | Should Be 0
            Test-Path (Join-Path $t.App 'app\gone.py') | Should Be $false
            Test-Path (Join-Path $t.App 'app\old-only') | Should Be $false
            Test-Path (Join-Path $t.App 'app\mixed\gone3.py') | Should Be $false
        } finally { Remove-Item -Recurse -Force $t.Root }
    }

    It 'keeps the new version''s files and everything no installer shipped (data, passwords)' {
        $t = New-UpdatedApp
        try {
            & $script:Remove -AppDir $t.App -OldList $t.Old | Out-Null
            Test-Path (Join-Path $t.App 'app\kept.py') | Should Be $true
            Test-Path (Join-Path $t.App 'app\mixed\user-data.json') | Should Be $true
            Test-Path (Join-Path $t.App 'app\secrets.env') | Should Be $true
        } finally { Remove-Item -Recurse -Force $t.Root }
    }

    It 'never touches a path outside the install folder' {
        $t = New-UpdatedApp
        try {
            & $script:Remove -AppDir $t.App -OldList $t.Old | Out-Null
            Test-Path (Join-Path $t.Root 'outside.txt') | Should Be $true
        } finally { Remove-Item -Recurse -Force $t.Root }
    }

    It 'removes nothing when the new version''s list is missing' {
        $t = New-UpdatedApp
        try {
            Remove-Item (Join-Path $t.App 'shipped-files.txt')
            & $script:Remove -AppDir $t.App -OldList $t.Old | Out-Null
            $LASTEXITCODE | Should Be 0
            Test-Path (Join-Path $t.App 'app\gone.py') | Should Be $true
        } finally { Remove-Item -Recurse -Force $t.Root }
    }
}
