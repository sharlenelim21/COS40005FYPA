# Pester 3.4 tests for lib/VisHeartStart.psm1.
# Run from visheart-local-deployment:  Invoke-Pester .\tests\VisHeartStart.Tests.ps1

$modulePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib\VisHeartStart.psm1'
Get-Module VisHeartStart | Remove-Module -Force
Import-Module $modulePath -Force

$fakeExe = 'C:\fake\Docker Desktop.exe'
$pipe = '\\.\pipe\docker_engine'

Describe 'Get-ComposeEnvArgs' {
    It 'returns nothing when neither env file exists' {
        $dir = Join-Path $env:TEMP ("vh-env-" + [guid]::NewGuid())
        New-Item -ItemType Directory $dir | Out-Null
        try { @(Get-ComposeEnvArgs $dir).Count | Should Be 0 }
        finally { Remove-Item -Recurse -Force $dir }
    }

    It 'returns release.env then secrets.env when both exist' {
        $dir = Join-Path $env:TEMP ("vh-env-" + [guid]::NewGuid())
        New-Item -ItemType Directory $dir | Out-Null
        try {
            Set-Content (Join-Path $dir 'secrets.env') 'A=1'
            Set-Content (Join-Path $dir 'release.env') 'B=2'
            $result = @(Get-ComposeEnvArgs $dir)
            $result -join '|' | Should Be ("--env-file|$dir\release.env|--env-file|$dir\secrets.env")
        }
        finally { Remove-Item -Recurse -Force $dir }
    }

    It 'returns only the file that exists' {
        $dir = Join-Path $env:TEMP ("vh-env-" + [guid]::NewGuid())
        New-Item -ItemType Directory $dir | Out-Null
        try {
            Set-Content (Join-Path $dir 'secrets.env') 'A=1'
            (@(Get-ComposeEnvArgs $dir) -join '|') | Should Be ("--env-file|$dir\secrets.env")
        }
        finally { Remove-Item -Recurse -Force $dir }
    }
}

Describe 'Wait-DockerReady' {
    Mock -ModuleName VisHeartStart Start-Sleep {}
    Mock -ModuleName VisHeartStart Start-Process {}
    $connectError = { 'error during connect: The system cannot find the file specified.' }

    Context 'returns ok at once when docker answers, without starting Docker Desktop' {
        It 'returns ok at once when docker answers, without starting Docker Desktop' {
            Mock -ModuleName VisHeartStart Get-LastDockerOutput $connectError
            Mock -ModuleName VisHeartStart Invoke-Docker { 0 }
            $r = Wait-DockerReady -TimeoutSec 5 -DesktopExe $fakeExe
            $r.Ready | Should Be $true
            $r.Reason | Should Be 'ok'
            Assert-MockCalled -Scope It -ModuleName VisHeartStart Start-Process -Times 0 -Exactly
        }
    }

    Context 'returns not-installed when docker fails and Docker Desktop is missing' {
        It 'returns not-installed when docker fails and Docker Desktop is missing' {
            Mock -ModuleName VisHeartStart Get-LastDockerOutput $connectError
            Mock -ModuleName VisHeartStart Invoke-Docker { 1 }
            Mock -ModuleName VisHeartStart Test-Path { $false }
            $r = Wait-DockerReady -TimeoutSec 5 -DesktopExe $fakeExe
            $r.Ready | Should Be $false
            $r.Reason | Should Be 'not-installed'
        }
    }

    Context 'starts Docker Desktop once and returns ok when docker answers on the third try' {
        It 'starts Docker Desktop once and returns ok when docker answers on the third try' {
            Mock -ModuleName VisHeartStart Get-LastDockerOutput $connectError
            $global:VhDockerCalls = 0
            Mock -ModuleName VisHeartStart Invoke-Docker { $global:VhDockerCalls++; if ($global:VhDockerCalls -ge 3) { 0 } else { 1 } }
            Mock -ModuleName VisHeartStart Test-Path { $true } -ParameterFilter { $Path -eq $fakeExe }
            Mock -ModuleName VisHeartStart Test-Path { $false } -ParameterFilter { $Path -like '\\.\pipe\*' }
            $r = Wait-DockerReady -TimeoutSec 60 -DesktopExe $fakeExe
            $r.Reason | Should Be 'ok'
            $r.Ready | Should Be $true
            Assert-MockCalled -Scope It -ModuleName VisHeartStart Start-Process -Times 1 -Exactly
            Remove-Variable -Scope Global VhDockerCalls
        }
    }

    Context 'returns timeout when docker never answers' {
        It 'returns timeout when docker never answers' {
            Mock -ModuleName VisHeartStart Get-LastDockerOutput $connectError
            Mock -ModuleName VisHeartStart Invoke-Docker { 1 }
            Mock -ModuleName VisHeartStart Test-Path { $true } -ParameterFilter { $Path -eq $fakeExe }
            Mock -ModuleName VisHeartStart Test-Path { $false } -ParameterFilter { $Path -like '\\.\pipe\*' }
            $r = Wait-DockerReady -TimeoutSec 0 -DesktopExe $fakeExe
            $r.Ready | Should Be $false
            $r.Reason | Should Be 'timeout'
        }
    }

    Context 'returns no-access when the Docker pipe exists but this account is refused' {
        It 'returns no-access when the Docker pipe exists but this account is refused' {
            Mock -ModuleName VisHeartStart Invoke-Docker { 1 }
            Mock -ModuleName VisHeartStart Get-LastDockerOutput { 'open //./pipe/docker_engine: Access is denied.' }
            Mock -ModuleName VisHeartStart Test-Path { $true }
            $r = Wait-DockerReady -TimeoutSec 60 -DesktopExe $fakeExe
            $r.Ready | Should Be $false
            $r.Reason | Should Be 'no-access'
            Assert-MockCalled -Scope It -ModuleName VisHeartStart Start-Process -Times 0 -Exactly
        }
    }

    Context 'treats "permission denied" the same as "Access is denied"' {
        It 'treats "permission denied" the same as "Access is denied"' {
            Mock -ModuleName VisHeartStart Invoke-Docker { 1 }
            Mock -ModuleName VisHeartStart Get-LastDockerOutput { 'permission denied while trying to connect to the docker API at npipe:////./pipe/docker_engine' }
            Mock -ModuleName VisHeartStart Test-Path { $true }
            (Wait-DockerReady -TimeoutSec 60 -DesktopExe $fakeExe).Reason | Should Be 'no-access'
        }
    }

    Context 'no-access through the newer Docker Desktop pipe' {
        It 'returns no-access when only the dockerDesktopLinuxEngine pipe exists' {
            Mock -ModuleName VisHeartStart Invoke-Docker { 1 }
            Mock -ModuleName VisHeartStart Get-LastDockerOutput { 'open //./pipe/dockerDesktopLinuxEngine: Access is denied.' }
            Mock -ModuleName VisHeartStart Test-Path { $false }
            Mock -ModuleName VisHeartStart Test-Path { $true } -ParameterFilter { $Path -eq '\\.\pipe\dockerDesktopLinuxEngine' }
            (Wait-DockerReady -TimeoutSec 0 -DesktopExe $fakeExe).Reason | Should Be 'no-access'
        }
    }
}

Describe 'Invoke-FirstPull' {
    $composeArgs = @('compose', '--profile', 'cpu')
    Mock -ModuleName VisHeartStart Write-Host {}
    $imageList = { @('mongo:7.0', 'sharlene21/visheart-gpu:1.0') }

    It 'pulls when an image is missing' {
        Mock -ModuleName VisHeartStart Get-LastDockerOutput $imageList
        Mock -ModuleName VisHeartStart Invoke-Docker {
            if ($Arguments -contains 'inspect' -and $Arguments -contains 'sharlene21/visheart-gpu:1.0') { 1 } else { 0 }
        }
        Invoke-FirstPull $composeArgs @('visheart-app', 'gpu-cpu') | Should Be 0
        Assert-MockCalled -Scope It -ModuleName VisHeartStart Invoke-Docker -Times 1 -Exactly -ParameterFilter { $Arguments -contains 'pull' }
        Assert-MockCalled -Scope It -ModuleName VisHeartStart Write-Host -ParameterFilter { "$Object" -like 'First start: downloading VisHeart*' }
    }

    It 'does not pull when every image is present' {
        Mock -ModuleName VisHeartStart Get-LastDockerOutput $imageList
        Mock -ModuleName VisHeartStart Invoke-Docker { 0 }
        Invoke-FirstPull $composeArgs @('visheart-app', 'gpu-cpu') | Should Be 0
        Assert-MockCalled -Scope It -ModuleName VisHeartStart Invoke-Docker -Times 0 -Exactly -ParameterFilter { $Arguments -contains 'pull' }
    }

    It 'returns the pull exit code when the download fails' {
        Mock -ModuleName VisHeartStart Get-LastDockerOutput $imageList
        Mock -ModuleName VisHeartStart Invoke-Docker {
            if ($Arguments -contains 'pull') { 18 }
            elseif ($Arguments -contains 'inspect') { 1 }
            else { 0 }
        }
        Invoke-FirstPull $composeArgs @('visheart-app', 'gpu-cpu') | Should Be 18
    }
}

# An installed copy makes new passwords, but MongoDB keeps the ones its data volume was first created with. A volume
# left by a developer copy (same folder name, so same volume) or by an earlier install would lock VisHeart out.
Describe 'Test-DatabaseVolume' {
    function New-DeployDir([switch]$Installed, [switch]$Marker) {
        $dir = Join-Path $env:TEMP ("vh-db-" + [guid]::NewGuid()) | Join-Path -ChildPath 'visheart-local-deployment'
        New-Item -ItemType Directory $dir | Out-Null
        if ($Installed) { Set-Content (Join-Path $dir 'secrets.env') 'VH_MONGO_PASSWORD=x' }
        if ($Marker) { Set-Content (Join-Path $dir 'database.owner') 'x' }
        return $dir
    }

    Context 'a developer copy (no secrets.env)' {
        Mock -ModuleName VisHeartStart Invoke-Docker { 0 }
        It 'is fine and asks Docker nothing' {
            $dir = New-DeployDir
            try {
                (Test-DatabaseVolume $dir).Ok | Should Be $true
                Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 0 -Scope It
            } finally { Remove-Item -Recurse -Force (Split-Path -Parent $dir) }
        }
    }

    Context 'an installed copy whose volume does not exist yet' {
        Mock -ModuleName VisHeartStart Invoke-Docker { 1 }
        It 'is fine, and records that this copy owns the database it is about to create' {
            $dir = New-DeployDir -Installed
            try {
                (Test-DatabaseVolume $dir).Ok | Should Be $true
                Test-Path (Join-Path $dir 'database.owner') | Should Be $true
                Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 1 -Scope It -ParameterFilter {
                    ($Arguments -join ' ') -eq 'volume inspect visheart-local-deployment_mongodb_data' }
            } finally { Remove-Item -Recurse -Force (Split-Path -Parent $dir) }
        }
    }

    Context 'an installed copy that already owns its database' {
        Mock -ModuleName VisHeartStart Invoke-Docker { 0 }
        It 'is fine' {
            $dir = New-DeployDir -Installed -Marker
            try { (Test-DatabaseVolume $dir).Ok | Should Be $true }
            finally { Remove-Item -Recurse -Force (Split-Path -Parent $dir) }
        }
    }

    Context 'an installed copy finding a database it did not create' {
        Mock -ModuleName VisHeartStart Invoke-Docker { 0 }
        It 'stops and names the volume' {
            $dir = New-DeployDir -Installed
            try {
                $r = Test-DatabaseVolume $dir
                $r.Ok | Should Be $false
                $r.Volume | Should Be 'visheart-local-deployment_mongodb_data'
                Test-Path (Join-Path $dir 'database.owner') | Should Be $false
            } finally { Remove-Item -Recurse -Force (Split-Path -Parent $dir) }
        }
    }
}

Describe 'Test-DatabaseVolume with a named project' {
    Context 'an installed copy whose release.env names its compose project' {
        Mock -ModuleName VisHeartStart Invoke-Docker { 1 }
        It 'checks the volume of that project, not one named after the folder' {
            $dir = Join-Path $env:TEMP ("vh-db-" + [guid]::NewGuid()) | Join-Path -ChildPath 'visheart-local-deployment'
            New-Item -ItemType Directory $dir | Out-Null
            Set-Content (Join-Path $dir 'secrets.env') 'VH_MONGO_PASSWORD=x'
            Set-Content (Join-Path $dir 'release.env') @('VH_APP_IMAGE=a/app:1', 'COMPOSE_PROJECT_NAME=visheart') -Encoding ASCII
            try {
                (Test-DatabaseVolume $dir).Volume | Should Be 'visheart_mongodb_data'
                Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 1 -Scope It -ParameterFilter {
                    ($Arguments -join ' ') -eq 'volume inspect visheart_mongodb_data' }
            } finally { Remove-Item -Recurse -Force (Split-Path -Parent $dir) }
        }
    }
}

Describe 'Remove-OtherCopyContainers' {
    function New-Dir([switch]$Installed) {
        $dir = Join-Path $env:TEMP ("vh-cc-" + [guid]::NewGuid())
        New-Item -ItemType Directory $dir | Out-Null
        if ($Installed) { Set-Content (Join-Path $dir 'release.env') 'COMPOSE_PROJECT_NAME=visheart' -Encoding ASCII }
        return $dir
    }

    Context 'a developer copy (no release.env)' {
        Mock -ModuleName VisHeartStart Invoke-Docker { 0 }
        It 'removes nothing and asks Docker nothing' {
            $dir = New-Dir
            try {
                @(Remove-OtherCopyContainers $dir).Count | Should Be 0
                Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 0 -Scope It
            } finally { Remove-Item -Recurse -Force $dir }
        }
    }

    Context 'an installed copy on a PC that also has a developer copy' {
        Mock -ModuleName VisHeartStart Invoke-Docker { 0 }
        Mock -ModuleName VisHeartStart Get-LastDockerOutput {
            @('visheart-local|visheart-local-deployment', 'visheart-redis|visheart', 'visheart-minio|') }
        It 'removes the containers that are not its own (their data volumes stay) and keeps its own' {
            $dir = New-Dir -Installed
            try {
                $removed = @(Remove-OtherCopyContainers $dir)
                ($removed -join ',') | Should Be 'visheart-local,visheart-minio'
                Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 1 -Scope It -ParameterFilter {
                    ($Arguments -join ' ') -eq 'rm -f visheart-local' }
                Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 1 -Scope It -ParameterFilter {
                    ($Arguments -join ' ') -eq 'rm -f visheart-minio' }
                Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 0 -Scope It -ParameterFilter {
                    ($Arguments -join ' ') -eq 'rm -f visheart-redis' }
                Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 0 -Scope It -ParameterFilter {
                    ($Arguments -join ' ') -match '\bvolume\b|-v\b' }
            } finally { Remove-Item -Recurse -Force $dir }
        }
    }
}

Describe 'Get-UpdateNotice' {
    function New-ReleaseDir([string]$Version, [string]$Url = 'https://example.test/latest.json') {
        $dir = Join-Path $env:TEMP ("vh-upd-" + [guid]::NewGuid())
        New-Item -ItemType Directory $dir | Out-Null
        $lines = @('VH_APP_IMAGE=a/app:1')
        if ($Version) { $lines += "VH_VERSION=$Version" }
        if ($Url) { $lines += "VH_UPDATE_URL=$Url" }
        Set-Content (Join-Path $dir 'release.env') $lines -Encoding ASCII
        return $dir
    }

    Context 'a developer copy (no release.env)' {
        Mock -ModuleName VisHeartStart Invoke-UpdateFeed { throw 'must not be called' }
        It 'never checks' {
            $dir = Join-Path $env:TEMP ("vh-upd-" + [guid]::NewGuid())
            New-Item -ItemType Directory $dir | Out-Null
            try {
                Get-UpdateNotice $dir | Should BeNullOrEmpty
                Assert-MockCalled -ModuleName VisHeartStart Invoke-UpdateFeed -Times 0 -Scope It
            } finally { Remove-Item -Recurse -Force $dir }
        }
    }

    Context 'a newer version is published' {
        Mock -ModuleName VisHeartStart Invoke-UpdateFeed {
            [pscustomobject]@{ version = '1.0.10'; download = 'https://drive.google.com/x'; note = 'Fixes the export.' } }
        It 'returns the new version, its link and note' {
            $dir = New-ReleaseDir '1.0.9'
            try {
                $n = Get-UpdateNotice $dir
                $n.Version | Should Be '1.0.10'
                $n.Download | Should Be 'https://drive.google.com/x'
                $n.Note | Should Be 'Fixes the export.'
                Assert-MockCalled -ModuleName VisHeartStart Invoke-UpdateFeed -Times 1 -Scope It -ParameterFilter { $Url -eq 'https://example.test/latest.json' }
            } finally { Remove-Item -Recurse -Force $dir }
        }
    }

    Context 'the published version is not newer' {
        Mock -ModuleName VisHeartStart Invoke-UpdateFeed { [pscustomobject]@{ version = '1.0.0'; download = 'https://x' } }
        It 'returns nothing for the same or an older version' {
            foreach ($installed in @('1.0.0', '1.2.0')) {
                $dir = New-ReleaseDir $installed
                try { Get-UpdateNotice $dir | Should BeNullOrEmpty }
                finally { Remove-Item -Recurse -Force $dir }
            }
        }
    }

    Context 'the check cannot complete' {
        Mock -ModuleName VisHeartStart Invoke-UpdateFeed { throw 'offline' }
        It 'returns nothing when the feed cannot be read' {
            $dir = New-ReleaseDir '1.0.0'
            try { Get-UpdateNotice $dir | Should BeNullOrEmpty }
            finally { Remove-Item -Recurse -Force $dir }
        }
        It 'returns nothing without a version or an address in release.env' {
            foreach ($dir in @((New-ReleaseDir '' 'https://example.test/latest.json'), (New-ReleaseDir '1.0.0' ''))) {
                try { Get-UpdateNotice $dir | Should BeNullOrEmpty }
                finally { Remove-Item -Recurse -Force $dir }
            }
        }
    }

    Context 'the feed holds a bad version or link' {
        Mock -ModuleName VisHeartStart Invoke-UpdateFeed { [pscustomobject]@{ version = 'soon'; download = 'https://x' } }
        It 'ignores a version that is not a number' {
            $dir = New-ReleaseDir '1.0.0'
            try { Get-UpdateNotice $dir | Should BeNullOrEmpty }
            finally { Remove-Item -Recurse -Force $dir }
        }
    }

    Context 'the feed links somewhere that is not https' {
        Mock -ModuleName VisHeartStart Invoke-UpdateFeed { [pscustomobject]@{ version = '2.0.0'; download = 'file://C:/x.exe' } }
        It 'still tells about the version but drops the link' {
            $dir = New-ReleaseDir '1.0.0'
            try {
                $n = Get-UpdateNotice $dir
                $n.Version | Should Be '2.0.0'
                $n.Download | Should BeNullOrEmpty
            } finally { Remove-Item -Recurse -Force $dir }
        }
    }
}

Describe 'Remove-VisHeartDocker' {
    $dir = Join-Path $env:TEMP ("vh-rm-" + [guid]::NewGuid())
    New-Item -ItemType Directory $dir | Out-Null
    Set-Content (Join-Path $dir 'release.env') 'COMPOSE_PROJECT_NAME=visheart' -Encoding ASCII
    $compose = Join-Path $dir 'docker-compose.yml'

    Context 'Docker Desktop cannot be started' {
        Mock -ModuleName VisHeartStart Wait-DockerReady { [pscustomobject]@{ Ready = $false; Reason = 'timeout' } }
        Mock -ModuleName VisHeartStart Invoke-Docker { 0 }
        It 'removes nothing and says Docker was not ready' {
            Remove-VisHeartDocker $dir -DeleteData | Should Be 2
            Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 0 -Scope It
        }
    }

    Context 'keeping the data' {
        Mock -ModuleName VisHeartStart Wait-DockerReady { [pscustomobject]@{ Ready = $true; Reason = 'ok' } }
        Mock -ModuleName VisHeartStart Invoke-Docker { 0 }
        It 'removes the containers of this copy only, and keeps volumes and images' {
            Remove-VisHeartDocker $dir | Should Be 0
            Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 1 -Scope It -ParameterFilter {
                ($Arguments -join ' ') -eq "compose -f $compose --env-file $(Join-Path $dir 'release.env') --profile cpu --profile gpu down --remove-orphans" }
            Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 0 -Scope It -ParameterFilter {
                ($Arguments -join ' ') -match ' -v|--rmi|^rm ' }
        }
    }

    Context 'deleting everything' {
        Mock -ModuleName VisHeartStart Wait-DockerReady { [pscustomobject]@{ Ready = $true; Reason = 'ok' } }
        Mock -ModuleName VisHeartStart Invoke-Docker { 0 }
        Mock -ModuleName VisHeartStart Get-LastDockerOutput { @('abc123', 'def456') }
        It 'removes containers, data volumes and downloaded images, then any visheart container left behind' {
            Remove-VisHeartDocker $dir -DeleteData | Should Be 0
            Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 1 -Scope It -ParameterFilter {
                ($Arguments -join ' ') -match 'down --remove-orphans -v --rmi all$' }
            Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 1 -Scope It -ParameterFilter {
                ($Arguments -join ' ') -eq 'ps -aq --filter name=visheart-' }
            Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 1 -Scope It -ParameterFilter {
                ($Arguments -join ' ') -eq 'rm -f abc123 def456' }
        }
    }

    Context 'compose cannot remove the data' {
        Mock -ModuleName VisHeartStart Wait-DockerReady { [pscustomobject]@{ Ready = $true; Reason = 'ok' } }
        Mock -ModuleName VisHeartStart Invoke-Docker { if ($Arguments[0] -eq 'compose') { 1 } else { 0 } }
        Mock -ModuleName VisHeartStart Get-LastDockerOutput { @() }
        It 'reports the failure, so the uninstaller keeps the passwords' {
            Remove-VisHeartDocker $dir -DeleteData | Should Be 1
        }
    }

    Remove-Item -Recurse -Force $dir
}

Describe 'Initialize-BackendFolders' {
    function New-Tree([switch]$Built) {
        $root = Join-Path $env:TEMP ("vh-bf-" + [guid]::NewGuid())
        $deploy = Join-Path $root 'visheart-local-deployment'
        New-Item -ItemType Directory $deploy | Out-Null
        $dist = Join-Path $root 'Cardiac_Segmentation_FYP_Server\dist'
        New-Item -ItemType Directory $dist | Out-Null
        if ($Built) { Set-Content (Join-Path $dist 'index.js') '//' }
        return $deploy
    }

    It 'creates the folders docker-compose.yml mounts volumes on, inside the read-only dist mount' {
        $deploy = New-Tree -Built
        try {
            (Initialize-BackendFolders $deploy).Built | Should Be $true
            $dist = Join-Path (Split-Path -Parent $deploy) 'Cardiac_Segmentation_FYP_Server\dist'
            foreach ($name in 'temp_jpeg', 'temp_mesh', 'temp_upload', 'temp_exports') {
                Test-Path (Join-Path $dist $name) -PathType Container | Should Be $true
            }
        } finally { Remove-Item -Recurse -Force (Split-Path -Parent $deploy) }
    }

    It 'says when the backend was never built' {
        $deploy = New-Tree
        try { (Initialize-BackendFolders $deploy).Built | Should Be $false }
        finally { Remove-Item -Recurse -Force (Split-Path -Parent $deploy) }
    }

    It 'every folder it creates is one docker-compose.yml mounts under dist' {
        $compose = Get-Content (Join-Path (Split-Path -Parent $PSScriptRoot) 'docker-compose.yml') -Raw
        $mounted = @([regex]::Matches($compose, '/app/backend/dist/(temp_\w+)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
        ($mounted -join ',') | Should Be 'temp_exports,temp_jpeg,temp_mesh,temp_upload'
    }
}
