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
            @('visheart-local|com.docker.compose.service=visheart-app,com.docker.compose.project=visheart-local-deployment',
              'visheart-redis|com.docker.compose.project=visheart,com.docker.compose.service=redis',
              'visheart-minio|') }
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
                # Windows PowerShell 5.1 strips double quotes inside native arguments, so docker got a broken
                # --format template ('function "com" not defined'; found testing the installer, 2026-11-18).
                Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 0 -Scope It -ParameterFilter {
                    ($Arguments -join ' ') -match '"' }
            } finally { Remove-Item -Recurse -Force $dir }
        }
    }
}

Describe 'Remove-OldVisHeartImages' {
    # A fake Docker: answers by the arguments of the last call (mock bodies run in the module, so the table lives there).
    function global:Get-FakeDockerAnswer([string]$Arguments) {
        $answers = @{
            'image inspect --format {{.Id}} a/app:2'        = @('sha256:app2')
            'image inspect --format {{.Id}} g/gpu@sha256:G' = @('sha256:gpuG')
            'image inspect --format {{.Id}} a/app:dev'      = @('sha256:appdev')
            'ps -a -q --no-trunc'                           = @('c1', 'c2')
            'inspect --format {{.Image}} c1 c2'             = @('sha256:gpuOld', 'sha256:mongo')
            'images a/app --no-trunc --format {{.ID}}|{{.Tag}}' = @('sha256:app2|2', 'sha256:app1|1', 'sha256:app1|old-alias', 'sha256:appdev|dev')
            'images g/gpu --no-trunc --format {{.ID}}|{{.Tag}}' = @('sha256:gpuG|<none>', 'sha256:gpuOld|0.9')
        }
        return $answers[$Arguments]
    }
    function New-InstalledDir([switch]$Developer) {
        $dir = Join-Path $env:TEMP ("vh-img-" + [guid]::NewGuid())
        New-Item -ItemType Directory $dir | Out-Null
        if (-not $Developer) {
            Set-Content (Join-Path $dir 'release.env') @('COMPOSE_PROJECT_NAME=visheart', 'VH_APP_IMAGE=a/app:2', 'VH_GPU_IMAGE=g/gpu@sha256:G') -Encoding ASCII
        }
        Set-Content (Join-Path $dir 'docker-compose.yml') @('    image: ${VH_APP_IMAGE:-a/app:dev}', '    image: mongo:7.0') -Encoding ASCII
        return $dir
    }

    Context 'an installed copy after an update' {
        Mock -ModuleName VisHeartStart Invoke-Docker { $script:lastDockerArgs = ($Arguments -join ' '); 0 }
        Mock -ModuleName VisHeartStart Get-LastDockerOutput { Get-FakeDockerAnswer $script:lastDockerArgs }
        It 'removes only its old images, keeping the current ones, those a container uses and the developer default' {
            $dir = New-InstalledDir
            try {
                $removed = @(Remove-OldVisHeartImages $dir)
                ($removed -join ',') | Should Be 'a/app:1'
                Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 1 -Scope It -ParameterFilter {
                    ($Arguments -join ' ') -eq 'image rm -f sha256:app1' }
                Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 1 -Scope It -ParameterFilter {
                    ($Arguments -join ' ') -like 'image rm*' }
                # Mongo and Redis are not VisHeart images: their repositories are never listed.
                Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 0 -Scope It -ParameterFilter {
                    ($Arguments -join ' ') -like 'images mongo*' }
                Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 0 -Scope It -ParameterFilter {
                    ($Arguments -join ' ') -match '"' }
            } finally { Remove-Item -Recurse -Force $dir }
        }
    }

    Context 'a current image Docker cannot find' {
        Mock -ModuleName VisHeartStart Invoke-Docker {
            $script:lastDockerArgs = ($Arguments -join ' ')
            if ($script:lastDockerArgs -like 'image inspect*') { return 1 }
            0 }
        Mock -ModuleName VisHeartStart Get-LastDockerOutput { Get-FakeDockerAnswer $script:lastDockerArgs }
        It 'removes nothing, since it cannot tell which image is current' {
            $dir = New-InstalledDir
            try {
                @(Remove-OldVisHeartImages $dir).Count | Should Be 0
                Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 0 -Scope It -ParameterFilter {
                    ($Arguments -join ' ') -like 'image rm*' }
            } finally { Remove-Item -Recurse -Force $dir }
        }
    }

    Context 'a developer copy (no release.env)' {
        Mock -ModuleName VisHeartStart Invoke-Docker { 0 }
        It 'removes nothing and asks Docker nothing' {
            $dir = New-InstalledDir -Developer
            try {
                @(Remove-OldVisHeartImages $dir).Count | Should Be 0
                Assert-MockCalled -ModuleName VisHeartStart Invoke-Docker -Times 0 -Scope It
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
    # <base>\UNETRESNET34 and <base>\cardiac-component-segmentation-ai\{visheart-local-deployment, Cardiac_...\dist},
    # as in the repository and an installed copy.
    function New-Tree([switch]$Built) {
        $base = Join-Path $env:TEMP ("vh-bf-" + [guid]::NewGuid())
        $app = Join-Path $base 'cardiac-component-segmentation-ai'
        $deploy = Join-Path $app 'visheart-local-deployment'
        New-Item -ItemType Directory $deploy | Out-Null
        $dist = Join-Path $app 'Cardiac_Segmentation_FYP_Server\dist'
        New-Item -ItemType Directory $dist | Out-Null
        New-Item -ItemType Directory (Join-Path $base 'UNETRESNET34') | Out-Null
        if ($Built) { Set-Content (Join-Path $dist 'index.js') '//' }
        return $deploy
    }
    function Get-Base($deploy) { Split-Path -Parent (Split-Path -Parent $deploy) }

    It 'creates the folders docker-compose.yml mounts volumes on inside read-only mounts' {
        $deploy = New-Tree -Built
        try {
            (Initialize-BackendFolders $deploy).Built | Should Be $true
            $dist = Join-Path (Split-Path -Parent $deploy) 'Cardiac_Segmentation_FYP_Server\dist'
            foreach ($name in 'temp_jpeg', 'temp_mesh', 'temp_upload', 'temp_exports') {
                Test-Path (Join-Path $dist $name) -PathType Container | Should Be $true
            }
            Test-Path (Join-Path (Get-Base $deploy) 'UNETRESNET34\checkpoints') -PathType Container | Should Be $true
        } finally { Remove-Item -Recurse -Force (Get-Base $deploy) }
    }

    It 'says when the backend was never built' {
        $deploy = New-Tree
        try { (Initialize-BackendFolders $deploy).Built | Should Be $false }
        finally { Remove-Item -Recurse -Force (Get-Base $deploy) }
    }
}

Describe 'Get-BusyPorts' {
    # VisHeart's own containers hold their ports through Docker's processes; only another program is a problem.
    Context 'Docker holds 3000 and 9000, another program holds 5000' {
        Mock -ModuleName VisHeartStart Get-PortListeners {
            @([pscustomobject]@{ Port = 3000; Process = 'com.docker.backend'; Id = 10 },
              [pscustomobject]@{ Port = 9000; Process = 'wslrelay'; Id = 11 },
              [pscustomobject]@{ Port = 5000; Process = 'node'; Id = 4321 })
        }
        It 'names only the other program, with its process id' {
            $busy = @(Get-BusyPorts)
            $busy.Count | Should Be 1
            $busy[0].Port | Should Be 5000
            $busy[0].Process | Should Be 'node'
            $busy[0].Id | Should Be 4321
        }
    }

    Context 'nothing else listens' {
        Mock -ModuleName VisHeartStart Get-PortListeners { @() }
        It 'returns nothing' { @(Get-BusyPorts).Count | Should Be 0 }
    }

    It 'checks the ports a user cannot do without: web page, backend, file storage, GPU service' {
        Mock -ModuleName VisHeartStart Get-PortListeners { @() }
        Get-BusyPorts | Out-Null
        Assert-MockCalled -ModuleName VisHeartStart Get-PortListeners -Times 1 -Scope It -ParameterFilter {
            ($Ports -join ',') -eq '3000,5000,9000,8001' }
    }
}

Describe 'Test-VisHeartAnswering' {
    # The VisHeart desktop icon (start.bat --open) only opens the browser when VisHeart already runs.
    Context 'web page and backend both answer' {
        Mock -ModuleName VisHeartStart Test-UrlAnswers { $true }
        It 'is true' { Test-VisHeartAnswering | Should Be $true }
        It 'asks both the web page and the backend' {
            Test-VisHeartAnswering | Out-Null
            Assert-MockCalled -ModuleName VisHeartStart Test-UrlAnswers -Times 1 -Scope It -ParameterFilter { $Url -eq 'http://localhost:3000/' }
            Assert-MockCalled -ModuleName VisHeartStart Test-UrlAnswers -Times 1 -Scope It -ParameterFilter { $Url -eq 'http://localhost:5000/' }
        }
    }
    Context 'the backend does not answer' {
        Mock -ModuleName VisHeartStart Test-UrlAnswers { $Url -eq 'http://localhost:3000/' }
        It 'is false, so VisHeart is started' { Test-VisHeartAnswering | Should Be $false }
    }
}

Describe 'Open-VisHeart' {
    Mock -ModuleName VisHeartStart Start-Process {}
    It 'opens the VisHeart web page in the default browser' {
        Open-VisHeart
        Assert-MockCalled -ModuleName VisHeartStart Start-Process -Times 1 -Exactly -Scope It -ParameterFilter { $FilePath -eq 'http://localhost:3000' }
    }
}

Describe 'start.bat arguments' {
    $bat = Get-Content -Raw (Join-Path (Split-Path -Parent $PSScriptRoot) 'start.bat')
    It 'passes --open (the VisHeart desktop icon) to start.ps1 as -OpenBrowser' {
        $bat | Should Match '(?i)"--open".*-OpenBrowser'
    }
    It 'reads every argument, so --open works together with --cpu or --gpu' {
        $bat | Should Match '(?i)for %%A in \(%\*\) do'
        $bat | Should Match '(?i)"--cpu".*-ForceCpu'
        $bat | Should Match '(?i)"--gpu".*-ForceGpu'
    }
}

Describe 'Get-DockerDesktopExe' {
    # The installer is a 32-bit program: when its "Start VisHeart now" option runs start.bat, Windows gives the
    # 32-bit process C:\Program Files (x86) as ProgramFiles, so Docker Desktop looked "not installed" (found
    # 2026-11-20). ProgramW6432 always names the 64-bit Program Files.
    It 'uses the 64-bit Program Files even from a 32-bit process' {
        $saved = $env:ProgramW6432
        try {
            $env:ProgramW6432 = 'X:\Program Files'
            Get-DockerDesktopExe | Should Be 'X:\Program Files\Docker\Docker\Docker Desktop.exe'
        } finally { $env:ProgramW6432 = $saved }
    }
}

Describe 'start.bat from a 32-bit process' {
    It 'runs start.ps1 in 64-bit PowerShell' {
        $t = Join-Path $env:TEMP ("vh-b32-" + [guid]::NewGuid()); New-Item -ItemType Directory $t | Out-Null
        try {
            Copy-Item (Join-Path (Split-Path -Parent $PSScriptRoot) 'start.bat') $t
            Set-Content (Join-Path $t 'start.ps1') 'param([switch]$ForceCpu,[switch]$ForceGpu,[switch]$OpenBrowser) "is64=$([Environment]::Is64BitProcess)"' -Encoding ASCII
            $out = & "$env:SystemRoot\SysWOW64\cmd.exe" /c "`"$t\start.bat`"" | Out-String
            $out | Should Match 'is64=True'
        } finally { Remove-Item -Recurse -Force $t }
    }
}

Describe 'start.ps1 removes old images' {
    $ps1 = Get-Content -Raw (Join-Path (Split-Path -Parent $PSScriptRoot) 'start.ps1')
    It 'only after VisHeart was started, and never fails the start' {
        $ps1 | Should Match '(?s)up -d visheart-app \$inferenceService.*try \{[^}]*Remove-OldVisHeartImages \$scriptDir'
    }
}
