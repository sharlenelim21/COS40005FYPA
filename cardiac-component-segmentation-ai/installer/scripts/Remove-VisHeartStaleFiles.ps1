<#
Run by the installer after an update copied its files. Removes the files the old version shipped (OldList, its
shipped-files.txt saved before the copy) that this version no longer ships (AppDir\shipped-files.txt), and the folders
that become empty. Only listed files are ever removed: patient data, passwords, logs and trained models are never on a
list. Paths outside AppDir are ignored. Without this version's list, nothing is removed.
Always exits 0: a file left behind does not stop VisHeart from working.
#>
param(
    [Parameter(Mandatory)][string]$AppDir,
    [Parameter(Mandatory)][string]$OldList
)

function Read-List([string]$Path) {
    $set = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($line in [IO.File]::ReadAllLines($Path, [Text.Encoding]::UTF8)) {
        $entry = $line.Trim()
        if ($entry) { [void]$set.Add($entry) }
    }
    return ,$set
}

function Test-SafeEntry([string]$Entry) {
    # A plain relative path: not rooted, no drive, no ".." step.
    if ($Entry.Contains(':') -or $Entry.StartsWith('\') -or $Entry.StartsWith('/')) { return $false }
    return -not (@($Entry -split '[\\/]') -contains '..')
}

try {
    $app = (Resolve-Path -LiteralPath $AppDir).Path.TrimEnd('\')
    $newList = Join-Path $app 'shipped-files.txt'
    if (-not (Test-Path -LiteralPath $newList) -or -not (Test-Path -LiteralPath $OldList)) {
        Write-Host 'No file lists to compare; nothing removed.'
        exit 0
    }
    $current = Read-List $newList
    $removed = 0
    foreach ($entry in (Read-List $OldList)) {
        if ($current.Contains($entry) -or -not (Test-SafeEntry $entry)) { continue }
        $file = Join-Path $app $entry
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
        Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $file) { continue }
        $removed++
        # Remove the folders this leaves empty, up to (not including) the install folder.
        $dir = Split-Path -Parent $file
        while ($dir.Length -gt $app.Length -and $dir.StartsWith($app + '\', [StringComparison]::OrdinalIgnoreCase) -and
                @(Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue).Count -eq 0) {
            Remove-Item -LiteralPath $dir -Force -ErrorAction SilentlyContinue
            $dir = Split-Path -Parent $dir
        }
    }
    Write-Host "Removed $removed file(s) that this version of VisHeart no longer uses."
} catch {
    Write-Host "Could not remove old files: $($_.Exception.Message)"
}
exit 0
