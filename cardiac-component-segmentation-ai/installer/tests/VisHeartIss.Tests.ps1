# Pester 3.4 checks of installer/visheart.iss: the rules its Pascal code must keep (these paths only run on a real
# install, which Task 7 tests on a clean PC), plus a real compile when Inno Setup is installed.
# Run from installer:  Invoke-Pester .\tests\VisHeartIss.Tests.ps1
# VH_ISS_PATH points the tests at another copy of the script (used to see them fail on an older version).

$script:IssPath = if ($env:VH_ISS_PATH) { $env:VH_ISS_PATH } else { Join-Path (Split-Path -Parent $PSScriptRoot) 'visheart.iss' }
$script:Iss = Get-Content -Raw $script:IssPath

function Get-PascalFunction([string]$Name) {
    # Text of one function or procedure of the [Code] section, up to the next one.
    $m = [regex]::Match($script:Iss, "(?ms)^(function|procedure) $Name\b.*?(?=^(function|procedure) |\z)")
    return $m.Value
}

Describe 'visheart.iss rules' {
    It 'an install never replaces the registered original unet.pth' {
        $script:Iss | Should Match '(?m)^Source: "\{#StagingDir\}\\\*";.*Excludes: "[^"]*visheart-inference-gpu\\app\\models\\unet\.pth"'
        $script:Iss | Should Match '(?m)^Source: "[^"]*\\app\\models\\unet\.pth";.*Flags: onlyifdoesntexist'
    }

    It 'an update over an existing install asks for less free space' {
        $init = Get-PascalFunction 'InitializeSetup'
        $init | Should Match 'ExistingInstallDir\(\)'
        $init | Should Match '-ExistingInstall'
    }

    It 'when the database cannot be deleted, uninstall keeps the data and its passwords' {
        $step = Get-PascalFunction 'CurUninstallStepChanged'
        # DeleteData is switched off inside the branch where Remove-VisHeartDocker -DeleteData failed.
        $step | Should Match "(?s)Remove-VisHeartDocker.*-DeleteData.*if DeleteData and \(Code <> 0\) then begin.*DeleteData := False"
    }

    It 'uninstall cleans Docker through Remove-VisHeartDocker, which starts Docker Desktop when it is not running' {
        $step = Get-PascalFunction 'CurUninstallStepChanged'
        $step | Should Match "VisHeartStart\.psm1"
        $step | Should Not Match "docker compose"
    }

    It 'the install folder is protected after the passwords are made' {
        $script:Iss | Should Match '(?m)^Source: "scripts\\Protect-VisHeartFolder\.ps1"; DestDir: "\{app\}\\installer"'
        $post = Get-PascalFunction 'CurStepChanged'
        $post | Should Match '(?s)New-VisHeartSecrets\.ps1.*Protect-VisHeartFolder\.ps1'
    }

    It 'turning WSL on always enables Virtual Machine Platform too, not only when wsl --install fails' {
        # 2026-11-21: wsl --install succeeded on a test desktop, but Virtual Machine Platform stayed off and Docker
        # Desktop could not start.
        $step = Get-PascalFunction 'CurStepChanged'
        $step | Should Match 'featurename:VirtualMachinePlatform'
        $step | Should Not Match "--install --no-distribution', 'Turning on WSL2\.\.\.'\) <> 0 then"
    }

    It 'an update removes the files the installed version shipped that this version does not' {
        $script:Iss | Should Match '(?m)^Source: "scripts\\Remove-VisHeartStaleFiles\.ps1"; DestDir: "\{app\}\\installer"'
        $step = Get-PascalFunction 'CurStepChanged'
        # The old list is saved before the new files overwrite it, and compared after they were copied.
        $step | Should Match '(?s)ssInstall.*shipped-files\.txt.*old-shipped-files\.txt'
        $step | Should Match '(?s)Remove-VisHeartStaleFiles\.ps1.*-OldList'
    }
}

Describe 'visheart.iss compiles' {
    Import-Module (Join-Path (Split-Path -Parent $PSScriptRoot) 'lib\Staging.psm1') -Force
    $iscc = Find-InnoCompiler

    It 'with Inno Setup, against a small staging folder (Update and Full)' {
        if (-not $iscc) { Set-TestInconclusive 'Inno Setup is not installed.'; return }
        $work = Join-Path $env:TEMP ("vh-iss-" + [guid]::NewGuid())
        try {
            $models = Join-Path $work 'staging\cardiac-component-segmentation-ai\visheart-inference-gpu\app\models'
            New-Item -ItemType Directory $models, (Join-Path $work 'pack') -Force | Out-Null
            Set-Content (Join-Path $models 'unet.pth') 'x'
            Set-Content (Join-Path $work 'staging\cardiac-component-segmentation-ai\start.bat') 'x'
            Set-Content (Join-Path $work 'pack\PACKED.json') '{}'
            $iss = (Resolve-Path $script:IssPath).Path
            # The script compiles relative to its own folder (scripts\, INSTALL.md), so compile it in place.
            & $iscc /Q "/DVariant=Update" "/DAppVersion=0.0.1" "/DStagingDir=$work\staging" "/O$work\out" $iss *> "$work\update.log"
            $LASTEXITCODE | Should Be 0
            & $iscc /Q "/DVariant=Full" "/DAppVersion=0.0.1" "/DStagingDir=$work\staging" "/DPackDir=$work\pack" "/O$work\out" $iss *> "$work\full.log"
            $LASTEXITCODE | Should Be 0
        } finally { Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue }
    }

    It 'uninstall removes what VisHeart made while it ran (Python cache, empty folders Start VisHeart creates)' {
        # Found uninstalling 1.0.1 with "keep data": these stayed in the install folder.
        $script:Iss | Should Match ([regex]::Escape('Type: filesandordirs; Name: "{app}\{#AppSub}\visheart-retraining\__pycache__"'))
        foreach ($dir in 'temp_jpeg', 'temp_mesh', 'temp_upload') {
            $script:Iss | Should Match ([regex]::Escape("Type: dirifempty; Name: `"{app}\{#AppSub}\Cardiac_Segmentation_FYP_Server\dist\$dir`""))
        }
        $script:Iss | Should Match ([regex]::Escape('Type: dirifempty; Name: "{app}\UNETRESNET34\checkpoints"'))
    }

    It 'when Docker cannot be cleaned, uninstall says so even when the data is kept, and names the containers' {
        $step = Get-PascalFunction 'CurUninstallStepChanged'
        $step | Should Match '(?s)if \(not DeleteData\) and \(Code <> 0\) then begin.*docker rm -f visheart-local'
    }

    It 'when the data is kept, uninstall ends by saying what was kept and where' {
        $step = Get-PascalFunction 'CurUninstallStepChanged'
        $step | Should Match '(?s)usPostUninstall\) and not DeleteData.*were kept in'
    }

    It 'the folder is protected with the installing account named, so its first start works before signing out' {
        $step = Get-PascalFunction 'CurStepChanged'
        $step | Should Match ('(?s)' + [regex]::Escape("Protect-VisHeartFolder.ps1") + '.*-AppDir.*-Account "'' \+ Account')
    }

    It 'the desktop gets one VisHeart icon, with the logo, that opens VisHeart (starting it first when needed)' {
        $desktop = @([regex]::Matches($script:Iss, '(?m)^Name: "\{autodesktop\}\\[^"]+"[^\r\n]*') | ForEach-Object { $_.Value })
        $desktop.Count | Should Be 1
        $desktop[0] | Should Match ([regex]::Escape('Name: "{autodesktop}\VisHeart"'))
        $desktop[0] | Should Match 'Parameters: "--open"'
        $desktop[0] | Should Match ([regex]::Escape('IconFilename: "{app}\installer\visheart.ico"'))
        $script:Iss | Should Not Match ([regex]::Escape('Filename: "{autodesktop}\VisHeart.url"'))
        $script:Iss | Should Match '(?m)^Source: "assets\\visheart\.ico"; DestDir: "\{app\}\\installer"'
        $script:Iss | Should Match '(?m)^SetupIconFile=assets\\visheart\.ico'
    }

    It 'an update removes the icons earlier versions put on the desktop and in the Start menu' {
        foreach ($old in '{autodesktop}\Start VisHeart.lnk', '{autodesktop}\Stop VisHeart.lnk', '{autodesktop}\VisHeart.url',
                '{group}\Start VisHeart.lnk', '{group}\VisHeart.url', '{group}\Uninstall VisHeart.lnk') {
            $script:Iss | Should Match ([regex]::Escape("Type: files; Name: `"$old`""))
        }
        $script:Iss | Should Match '(?m)^\[InstallDelete\]'
    }

    It 'no Start menu uninstall shortcut: Windows 11 hides it, so the guides point to Settings > Apps' {
        $script:Iss | Should Not Match '\{uninstallexe\}'
        $finish = Get-Content -Raw (Join-Path (Split-Path -Parent $PSScriptRoot) 'finish-page.iss')
        $finish | Should Match ([regex]::Escape('Settings > Apps > Installed apps > VisHeart'))
        $finish | Should Not Match 'Start menu > VisHeart > Uninstall'
    }
}
