# Pester 3.4 tests for installer/scripts/Test-VisHeartPrerequisites.ps1.
# The script is dot-sourced, so its probes can be mocked and nothing on this PC is changed.
# Run from cardiac-component-segmentation-ai:  Invoke-Pester .\installer\tests\Prerequisites.Tests.ps1

$script = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\Test-VisHeartPrerequisites.ps1'
. $script

function Get-Check($results, [string]$Name) { @($results | Where-Object { $_.Name -eq $Name })[0] }

Describe 'Get-VisHeartPrerequisites' {
    # A PC that has everything; each test changes one probe.
    Mock Get-WindowsBuild { 22631 }
    Mock Test-Is64BitWindows { $true }
    Mock Test-WslEnabled { $true }
    Mock Test-DockerDesktopInstalled { $true }
    Mock Test-NvidiaDriver { $true }
    Mock Get-PythonVersion { [version]'3.13.1' }
    Mock Get-FreeSpaceGB { 120.5 }

    It 'a complete PC passes every check' {
        $r = @(Get-VisHeartPrerequisites -InstallDrive 'C:')
        (@($r | ForEach-Object { $_.Name }) -join ',') | Should Be 'windows,wsl,docker,nvidia,python,disk'
        @($r | Where-Object { $_.Status -ne 'ok' }).Count | Should Be 0
    }

    Context 'old Windows' {
        Mock Get-WindowsBuild { 18363 }
        It 'old Windows blocks' {
            (Get-Check (Get-VisHeartPrerequisites -InstallDrive 'C:') 'windows').Status | Should Be 'block'
        }
    }

    Context '32-bit Windows' {
        Mock Test-Is64BitWindows { $false }
        It '32-bit Windows blocks' {
            (Get-Check (Get-VisHeartPrerequisites -InstallDrive 'C:') 'windows').Status | Should Be 'block'
        }
    }

    Context 'no WSL and no Docker' {
        Mock Test-WslEnabled { $false }
        Mock Test-DockerDesktopInstalled { $false }
        It "missing WSL and Docker are 'missing', not 'block'" {
            $r = Get-VisHeartPrerequisites -InstallDrive 'C:'
            (Get-Check $r 'wsl').Status | Should Be 'missing'
            (Get-Check $r 'docker').Status | Should Be 'missing'
        }
    }

    Context 'no NVIDIA driver' {
        Mock Test-NvidiaDriver { $false }
        It 'missing nvidia-smi is a warning, not a blocker' {
            $c = Get-Check (Get-VisHeartPrerequisites -InstallDrive 'C:') 'nvidia'
            $c.Status | Should Be 'warn'
            $c.Message | Should Match 'CPU mode'
            $c.Message | Should Match 'MedSAM'
        }
    }

    Context 'old Python' {
        Mock Get-PythonVersion { [version]'3.10.11' }
        It "python below 3.11 is 'missing'" {
            (Get-Check (Get-VisHeartPrerequisites -InstallDrive 'C:') 'python').Status | Should Be 'missing'
        }
    }

    Context 'no Python' {
        Mock Get-PythonVersion { $null }
        It "no Python is 'missing'" {
            (Get-Check (Get-VisHeartPrerequisites -InstallDrive 'C:') 'python').Status | Should Be 'missing'
        }
    }

    It "python 3.13 is 'ok'" {
        (Get-Check (Get-VisHeartPrerequisites -InstallDrive 'C:') 'python').Status | Should Be 'ok'
    }

    Context 'small disk' {
        Mock Get-FreeSpaceGB { 39.9 }
        It 'less than 40 GB blocks' {
            $c = Get-Check (Get-VisHeartPrerequisites -InstallDrive 'C:') 'disk'
            $c.Status | Should Be 'block'
            $c.Message | Should Match '39\.9 GB'
            $c.Message | Should Match '40 GB'
        }
    }

    # An update over an existing install: its images and training data already take their space.
    Context 'updating an existing install with 20 GB free' {
        Mock Get-FreeSpaceGB { 20 }
        It 'does not block' {
            (Get-Check (Get-VisHeartPrerequisites -InstallDrive 'C:' -ExistingInstall) 'disk').Status | Should Be 'ok'
        }
    }

    Context 'updating an existing install with 5 GB free' {
        Mock Get-FreeSpaceGB { 5 }
        It 'blocks and asks for 10 GB' {
            $c = Get-Check (Get-VisHeartPrerequisites -InstallDrive 'C:' -ExistingInstall) 'disk'
            $c.Status | Should Be 'block'
            $c.Message | Should Match '10 GB'
        }
    }
}

Describe 'Test-VisHeartPrerequisites.ps1 output' {
    Mock Get-WindowsBuild { 22631 }
    Mock Test-Is64BitWindows { $true }
    Mock Test-WslEnabled { $false }
    Mock Test-DockerDesktopInstalled { $true }
    Mock Test-NvidiaDriver { $false }
    Mock Get-PythonVersion { [version]'3.13.1' }

    Context 'nothing blocks' {
        Mock Get-FreeSpaceGB { 100 }
        It 'writes JSON and the line file, and returns 0' {
            $dir = Join-Path $env:TEMP ("vh-pre-" + [guid]::NewGuid()); New-Item -ItemType Directory $dir | Out-Null
            try {
                $code = Invoke-VisHeartPrerequisites -InstallDrive 'C:' -OutJson "$dir\p.json" -OutText "$dir\p.txt"
                $code | Should Be 0
                $json = Get-Content -Raw "$dir\p.json" | ConvertFrom-Json
                @($json).Count | Should Be 6
                (@($json | Where-Object { $_.Name -eq 'wsl' })[0]).Status | Should Be 'missing'
                $lines = Get-Content "$dir\p.txt"
                $lines.Count | Should Be 6
                $lines[1] | Should Match '^wsl\|missing\|.+'
                $lines[3] | Should Match '^nvidia\|warn\|.+'
            } finally { Remove-Item -Recurse -Force $dir }
        }
    }

    Context 'a blocker' {
        Mock Get-FreeSpaceGB { 10 }
        It 'returns 2 when something blocks' {
            $dir = Join-Path $env:TEMP ("vh-pre-" + [guid]::NewGuid()); New-Item -ItemType Directory $dir | Out-Null
            try {
                Invoke-VisHeartPrerequisites -InstallDrive 'C:' -OutJson "$dir\p.json" -OutText "$dir\p.txt" | Should Be 2
            } finally { Remove-Item -Recurse -Force $dir }
        }
    }
}
