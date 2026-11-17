# Pester 3.4 tests for installer/scripts/Protect-VisHeartFolder.ps1. They change the permissions of a real temp folder
# with icacls, so they need the docker-users group (Docker Desktop installed) and run as a member of it.
# Run from installer:  Invoke-Pester .\tests\Protect-VisHeartFolder.Tests.ps1

$script:Protect = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\Protect-VisHeartFolder.ps1'
$script:Deploy = 'cardiac-component-segmentation-ai\visheart-local-deployment'

function New-AppTree {
    # C:\VisHeart inherits "Authenticated Users: Modify" from C:\; a temp folder inherits similar rights from the profile.
    $app = Join-Path $env:TEMP ("vh-acl-" + [guid]::NewGuid())
    foreach ($f in @("$script:Deploy\stop.bat", "$script:Deploy\secrets.env", "$script:Deploy\release.env", 'FIRST-LOGIN.txt',
            'cardiac-component-segmentation-ai\visheart-training-data\PACKED.json')) {
        $p = Join-Path $app $f
        New-Item -ItemType Directory (Split-Path -Parent $p) -Force | Out-Null
        Set-Content $p 'x' -Encoding ASCII
    }
    return $app
}

function Remove-AppTree([string]$App) {
    # As owner we may always reset the permissions, even after Users lost write access.
    & icacls $App /reset /T /C /Q *> $null
    Remove-Item -Recurse -Force $App
}

function Get-Rights([string]$Path, [string]$Identity) {
    # FileSystemRights granted to an identity (account name or SID string) on a path, or '' when it has no entry.
    $acl = Get-Acl -LiteralPath $Path
    $rules = @($acl.Access | Where-Object {
        $sid = try { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { '' }
        $_.AccessControlType -eq 'Allow' -and ($_.IdentityReference.Value -like "*$Identity" -or $sid -eq $Identity) })
    return (($rules | ForEach-Object { $_.FileSystemRights.ToString() }) -join ',')
}

$users = 'S-1-5-32-545'
$authUsers = 'S-1-5-11'
$everyone = 'S-1-1-0'

Describe 'Protect-VisHeartFolder.ps1' {
    $app = New-AppTree
    & powershell -NoProfile -ExecutionPolicy Bypass -File $script:Protect -AppDir $app *> $null
    $code = $LASTEXITCODE

    It 'succeeds' {
        $code | Should Be 0
    }

    It 'no longer lets every signed-in account change VisHeart (stop.bat runs as administrator on update)' {
        $stop = Join-Path $app "$script:Deploy\stop.bat"
        Get-Rights $stop $authUsers | Should Be ''
        Get-Rights $stop $everyone | Should Be ''
        Get-Rights $stop $users | Should Match 'ReadAndExecute'
        Get-Rights $stop $users | Should Not Match 'Modify|Write|FullControl'
    }

    It 'lets docker-users (the accounts that run VisHeart) change its files' {
        Get-Rights (Join-Path $app "$script:Deploy\stop.bat") 'docker-users' | Should Match 'Modify'
        Get-Rights (Join-Path $app 'cardiac-component-segmentation-ai\visheart-training-data\PACKED.json') 'docker-users' | Should Match 'Modify'
    }

    It 'hides the passwords, the login note and the training data from other accounts' {
        foreach ($f in @("$script:Deploy\secrets.env", "$script:Deploy\release.env", 'FIRST-LOGIN.txt',
                'cardiac-component-segmentation-ai\visheart-training-data\PACKED.json')) {
            $p = Join-Path $app $f
            Get-Rights $p $users | Should Be ''
            Get-Rights $p $authUsers | Should Be ''
            Get-Rights $p 'docker-users' | Should Match 'Modify'
        }
    }

    It 'still lets this account (a docker-users member) read secrets.env, as docker compose must' {
        Get-Content (Join-Path $app "$script:Deploy\secrets.env") | Should Be 'x'
    }

    Remove-AppTree $app
}

Describe 'Protect-VisHeartFolder.ps1 without the group' {
    It 'changes nothing and exits 3 when the group does not exist (Docker Desktop failed to install)' {
        $app = New-AppTree
        try {
            $before = (Get-Acl -LiteralPath (Join-Path $app "$script:Deploy\stop.bat")).Sddl
            & powershell -NoProfile -ExecutionPolicy Bypass -File $script:Protect -AppDir $app -DockerGroup 'no-such-group-vh' *> $null
            $LASTEXITCODE | Should Be 3
            (Get-Acl -LiteralPath (Join-Path $app "$script:Deploy\stop.bat")).Sddl | Should Be $before
        } finally { Remove-AppTree $app }
    }
}
