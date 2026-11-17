# Pester 3.4: the GPU image's .dockerignore keeps out every file in app/models except the shipped models, the same
# list the installer ships (Staging.psm1), so a test or trained model on the build PC is never baked into the image.
# Run from cardiac-component-segmentation-ai:  Invoke-Pester .\installer\tests\GpuDockerignore.Tests.ps1

$modulePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib\Staging.psm1'
Get-Module Staging | Remove-Module -Force
Import-Module $modulePath -Force

$appRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ignorePath = Join-Path $appRoot 'visheart-inference-gpu\.dockerignore'

Describe 'visheart-inference-gpu .dockerignore' {
    $lines = @(Get-Content $ignorePath | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') })
    $modelLines = @($lines | Where-Object { $_ -match '^!?app/models' })

    It 'leaves out everything in app/models first' {
        $modelLines.Count | Should BeGreaterThan 0
        $modelLines[0] | Should Be 'app/models/*'
    }

    It 'lets in exactly the shipped models' {
        $allowed = @($modelLines | Where-Object { $_.StartsWith('!') } | ForEach-Object { $_.Substring('!app/models/'.Length) } | Sort-Object)
        ($allowed -join ', ') | Should Be ((@(Get-ShippedModelNames) | Sort-Object) -join ', ')
    }
}
