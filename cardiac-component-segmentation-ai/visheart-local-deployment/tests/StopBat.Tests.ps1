# Pester 3.4 tests for stop.bat. Each test copies stop.bat into a temp tree with a stub `docker` command and,
# where needed, a stub training-service stop script, so nothing real is stopped.
# Run from visheart-local-deployment:  Invoke-Pester .\tests\StopBat.Tests.ps1

$stopBat = Join-Path (Split-Path -Parent $PSScriptRoot) 'stop.bat'
$rootStopBat = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'stop.bat'
$rootStartBat = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'start.bat'

# A tiny console program standing in for docker.exe: it appends "docker <command line args>" to the file named in
# VH_STUB_LOG and exits 1, as docker does when Docker Desktop is not running.
$script:DockerStubExe = Join-Path $env:TEMP 'visheart-docker-stub.exe'
if (-not (Test-Path $script:DockerStubExe)) {
    Add-Type -OutputType ConsoleApplication -OutputAssembly $script:DockerStubExe -TypeDefinition @'
using System;
using System.IO;
public static class Program {
    public static int Main(string[] args) {
        string cmd = Environment.CommandLine;
        int i = cmd.StartsWith("\"") ? cmd.IndexOf('"', 1) + 1 : cmd.IndexOf(' ');
        string rest = i > 0 && i < cmd.Length ? cmd.Substring(i).Trim() : "";
        File.AppendAllText(Environment.GetEnvironmentVariable("VH_STUB_LOG"), "docker " + rest + Environment.NewLine);
        return 1;
    }
}
'@
}

function New-StopTree([switch]$WithEnvFiles, [switch]$TrainingRunning) {
    $root = Join-Path $env:TEMP ("vh-stop-" + [guid]::NewGuid())
    $deploy = Join-Path $root 'visheart-local-deployment'
    $bin = Join-Path $root 'bin'
    New-Item -ItemType Directory $deploy, $bin | Out-Null
    Copy-Item $stopBat $deploy
    Copy-Item $rootStopBat $root
    Copy-Item $rootStartBat $root
    # Stub deployment start.bat: records that the top-level start.bat reached it, and with which arguments.
    Set-Content (Join-Path $deploy 'start.bat') "@echo deploy-start %*>> `"$root\calls.txt`"" -Encoding ASCII
    # Stub docker.exe (an .exe like the real one: a batch file calling a .cmd without `call` would never return).
    Copy-Item $script:DockerStubExe (Join-Path $bin 'docker.exe')
    if ($WithEnvFiles) {
        Set-Content (Join-Path $deploy 'release.env') 'VH_BIND=127.0.0.1' -Encoding ASCII
        Set-Content (Join-Path $deploy 'secrets.env') 'VH_ADMIN_PASS=x' -Encoding ASCII
    }
    if ($TrainingRunning) {
        $retraining = Join-Path $root 'visheart-retraining'
        New-Item -ItemType Directory $retraining | Out-Null
        # Exit 1 = a training is running and the service refused to stop; with --force it stops.
        Set-Content (Join-Path $retraining 'stop-retraining-worker.bat') "@echo worker %*>> `"$root\calls.txt`"`r`n@if /I `"%~1`"==`"--force`" exit /b 0`r`n@exit /b 1" -Encoding ASCII
    }
    return $root
}

function Invoke-StopBat([string]$Root, [string]$Arguments, [string]$Script = 'visheart-local-deployment\stop.bat') {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'cmd.exe'
    $psi.Arguments = "/c `"`"$Root\$Script`" $Arguments`""
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardInput = $true   # stdin stays open: a pause or choice would wait for it
    $psi.EnvironmentVariables['PATH'] = "$Root\bin;" + $env:PATH
    $psi.EnvironmentVariables.Remove('STOP_TRAINING')
    $psi.EnvironmentVariables['VH_STUB_LOG'] = "$Root\calls.txt"
    # Some shells set this, and then cmd no longer runs a bare "stop.bat" from the current folder.
    $psi.EnvironmentVariables['NoDefaultCurrentDirectoryInExePath'] = '1'
    $p = [System.Diagnostics.Process]::Start($psi)
    $outTask = $p.StandardOutput.ReadToEndAsync()
    $finished = $p.WaitForExit(20000)
    if (-not $finished) { $p.Kill(); $p.WaitForExit() }
    $calls = if (Test-Path "$Root\calls.txt") { Get-Content "$Root\calls.txt" } else { @() }
    return [pscustomobject]@{ Finished = $finished; ExitCode = $p.ExitCode; Output = $outTask.Result; Calls = @($calls) }
}

Describe 'stop.bat' {
    It 'with --no-pause finishes without waiting when Docker is not running' {
        $root = New-StopTree
        try {
            $r = Invoke-StopBat $root '--no-pause'
            $r.Finished | Should Be $true
            $r.Output -match 'Press any key' | Should Be $false
            $r.ExitCode | Should Be 1
        } finally { Remove-Item -Recurse -Force $root }
    }

    It 'without --no-pause still pauses on an error (developer behaviour unchanged)' {
        $root = New-StopTree
        try {
            $r = Invoke-StopBat $root ''
            # Whether pause blocks on a redirected stdin depends on the host, so check that it ran.
            $r.Output -match 'Press any key' | Should Be $true
        } finally { Remove-Item -Recurse -Force $root }
    }

    It 'uses docker compose, not docker-compose' {
        $root = New-StopTree
        try {
            $r = Invoke-StopBat $root '--no-pause'
            @($r.Calls | Where-Object { $_ -like 'docker compose*down*' }).Count -gt 0 | Should Be $true
        } finally { Remove-Item -Recurse -Force $root }
    }

    It 'passes release.env and secrets.env when they exist' {
        $root = New-StopTree -WithEnvFiles
        try {
            $r = Invoke-StopBat $root '--no-pause'
            $down = @($r.Calls | Where-Object { $_ -like 'docker compose*down*' })
            $down.Count -gt 0 | Should Be $true
            foreach ($call in $down) {
                $call | Should Match ([regex]::Escape('--env-file "') + '.*release\.env"')
                $call | Should Match ([regex]::Escape('--env-file "') + '.*secrets\.env"')
            }
        } finally { Remove-Item -Recurse -Force $root }
    }

    It 'with --no-pause stops a running training without asking' {
        $root = New-StopTree -TrainingRunning
        try {
            $r = Invoke-StopBat $root '--no-pause'
            $r.Finished | Should Be $true
            @($r.Calls | Where-Object { $_ -like 'worker*--force*' }).Count | Should Be 1
        } finally { Remove-Item -Recurse -Force $root }
    }

    It 'the top-level stop.bat passes --no-pause through and does not pause either' {
        $root = New-StopTree
        try {
            $r = Invoke-StopBat $root '--no-pause' 'stop.bat'
            $r.Finished | Should Be $true
            $r.ExitCode | Should Be 1
            @($r.Calls | Where-Object { $_ -like 'docker compose*down*' }).Count -gt 0 | Should Be $true
        } finally { Remove-Item -Recurse -Force $root }
    }
}

Describe 'top-level start.bat' {
    It 'runs visheart-local-deployment\start.bat with the same arguments' {
        $root = New-StopTree
        try {
            $r = Invoke-StopBat $root '--cpu' 'start.bat'
            $r.Finished | Should Be $true
            @($r.Calls | Where-Object { $_ -eq 'deploy-start --cpu' }).Count | Should Be 1
        } finally { Remove-Item -Recurse -Force $root }
    }
}

Describe 'stop.bat removes the unnamed volumes of its containers' {
    It 'removes the containers with "rm -s -f -v" for both profiles before "down", and never "down -v"' {
        # 2026-11-21, test desktop: every start left 3 unnamed volumes, because "down" without -v keeps them.
        $root = New-StopTree
        try {
            $r = Invoke-StopBat $root '--no-pause'
            $calls = @($r.Calls)
            $rm = [array]::FindIndex([string[]]$calls, [Predicate[string]]{ param($c) $c -like 'docker compose*--profile cpu --profile gpu rm -s -f -v*' })
            $down = [array]::FindIndex([string[]]$calls, [Predicate[string]]{ param($c) $c -like 'docker compose*down*' })
            $rm | Should Not Be -1
            $rm -lt $down | Should Be $true
            @($calls | Where-Object { $_ -match 'down.* -v\b' }).Count | Should Be 0
        } finally { Remove-Item -Recurse -Force $root }
    }
}
