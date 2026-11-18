# Pester 3.4 tests for the parameterised docker-compose.yml.
# Run from visheart-local-deployment:  Invoke-Pester .\tests\Compose.Tests.ps1
# Needs the docker CLI (compose v2.17+); the Docker daemon does not have to be running.

$deploymentDir = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $deploymentDir 'docker-compose.yml'
$fixtureEnv = Join-Path $PSScriptRoot 'fixtures\installed.env'

function Get-ComposeConfig([string[]]$EnvFiles = @()) {
    $envArgs = @()
    foreach ($f in $EnvFiles) { $envArgs += @('--env-file', $f) }
    # An empty env file stops compose from reading a stray .env in the project folder.
    $emptyEnv = Join-Path $env:TEMP 'visheart-empty.env'
    if (-not $EnvFiles) { [IO.File]::WriteAllText($emptyEnv, ''); $envArgs = @('--env-file', $emptyEnv) }
    $json = & docker compose -f $composeFile @envArgs --profile gpu --profile cpu config --format json
    if ($LASTEXITCODE -ne 0) { throw "docker compose config failed (exit $LASTEXITCODE)" }
    return ($json | Out-String) | ConvertFrom-Json
}

function Get-AllPorts($config) {
    foreach ($svc in $config.services.PSObject.Properties) {
        foreach ($p in @($svc.Value.ports)) {
            if ($p) { [pscustomobject]@{ Service = $svc.Name; Port = $p } }
        }
    }
}

Describe 'docker-compose.yml defaults (no env file)' {
    $config = Get-ComposeConfig

    It "defaults keep today's values" {
        $app = $config.services.'visheart-app'
        $p3000 = @($app.ports | Where-Object { $_.target -eq 3000 })[0]
        $p3000 | Should Not BeNullOrEmpty
        # No host_ip at all: Docker's default (all IPv4 and IPv6 addresses), exactly as before.
        @(Get-AllPorts $config | Where-Object { $_.Port.host_ip }).Count | Should Be 0
        $app.image | Should Be 'sharlene21/visheart-local:1.5.0'
        $config.services.mongodb.environment.MONGO_INITDB_ROOT_PASSWORD | Should Be 'P@ssw0rd123!'
        $app.environment.MONGODB_URI | Should Match ([regex]::Escape('admin:P%40ssw0rd123%21@'))
        $app.environment.ADMIN_PASS | Should Be 'P@ssw0rd123!'
        $app.environment.S3_ANONYMOUS_READ | Should Be 'download'
        $config.services.Keys -contains 'minio-setup' | Should Be $false
    }

    It 'no personal mail in repository' {
        (Get-Content -Raw $composeFile) -match 'meiqiliew334' | Should Be $false
        [string]$config.services.'visheart-app'.environment.SMTP_PASS | Should Be ''
    }

    It 'without SMTP credentials the FAQ is logged, not sent' {
        # support_routes.ts only logs the message when SMTP_HOST is empty; a host with no
        # credentials would make every FAQ send fail instead.
        [string]$config.services.'visheart-app'.environment.SMTP_HOST | Should Be ''
    }
}

Describe 'docker-compose.yml with the installed env file' {
    $config = Get-ComposeConfig @($fixtureEnv)
    $fixture = @{}
    Get-Content $fixtureEnv | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object {
        $k, $v = $_ -split '=', 2; $fixture[$k] = $v
    }

    It 'installed env applies' {
        $ports = @(Get-AllPorts $config)
        $ports.Count -gt 0 | Should Be $true
        foreach ($entry in $ports) {
            "$($entry.Service):$($entry.Port.target)=$($entry.Port.host_ip)" |
                Should Be "$($entry.Service):$($entry.Port.target)=127.0.0.1"
        }
        $config.services.'gpu-nvidia'.image | Should Be $fixture['VH_GPU_IMAGE']
        $config.services.'gpu-cpu'.image | Should Be $fixture['VH_GPU_IMAGE']
        $config.services.'visheart-app'.image | Should Be $fixture['VH_APP_IMAGE']
        $config.services.'visheart-app'.environment.ADMIN_PASS | Should Be $fixture['VH_ADMIN_PASS']
        $config.services.'visheart-app'.environment.S3_ANONYMOUS_READ | Should Be 'none'
    }

    It 'installed env replaces every secret' {
        $app = $config.services.'visheart-app'.environment
        $app.MONGODB_URI | Should Match ([regex]::Escape("admin:$($fixture['VH_MONGO_PASSWORD_URL'])@"))
        $app.SESSION_SECRET | Should Be $fixture['VH_SESSION_SECRET']
        $app.S3_SECRET_ACCESS_KEY | Should Be $fixture['VH_MINIO_PASSWORD']
        $app.AWS_SECRET_ACCESS_KEY | Should Be $fixture['VH_MINIO_PASSWORD']
        $app.GPU_JWT_SECRET | Should Be $fixture['VH_GPU_JWT_SECRET']
        $app.GPU_SERVER_AUTH_JWT_SECRET | Should Be $fixture['VH_GPU_SERVER_AUTH_JWT_SECRET']
        $app.SMTP_PASS | Should Be $fixture['VH_SMTP_PASS']
        $app.SMTP_USER | Should Be $fixture['VH_SMTP_USER']
        $app.ADMIN_SUPPORT_EMAIL | Should Be $fixture['VH_SUPPORT_EMAIL']
        $app.SMTP_FROM | Should Be $fixture['VH_SUPPORT_EMAIL']
        $app.SMTP_HOST | Should Be 'smtp.gmail.com'
        $config.services.mongodb.environment.MONGO_INITDB_ROOT_PASSWORD | Should Be $fixture['VH_MONGO_PASSWORD']
        ($config.services.mongodb.healthcheck.test -join ' ') | Should Match $fixture['VH_MONGO_PASSWORD']
        $config.services.minio.environment.MINIO_ROOT_PASSWORD | Should Be $fixture['VH_MINIO_PASSWORD']
        $config.services.minio.image | Should Be $fixture['VH_MINIO_IMAGE']
        $gpu = $config.services.'gpu-nvidia'.environment
        $gpu.GPU_ACCESS_SECRET | Should Be $fixture['VH_GPU_ACCESS_SECRET']
        $gpu.JWT_SECRET | Should Be $fixture['VH_JWT_SECRET']
        $config.services.'gpu-cpu'.environment.GPU_ACCESS_SECRET | Should Be $fixture['VH_GPU_ACCESS_SECRET']
    }
}

Describe 'mounts inside read-only mounts' {
    # Docker cannot create a mount point inside a read-only bind mount ("mkdirat ... read-only file system"), so the
    # host folder must exist first. Initialize-BackendFolders (start.ps1) creates them; this finds every such mount in
    # docker-compose.yml, so a new one cannot be forgotten.
    Import-Module (Join-Path $deploymentDir 'lib\VisHeartStart.psm1') -Force
    $config = Get-ComposeConfig
    $needed = @()
    foreach ($svc in $config.services.PSObject.Properties) {
        $vols = @($svc.Value.volumes | Where-Object { $_ })
        $readOnly = @($vols | Where-Object { $_.type -eq 'bind' -and $_.read_only })
        foreach ($v in $vols) {
            foreach ($r in $readOnly) {
                $prefix = $r.target.TrimEnd('/') + '/'
                if ($v -ne $r -and $v.target.StartsWith($prefix)) {
                    $needed += [IO.Path]::GetFullPath((Join-Path $r.source ($v.target.Substring($prefix.Length) -replace '/', '\')))
                }
            }
        }
    }

    It 'finds the five known ones' {
        @($needed | Sort-Object -Unique).Count | Should Be 5
    }

    It 'Initialize-BackendFolders creates the host folder of every one' {
        $created = @((Initialize-BackendFolders $deploymentDir).Folders | ForEach-Object { [IO.Path]::GetFullPath($_) })
        foreach ($path in ($needed | Sort-Object -Unique)) {
            ($created -contains $path) | Should Be $true
        }
    }
}

Describe 'MongoDB and Redis host ports' {
    # Only VisHeart's containers use MongoDB and Redis, over Docker's network. A developer copy keeps the usual host
    # ports (for tools such as Compass); an installed copy lets Docker pick free ones, so a MongoDB or Redis that the
    # PC already runs cannot block VisHeart (found installing 1.0.1 on a PC with the MongoDB Windows service).
    It 'a developer copy publishes 27017 and 6379' {
        $config = Get-ComposeConfig
        @($config.services.mongodb.ports)[0].published | Should Be '27017'
        @($config.services.redis.ports)[0].published | Should Be '6379'
    }
    It 'an installed copy lets Docker choose free ports on 127.0.0.1' {
        $config = Get-ComposeConfig @($fixtureEnv)
        foreach ($svc in 'mongodb', 'redis') {
            $port = @($config.services.$svc.ports)[0]
            $port.published | Should Be '0'
            $port.host_ip | Should Be '127.0.0.1'
        }
    }
}
