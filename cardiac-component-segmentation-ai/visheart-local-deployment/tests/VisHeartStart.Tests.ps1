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
