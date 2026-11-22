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
    Mock Test-VirtualMachinePlatformEnabled { $true }
    Mock Test-DockerDesktopInstalled { $true }
    Mock Test-NvidiaDriver { $true }
    Mock Get-PythonVersion { [version]'3.13.1' }
    Mock Get-VCRuntimeVersion { [version]'14.44.35208' }
    Mock Get-FreeSpaceGB { 120.5 }
    Mock Get-DockerDataDrive { 'C:' }

    It 'a complete PC passes every check' {
        $r = @(Get-VisHeartPrerequisites -InstallDrive 'C:')
        (@($r | ForEach-Object { $_.Name }) -join ',') | Should Be 'windows,wsl,docker,nvidia,python,vcredist,disk'
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

    Context 'WSL installed but Virtual Machine Platform off' {
        # Seen 2026-11-21 on a test desktop: wsl --status succeeded, Docker Desktop then said "Virtual Machine Platform
        # is not enabled" and could not start.
        Mock Test-VirtualMachinePlatformEnabled { $false }
        It "WSL is 'missing', so the installer turns the feature on" {
            $c = Get-Check (Get-VisHeartPrerequisites -InstallDrive 'C:') 'wsl'
            $c.Status | Should Be 'missing'
            $c.Message | Should Match 'Virtual Machine Platform'
        }
    }

    Context 'an old Visual C++ runtime' {
        # 2026-11-21, a test desktop had v14.10.25017 (Visual Studio 2017): PyTorch failed with "[WinError 1114] ...
        # c10.dll", so UNet Extend Training could not start.
        Mock Get-VCRuntimeVersion { [version]'14.10.25017' }
        It "is 'missing', so the installer updates it" {
            $c = Get-Check (Get-VisHeartPrerequisites -InstallDrive 'C:') 'vcredist'
            $c.Status | Should Be 'missing'
            $c.Message | Should Match '14\.10'
        }
    }

    Context 'no Visual C++ runtime' {
        Mock Get-VCRuntimeVersion { $null }
        It "is 'missing'" { (Get-Check (Get-VisHeartPrerequisites -InstallDrive 'C:') 'vcredist').Status | Should Be 'missing' }
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

Describe 'disk space where VisHeart and Docker keep their files' {
    Mock Get-WindowsBuild { 22631 }
    Mock Test-Is64BitWindows { $true }
    Mock Test-WslEnabled { $true }
    Mock Test-VirtualMachinePlatformEnabled { $true }
    Mock Test-DockerDesktopInstalled { $true }
    Mock Test-NvidiaDriver { $true }
    Mock Get-PythonVersion { [version]'3.13.1' }
    Mock Get-VCRuntimeVersion { [version]'14.44.35208' }

    Context 'Docker keeps its data on E:, which has room; C: is nearly full' {
        Mock Get-DockerDataDrive { 'E:' }
        Mock Get-FreeSpaceGB { if ($Drive -eq 'E:') { 600 } else { 9.6 } }
        It 'installing on E: is fine' {
            (Get-Check (Get-VisHeartPrerequisites -InstallDrive 'E:') 'disk').Status | Should Be 'ok'
        }
        It 'installing on C: blocks and asks for 10 GB on C:' {
            $c = Get-Check (Get-VisHeartPrerequisites -InstallDrive 'C:') 'disk'
            $c.Status | Should Be 'block'
            $c.Message | Should Match '9\.6 GB is free on C:'
            $c.Message | Should Match '10 GB'
        }
    }

    Context 'the app drive has room, the Docker drive does not' {
        Mock Get-DockerDataDrive { 'C:' }
        Mock Get-FreeSpaceGB { if ($Drive -eq 'E:') { 600 } else { 20 } }
        It 'blocks and names Docker''s drive and the 30 GB of downloads' {
            $c = Get-Check (Get-VisHeartPrerequisites -InstallDrive 'E:') 'disk'
            $c.Status | Should Be 'block'
            $c.Message | Should Match 'C:'
            $c.Message | Should Match '30 GB'
        }
        It 'explains that the chosen folder does not change it, and how to move Docker''s storage' {
            # 2026-11-21: installing on E: still said "C: is full"; it looked like a bug.
            $m = (Get-Check (Get-VisHeartPrerequisites -InstallDrive 'E:') 'disk').Message
            $m | Should Match 'E:'
            $m | Should Match 'does not change this'
            $m | Should Match ([regex]::Escape('Settings > Resources > Advanced > Disk image location'))
            $m | Should Not Match 'install it first'
        }
    }

    Context 'Docker''s drive is too small and Docker Desktop is not installed yet' {
        Mock Get-DockerDataDrive { 'C:' }
        Mock Get-FreeSpaceGB { if ($Drive -eq 'E:') { 600 } else { 20 } }
        Mock Test-DockerDesktopInstalled { $false }
        It 'says to install Docker Desktop first, move its storage, then run the installer again' {
            $m = (Get-Check (Get-VisHeartPrerequisites -InstallDrive 'E:') 'disk').Message
            $m | Should Match 'install it first'
        }
    }

    Context 'choosing the folder later' {
        Mock Get-DockerDataDrive { 'C:' }
        Mock Get-FreeSpaceGB { 1 }
        It '-SkipDisk leaves the disk check out' {
            $names = @(Get-VisHeartPrerequisites -InstallDrive 'C:' -SkipDisk | ForEach-Object { $_.Name }) -join ','
            $names | Should Be 'windows,wsl,docker,nvidia,python,vcredist'
        }
        It '-DiskOnly runs only the disk check' {
            $r = @(Get-VisHeartPrerequisites -InstallDrive 'C:' -DiskOnly)
            $r.Count | Should Be 1
            $r[0].Name | Should Be 'disk'
            $r[0].Status | Should Be 'block'
        }
    }
}

Describe 'Get-DockerDataDrive' {
    It 'reads the drive Docker Desktop was moved to' {
        $f = Join-Path $env:TEMP ("vh-ds-" + [guid]::NewGuid() + '.json')
        Set-Content $f '{"CustomWslDistroDir": "E:\\DockerData\\DockerDesktopWSL", "Other": 1}' -Encoding ASCII
        try { Get-DockerDataDrive $f | Should Be 'E:' } finally { Remove-Item $f }
    }
    It 'is the Windows drive when Docker Desktop keeps its default place, or has no settings yet' {
        Get-DockerDataDrive (Join-Path $env:TEMP 'no-such-settings.json') | Should Be $env:SystemDrive
    }
}

Describe 'Test-VisHeartPrerequisites.ps1 output' {
    Mock Get-WindowsBuild { 22631 }
    Mock Test-Is64BitWindows { $true }
    Mock Test-WslEnabled { $false }
    Mock Test-VirtualMachinePlatformEnabled { $true }
    Mock Test-DockerDesktopInstalled { $true }
    Mock Test-NvidiaDriver { $false }
    Mock Get-PythonVersion { [version]'3.13.1' }
    Mock Get-VCRuntimeVersion { [version]'14.44.35208' }
    Mock Get-DockerDataDrive { 'C:' }

    Context 'nothing blocks' {
        Mock Get-FreeSpaceGB { 100 }
        It 'writes JSON and the line file, and returns 0' {
            $dir = Join-Path $env:TEMP ("vh-pre-" + [guid]::NewGuid()); New-Item -ItemType Directory $dir | Out-Null
            try {
                $code = Invoke-VisHeartPrerequisites -InstallDrive 'C:' -OutJson "$dir\p.json" -OutText "$dir\p.txt"
                $code | Should Be 0
                $json = Get-Content -Raw "$dir\p.json" | ConvertFrom-Json
                @($json).Count | Should Be 7
                (@($json | Where-Object { $_.Name -eq 'wsl' })[0]).Status | Should Be 'missing'
                $lines = Get-Content "$dir\p.txt"
                $lines.Count | Should Be 7
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
