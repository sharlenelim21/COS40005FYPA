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
        'cardiac-component-segmentation-ai\FIRST-LOGIN.txt'
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
            $_ -match '(^|\\)(secrets\.env|release\.env|\.env|FIRST-LOGIN\.txt)$' -or
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

Describe 'Test-ReleaseImages' {
    Mock -ModuleName Staging Test-ImageOnRegistry { $Reference -ne 'sharlene21/visheart-gpu:9.9.9' }

    It 'latest and missing images are reported' {
        $images = @{
            VH_APP_IMAGE          = 'sharlene21/visheart-local:1.5.0'
            VH_GPU_IMAGE          = 'sharlene21/visheart-gpu:9.9.9'
            VH_MINIO_IMAGE        = 'bitnamilegacy/minio:latest'
            VH_MINIO_CLIENT_IMAGE = 'bitnamilegacy/minio-client@sha256:00dcc4e58ada0df45bb7d9ee435af98295f96c27c3c68292ce78ec700a87b511'
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
    $images = @{ VH_APP_IMAGE = 'a/app:1'; VH_GPU_IMAGE = 'a/gpu:1'; VH_MINIO_IMAGE = 'a/minio:1'; VH_MINIO_CLIENT_IMAGE = 'a/mc:1' }

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
        $map['VH_MINIO_CLIENT_IMAGE'] | Should Be 'a/mc:1'
        $map['VH_SUPPORT_EMAIL'] | Should Be 'support@example.test'
        $map['VH_SMTP_USER'] | Should Be 'support@example.test'
        $map['VH_SMTP_PASS'] | Should Be 'abcd efgh ijkl mnop'
        $map['VH_BIND'] | Should Be '127.0.0.1'
        $map['VH_MINIO_ANON'] | Should Be 'none'
        $map.Count | Should Be 9
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
}
