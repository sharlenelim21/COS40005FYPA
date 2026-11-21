# Pester 3.4 tests for installer/lib/Staging.psm1.
# Run from cardiac-component-segmentation-ai:  Invoke-Pester .\installer\tests\Staging.Tests.ps1

$modulePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib\Staging.psm1'
Get-Module Staging | Remove-Module -Force
Import-Module $modulePath -Force

function New-FakeRepo {
    # A small tree shaped like the repository: two levels, plus everything staging must leave out.
    $root = Join-Path $env:TEMP ("vh-repo-" + [guid]::NewGuid())
    $files = @(
        'UNETRESNET34\check_labels.py',
        'UNETRESNET34\models\unet_resnet34.py',
        'UNETRESNET34\checkpoints\best_model_2ch.pth',
        'UNETRESNET34\.git\HEAD',
        'cardiac-component-segmentation-ai\start.bat',
        'cardiac-component-segmentation-ai\stop.bat',
        'cardiac-component-segmentation-ai\README.md',
        'cardiac-component-segmentation-ai\visheart-local-deployment\docker-compose.yml',
        'cardiac-component-segmentation-ai\visheart-local-deployment\start.ps1',
        'cardiac-component-segmentation-ai\visheart-local-deployment\lib\VisHeartStart.psm1',
        'cardiac-component-segmentation-ai\visheart-local-deployment\tests\Compose.Tests.ps1',
        'cardiac-component-segmentation-ai\visheart-local-deployment\secrets.env',
        'cardiac-component-segmentation-ai\visheart-local-deployment\release.env',
        'cardiac-component-segmentation-ai\visheart-local-deployment\.env',
        'cardiac-component-segmentation-ai\visheart-local-deployment\volumes\mongodb\.gitkeep',
        'cardiac-component-segmentation-ai\Cardiac_Segmentation_FYP_Server\dist\index.js',
        'cardiac-component-segmentation-ai\Cardiac_Segmentation_FYP_Server\dist\jobs\queue.js',
        'cardiac-component-segmentation-ai\Cardiac_Segmentation_FYP_Server\dist\temp_exports\export.zip',
        'cardiac-component-segmentation-ai\Cardiac_Segmentation_FYP_Server\dist\temp_jpeg\a.jpg',
        'cardiac-component-segmentation-ai\Cardiac_Segmentation_FYP_Server\src\python\nifti_to_png.py',
        'cardiac-component-segmentation-ai\Cardiac_Segmentation_FYP_Server\src\routes\auth.ts',
        'cardiac-component-segmentation-ai\Cardiac_Segmentation_FYP_Server\node_modules\x\index.js',
        'cardiac-component-segmentation-ai\visheart-inference-gpu\start_server.py',
        'cardiac-component-segmentation-ai\visheart-inference-gpu\Dockerfile',
        'cardiac-component-segmentation-ai\visheart-inference-gpu\app\main.py',
        'cardiac-component-segmentation-ai\visheart-inference-gpu\app\__pycache__\main.cpython-311.pyc',
        'cardiac-component-segmentation-ai\visheart-inference-gpu\app\models\unet.pth',
        'cardiac-component-segmentation-ai\visheart-inference-gpu\app\models\active\unet.pth',
        'cardiac-component-segmentation-ai\visheart-inference-gpu\app\models\atlas_rv\Mid\mesh.obj',
        'cardiac-component-segmentation-ai\visheart-inference-gpu\app\models\atlas_rv_backup_pre_lengthwise\Mid\mesh.obj',
        'cardiac-component-segmentation-ai\visheart-inference-gpu\tests\test_main.py',
        'cardiac-component-segmentation-ai\visheart-retraining\worker.py',
        'cardiac-component-segmentation-ai\visheart-retraining\.venv\Scripts\python.exe',
        'cardiac-component-segmentation-ai\visheart-retraining\venv313\Scripts\python.exe',
        'cardiac-component-segmentation-ai\visheart-retraining\jobs\job-1.json',
        'cardiac-component-segmentation-ai\visheart-retraining\tests\test_worker.py',
        'cardiac-component-segmentation-ai\visheart-frontend\src\app\page.tsx',
        'cardiac-component-segmentation-ai\visheart-training-data\PACKED.json',
        'cardiac-component-segmentation-ai\installer\make-installer.ps1',
        'cardiac-component-segmentation-ai\FIRST-LOGIN.txt',
        'cardiac-component-segmentation-ai\visheart-local-deployment\database.owner'
    )
    foreach ($f in $files) {
        $p = Join-Path $root $f
        New-Item -ItemType Directory (Split-Path -Parent $p) -Force | Out-Null
        Set-Content $p 'x' -Encoding ASCII
    }
    return $root
}

Describe 'Get-StagingSelection' {
    $repo = New-FakeRepo
    $sel = @(Get-StagingSelection $repo)
    $targets = @($sel | ForEach-Object { $_.Target })

    It 'selection uses the two-level layout' {
        $targets -contains 'UNETRESNET34\check_labels.py' | Should Be $true
        $targets -contains 'UNETRESNET34\models\unet_resnet34.py' | Should Be $true
        $targets -contains 'cardiac-component-segmentation-ai\visheart-local-deployment\docker-compose.yml' | Should Be $true
        $targets -contains 'cardiac-component-segmentation-ai\visheart-local-deployment\lib\VisHeartStart.psm1' | Should Be $true
        $targets -contains 'cardiac-component-segmentation-ai\start.bat' | Should Be $true
        $targets -contains 'cardiac-component-segmentation-ai\stop.bat' | Should Be $true
        $targets -contains 'cardiac-component-segmentation-ai\visheart-inference-gpu\start_server.py' | Should Be $true
        $targets -contains 'cardiac-component-segmentation-ai\visheart-inference-gpu\app\main.py' | Should Be $true
        $targets -contains 'cardiac-component-segmentation-ai\visheart-inference-gpu\app\models\unet.pth' | Should Be $true
        $targets -contains 'cardiac-component-segmentation-ai\visheart-inference-gpu\app\models\atlas_rv\Mid\mesh.obj' | Should Be $true
        $targets -contains 'cardiac-component-segmentation-ai\visheart-retraining\worker.py' | Should Be $true
    }

    It 'every source matches its target under the repository root' {
        foreach ($s in $sel) { $s.Source | Should Be (Join-Path $repo $s.Target) }
    }

    It 'selection excludes dev and per-PC folders' {
        $bad = @($targets | Where-Object {
            $_ -match '(^|\\)(\.git|node_modules|venv313|\.venv|__pycache__|tests)(\\|$)' -or
            $_ -match '\\app\\models\\active\\' -or
            $_ -match 'atlas_rv_backup_pre_lengthwise' -or
            $_ -match 'visheart-retraining\\jobs\\' -or
            $_ -match 'dist\\temp_' -or
            $_ -match '(^|\\)(secrets\.env|release\.env|\.env|FIRST-LOGIN\.txt|database\.owner)$' -or
            $_ -match 'UNETRESNET34\\checkpoints\\' -or
            $_ -match 'visheart-local-deployment\\volumes\\'
        })
        ($bad -join ', ') | Should Be ''
    }

    It 'selection leaves out what is not part of the installed app' {
        $bad = @($targets | Where-Object {
            $_ -match 'visheart-frontend' -or $_ -match 'visheart-training-data' -or $_ -match '\\installer\\' -or
            $_ -match 'Cardiac_Segmentation_FYP_Server\\src\\routes' -or $_ -match 'visheart-inference-gpu\\Dockerfile' -or
            $_ -eq 'cardiac-component-segmentation-ai\README.md'
        })
        ($bad -join ', ') | Should Be ''
    }

    It 'selection includes the built backend' {
        $targets -contains 'cardiac-component-segmentation-ai\Cardiac_Segmentation_FYP_Server\dist\index.js' | Should Be $true
        $targets -contains 'cardiac-component-segmentation-ai\Cardiac_Segmentation_FYP_Server\dist\jobs\queue.js' | Should Be $true
        $targets -contains 'cardiac-component-segmentation-ai\Cardiac_Segmentation_FYP_Server\src\python\nifti_to_png.py' | Should Be $true
    }

    Remove-Item -Recurse -Force $repo
}

Describe 'Get-UnexpectedModelFiles' {
    It 'the usual models folder has nothing unexpected' {
        $repo = New-FakeRepo
        @(Get-UnexpectedModelFiles $repo).Count | Should Be 0
        Remove-Item -Recurse -Force $repo
    }

    It 'a trained or test model in the models folder is reported' {
        $repo = New-FakeRepo
        $models = Join-Path $repo 'cardiac-component-segmentation-ai\visheart-inference-gpu\app\models'
        Set-Content (Join-Path $models 'unet-ft-loop1.pth') 'x'
        New-Item -ItemType Directory (Join-Path $models 'experiments') -Force | Out-Null
        Set-Content (Join-Path $models 'experiments\try.pth') 'x'
        $found = @(Get-UnexpectedModelFiles $repo | Sort-Object)
        ($found -join ', ') | Should Be 'experiments, unet-ft-loop1.pth'
        Remove-Item -Recurse -Force $repo
    }

    It 'every shipped model name is a plain file or folder name' {
        foreach ($name in (Get-ShippedModelNames)) { $name | Should Not Match '[\\/*?]' }
    }
}

Describe 'Test-ImageOnRegistry' {
    # A dropped connection or a Docker Hub rate limit must not fail a release build that takes an hour.
    Context 'the registry fails twice, then answers' {
        $global:VhInspectCalls = 0
        Mock -ModuleName Staging Invoke-ManifestInspect { $global:VhInspectCalls++; if ($global:VhInspectCalls -lt 3) { 1 } else { 0 } }
        It 'retries and reports the image as present' {
            Test-ImageOnRegistry 'example/app:1.0' -DelaySec 0 | Should Be $true
            $global:VhInspectCalls | Should Be 3
        }
    }

    Context 'the image is really missing' {
        Mock -ModuleName Staging Invoke-ManifestInspect { 1 }
        It 'gives up after three tries' {
            Test-ImageOnRegistry 'example/app:1.0' -DelaySec 0 | Should Be $false
            Assert-MockCalled -ModuleName Staging Invoke-ManifestInspect -Times 3 -Exactly -Scope It
        }
    }
}

Describe 'Test-ReleaseImages' {
    Mock -ModuleName Staging Test-ImageOnRegistry { $Reference -ne 'sharlene21/visheart-gpu:9.9.9' }

    It 'latest and missing images are reported' {
        $images = @{
            VH_APP_IMAGE          = 'sharlene21/visheart-local:1.5.0'
            VH_GPU_IMAGE          = 'sharlene21/visheart-gpu:9.9.9'
            VH_MINIO_IMAGE        = 'bitnamilegacy/minio:latest'
        }
        $bad = @(Test-ReleaseImages $images | Sort-Object)
        ($bad -join ',') | Should Be 'bitnamilegacy/minio:latest,sharlene21/visheart-gpu:9.9.9'
    }

    It 'a reference without a tag or digest counts as latest' {
        @(Test-ReleaseImages @{ VH_APP_IMAGE = 'sharlene21/visheart-local' }) -join ',' | Should Be 'sharlene21/visheart-local'
    }

    It 'a registry host with a port is not mistaken for a tag' {
        @(Test-ReleaseImages @{ VH_APP_IMAGE = 'localhost:5000/visheart-local' }) -join ',' | Should Be 'localhost:5000/visheart-local'
    }
}

Describe 'Test-ModelMatchesPack' {
    $dir = Join-Path $env:TEMP ("vh-pack-" + [guid]::NewGuid())
    New-Item -ItemType Directory $dir | Out-Null
    $model = Join-Path $dir 'unet.pth'
    [IO.File]::WriteAllBytes($model, [byte[]](1, 2, 3, 4))
    $hash = (Get-FileHash $model -Algorithm SHA256).Hash.ToLowerInvariant()
    $pack = Join-Path $dir 'pack'
    New-Item -ItemType Directory $pack | Out-Null

    It 'model hash mismatch is detected' {
        Set-Content (Join-Path $pack 'PACKED.json') ('{"schema":1,"files":{"repo-models/unet.pth":"' + ('0' * 64) + '"}}') -Encoding ASCII
        Test-ModelMatchesPack $model $pack | Should Be $false
    }

    It 'matching model is accepted' {
        Set-Content (Join-Path $pack 'PACKED.json') ('{"schema":1,"files":{"repo-models/unet.pth":"' + $hash + '"}}') -Encoding ASCII
        Test-ModelMatchesPack $model $pack | Should Be $true
    }

    It 'a pack without the model entry is a mismatch' {
        Set-Content (Join-Path $pack 'PACKED.json') '{"schema":1,"files":{}}' -Encoding ASCII
        Test-ModelMatchesPack $model $pack | Should Be $false
    }

    Remove-Item -Recurse -Force $dir
}

Describe 'Write-ReleaseEnv' {
    $dir = Join-Path $env:TEMP ("vh-rel-" + [guid]::NewGuid())
    New-Item -ItemType Directory $dir | Out-Null
    $smtp = Join-Path $dir 'smtp.release.env'
    Set-Content $smtp "# team support account`r`nVH_SUPPORT_EMAIL=support@example.test`r`nVH_SMTP_USER=support@example.test`r`nVH_SMTP_PASS=abcd efgh ijkl mnop" -Encoding ASCII
    $images = @{ VH_APP_IMAGE = 'a/app:1'; VH_GPU_IMAGE = 'a/gpu:1'; VH_MINIO_IMAGE = 'a/minio:1' }

    It 'release env content' {
        $out = Join-Path $dir 'release.env'
        Write-ReleaseEnv $images $smtp $out
        $bytes = [IO.File]::ReadAllBytes($out)
        ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB) | Should Be $false
        $map = @{}
        foreach ($line in [IO.File]::ReadAllLines($out)) { if ($line -match '^([A-Z_]+)=(.*)$') { $map[$Matches[1]] = $Matches[2] } }
        $map['VH_APP_IMAGE'] | Should Be 'a/app:1'
        $map['VH_GPU_IMAGE'] | Should Be 'a/gpu:1'
        $map['VH_MINIO_IMAGE'] | Should Be 'a/minio:1'
        $map.ContainsKey('VH_MINIO_CLIENT_IMAGE') | Should Be $false
        $map['VH_SUPPORT_EMAIL'] | Should Be 'support@example.test'
        $map['VH_SMTP_USER'] | Should Be 'support@example.test'
        $map['VH_SMTP_PASS'] | Should Be 'abcd efgh ijkl mnop'
        $map['VH_BIND'] | Should Be '127.0.0.1'
        $map['VH_MINIO_ANON'] | Should Be 'none'
        $map['COMPOSE_PROJECT_NAME'] | Should Be 'visheart'
        $map['VH_MONGO_HOST_PORT'] | Should Be '0'
        $map['VH_REDIS_HOST_PORT'] | Should Be '0'
        $map.Count | Should Be 11
    }

    It 'release env names the installed version and where to check for a newer one' {
        $out = Join-Path $dir 'release-version.env'
        Write-ReleaseEnv $images $smtp $out -Version '1.0.3' -UpdateUrl 'https://example.test/latest.json'
        $map = @{}
        foreach ($line in [IO.File]::ReadAllLines($out)) { if ($line -match '^([A-Z_]+)=(.*)$') { $map[$Matches[1]] = $Matches[2] } }
        $map['VH_VERSION'] | Should Be '1.0.3'
        $map['VH_UPDATE_URL'] | Should Be 'https://example.test/latest.json'
    }

    It 'a missing SMTP file stops with a named error' {
        { Write-ReleaseEnv $images (Join-Path $dir 'nope.env') (Join-Path $dir 'x.env') } | Should Throw 'smtp.release.env'
    }

    It 'an SMTP file without the password stops with a named error' {
        $partial = Join-Path $dir 'partial.env'
        Set-Content $partial "VH_SUPPORT_EMAIL=a@b.c`r`nVH_SMTP_USER=a@b.c`r`nVH_SMTP_PASS=" -Encoding ASCII
        { Write-ReleaseEnv $images $partial (Join-Path $dir 'y.env') } | Should Throw 'VH_SMTP_PASS'
    }

    Remove-Item -Recurse -Force $dir
}

Describe 'Find-InnoCompiler' {
    It 'rejects an Inno Setup older than 6.5.2' {
        Mock -ModuleName Staging Get-InnoCandidates { @('C:\fake\ISCC.exe') }
        Mock -ModuleName Staging Get-FileVersion { [version]'6.4.3' }
        Find-InnoCompiler | Should BeNullOrEmpty
    }

    It 'accepts Inno Setup 6.5.2 or later' {
        Mock -ModuleName Staging Get-InnoCandidates { @('C:\old\ISCC.exe', 'C:\new\ISCC.exe') }
        Mock -ModuleName Staging Get-FileVersion { if ($Path -like 'C:\new\*') { [version]'6.5.4' } else { [version]'6.2.0' } }
        Find-InnoCompiler | Should Be 'C:\new\ISCC.exe'
    }

    # Inno Setup 6.7 ships ISCC.exe with no version resource (it reads as 0.0.0); visheart.iss checks the version itself.
    Context 'a compiler without version information' {
        Mock -ModuleName Staging Get-InnoCandidates { @('C:\unknown\ISCC.exe') }
        Mock -ModuleName Staging Get-FileVersion { [version]'0.0.0' }
        It 'is accepted' {
            Find-InnoCompiler | Should Be 'C:\unknown\ISCC.exe'
        }
    }

    Context 'a known 6.5.2+ compiler and one without version information' {
        Mock -ModuleName Staging Get-InnoCandidates { @('C:\unknown\ISCC.exe', 'C:\new\ISCC.exe') }
        Mock -ModuleName Staging Get-FileVersion { if ($Path -like 'C:\new\*') { [version]'6.5.4' } else { [version]'0.0.0' } }
        It 'prefers the known one' {
            Find-InnoCompiler | Should Be 'C:\new\ISCC.exe'
        }
    }
}

Describe 'Get-LongPaths' {
    It 'names the files whose full path under a folder passes the Windows 260-character limit' {
        $short = 'app\a.txt'
        $long = 'app\' + ('x' * 240) + '.txt'
        @(Get-LongPaths @($short, $long) 'C:\VisHeart') | Should Be @($long)
        @(Get-LongPaths @($short) 'C:\VisHeart').Count | Should Be 0
    }

    It 'every shipped file fits in the longest install folder the installer accepts (40 characters)' {
        $repo = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
        $targets = @(Get-StagingSelection $repo | ForEach-Object { $_.Target })
        @(Get-LongPaths $targets ('C:\' + ('x' * 37))).Count | Should Be 0
    }
}

Describe 'New-ReleaseZip' {
    # One zip per installer, uploaded as one file: Google Drive splits a folder download over about 2 GB into several
    # dated zips, and users who unzipped only one got "Please insert Disk 2" (found on a test laptop, 2026-11-19).
    It 'packs the installer folder, folder name included, without recompressing the slices' {
        $work = Join-Path $env:TEMP ("vh-rz-" + [guid]::NewGuid())
        $folder = Join-Path $work 'VisHeart-Full-9.9.9'
        New-Item -ItemType Directory $folder | Out-Null
        Set-Content (Join-Path $folder 'VisHeart-Full-9.9.9.exe') 'x'
        Set-Content (Join-Path $folder 'VisHeart-Full-9.9.9-1.bin') ('y' * 5000)
        try {
            $zip = New-ReleaseZip $folder
            $zip | Should Be (Join-Path $work 'VisHeart-Full-9.9.9.zip')
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $z = [IO.Compression.ZipFile]::OpenRead($zip)
            try {
                $files = @($z.Entries | Where-Object { $_.Length -gt 0 })
                $expected = @('VisHeart-Full-9.9.9/VisHeart-Full-9.9.9-1.bin', 'VisHeart-Full-9.9.9/VisHeart-Full-9.9.9.exe')
                (@($files | ForEach-Object { $_.FullName } | Sort-Object) -join ',') | Should Be ((@($expected | Sort-Object)) -join ',')
                @($files | Where-Object { $_.CompressedLength -ne $_.Length }).Count | Should Be 0
            } finally { $z.Dispose() }
        } finally { Remove-Item -Recurse -Force $work }
    }

    It 'replaces an older zip of the same name' {
        $work = Join-Path $env:TEMP ("vh-rz-" + [guid]::NewGuid())
        $folder = Join-Path $work 'VisHeart-Update-9.9.9'
        New-Item -ItemType Directory $folder | Out-Null
        Set-Content (Join-Path $folder 'VisHeart-Update-9.9.9.exe') 'new'
        Set-Content (Join-Path $work 'VisHeart-Update-9.9.9.zip') 'old broken zip'
        try {
            $zip = New-ReleaseZip $folder
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $z = [IO.Compression.ZipFile]::OpenRead($zip)
            try { @($z.Entries | Where-Object { $_.Length -gt 0 }).Count | Should Be 1 } finally { $z.Dispose() }
        } finally { Remove-Item -Recurse -Force $work }
    }
}

Describe 'Write-ShippedFileList' {
    It 'lists every shipped file, sorted, except unet.pth (never replaced, so never removed)' {
        $f = Join-Path $env:TEMP ("vh-list-" + [guid]::NewGuid() + '.txt')
        try {
            Write-ShippedFileList @('b\two.txt', 'a\one.txt', 'cardiac-component-segmentation-ai\visheart-inference-gpu\app\models\unet.pth', ('c\caf' + [char]0xE9 + '.txt')) $f
            $lines = @(Get-Content $f -Encoding UTF8)
            ($lines -join '|') | Should Be ('a\one.txt|b\two.txt|c\caf' + [char]0xE9 + '.txt')
            # UTF-8 without a byte order mark
            [IO.File]::ReadAllBytes($f)[0] | Should Be ([byte][char]'a')
        } finally { Remove-Item -Force $f -ErrorAction SilentlyContinue }
    }
}
