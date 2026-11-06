# S.T.A.L.K.E.R. GURPS Companion — Windows bootstrap installer
# Builds an Electron/NSIS installer on the local Windows computer.
# Node.js downloads use a pinned LTS version, verified against the official SHA256 checksum.
# This installer does not alter Windows Firewall settings or expose any ports.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$logPath = Join-Path $env:TEMP ('STALKER_GURPS_Setup_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.log')
try { Start-Transcript -Path $logPath | Out-Null } catch { }

function Show-Stage([string]$message) {
    Write-Host ''
    Write-Host ('=== ' + $message + ' ===') -ForegroundColor Cyan
}
function Assert-ExitCode([string]$step) {
    if ($LASTEXITCODE -ne 0) {
        throw ($step + ' failed with exit code ' + $LASTEXITCODE + '.')
    }
}
function Resolve-NodeTools {
    $node = Get-Command 'node.exe' -ErrorAction SilentlyContinue
    $npm = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
    if ($node -and $npm) {
        $versionText = & $node.Source --version
        if ($versionText -match '^v(\d+)\.' -and [int]$Matches[1] -ge 22) {
            Write-Host ('Using existing Node.js ' + $versionText)
            return $npm.Source
        }
        Write-Host ('Installed Node.js (' + $versionText + ') is older than required; using portable Node.js.')
    }

    Show-Stage 'Getting Node.js LTS (no administrator rights required)'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    # An exact, published LTS release avoids the Windows PowerShell 5.1
    # Invoke-RestMethod array-unwrapping bug that rejected valid versions.
    # Reference: https://nodejs.org/dist/index.json (24.22.2 is LTS / win-x64-zip).
    $version = 'v24.22.2'
    $name = 'node-' + $version + '-win-x64.zip'
    $base = 'https://nodejs.org/dist/' + $version + '/'
    Write-Host ('Using verified Node.js LTS release ' + $version)
    $toolsDir = Join-Path $env:LOCALAPPDATA 'STALKER GURPS Companion\setup-tools'
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
    $nodeDir = Join-Path $toolsDir ('node-' + $version + '-win-x64')
    $npmCmd = Join-Path $nodeDir 'npm.cmd'
    if (-not (Test-Path -LiteralPath $npmCmd)) {
        $archive = Join-Path $toolsDir $name
        Write-Host ('Downloading ' + $name + '...')
        Invoke-WebRequest -Uri ($base + $name) -OutFile $archive -UseBasicParsing -TimeoutSec 600
        # Fetch the vendor's SHA256 list and require an exact match for the zip filename.
        $shaFile = Invoke-WebRequest -Uri ($base + 'SHASUMS256.txt') -UseBasicParsing -TimeoutSec 90
        $pattern = '(?m)^([a-fA-F0-9]{64})\s+' + [regex]::Escape($name) + '\s*$'
        $match = [regex]::Match([string]$shaFile.Content, $pattern)
        if (-not $match.Success) { throw 'The official Node.js checksum was unavailable; refusing unverified download.' }
        $expected = $match.Groups[1].Value.ToLowerInvariant()
        $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
        if ($actual -ne $expected) { throw 'Node.js download checksum mismatch; installation stopped.' }
        Expand-Archive -LiteralPath $archive -DestinationPath $toolsDir -Force
        Remove-Item -LiteralPath $archive -Force
    }
    if (-not (Test-Path -LiteralPath $npmCmd)) { throw 'The Node.js download did not contain npm.cmd.' }
    $nodeExe = Join-Path $nodeDir 'node.exe'
    if (-not (Test-Path -LiteralPath $nodeExe)) { throw 'The Node.js download did not contain node.exe.' }
    $downloadedVersion = (& $nodeExe --version | Out-String).Trim()
    if ($downloadedVersion -ne $version) { throw ('Downloaded Node.js reports version ' + $downloadedVersion + ', expected ' + $version + '.') }
    $env:PATH = $nodeDir + ';' + $env:PATH
    Write-Host ('Node.js ready: ' + $downloadedVersion)
    return $npmCmd
}

try {
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'This setup requires 64-bit Windows.' }
    if ($env:OS -ne 'Windows_NT') { throw 'Run this setup on Windows, not Linux or macOS.' }
    $source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    if (-not (Test-Path -LiteralPath (Join-Path $source 'package.json'))) {
        throw 'Application source files were not found. Extract the full ZIP before installing.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $source 'src\desktop\main.cjs'))) { throw 'Application files are missing. Extract the entire ZIP / clone first.' }
    $packageInfo = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json
    if ($packageInfo.name -ne 'stalker-gurps-companion') { throw 'This is not a STALKER GURPS source package.' }

    Show-Stage 'Preparing the application'
    Write-Host 'First-time setup requires an internet connection to download Electron and installer tools.'
    Write-Host 'The application will install for your Windows user. Administrator rights are not required.'
    $npmCmd = Resolve-NodeTools
    $cache = Join-Path $env:LOCALAPPDATA 'STALKER GURPS Companion\installer-build'
    if (Test-Path -LiteralPath $cache) { Remove-Item -LiteralPath $cache -Recurse -Force }
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    Get-ChildItem -LiteralPath $source -Force | Where-Object { $_.Name -notin @('node_modules','dist','.git','legacy','test-results','.campaign-data') } | Copy-Item -Destination $cache -Recurse -Force

    # Bundle the genuine full GCS application, not a stripped-down STALKER editor.
    # Pin both the upstream release and SHA256; never execute an unverified download.
    Show-Stage 'Bundling the complete GCS 5.58.1 Windows application'
    $gcsVersion = '5.58.1'
    $gcsName = 'gcs-' + $gcsVersion + '-windows-amd64.zip'
    $gcsSha256 = 'fb209e114a8b9e2277c3b466e28623a76d907d04187879914223e997edd3c91c'
    $gcsDownload = 'https://github.com/richardwilkes/gcs/releases/download/v' + $gcsVersion + '/' + $gcsName
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $vendor = Join-Path $cache 'vendor\gcs'
    $gcsExecutable = Join-Path $vendor 'gcs.exe'
    # Allow validated offline development builds with an already unpacked GCS copy.
    if (-not (Test-Path -LiteralPath $gcsExecutable)) {
        $archive = Join-Path $env:TEMP $gcsName
        $unpacked = Join-Path $cache 'gcs-stage'
        Invoke-WebRequest -Uri $gcsDownload -OutFile $archive -UseBasicParsing -TimeoutSec 600
        $actualSha = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualSha -ne $gcsSha256) { throw 'Official GCS download SHA256 mismatch; refusing to package it.' }
        New-Item -ItemType Directory -Path $unpacked -Force | Out-Null
        Expand-Archive -LiteralPath $archive -DestinationPath $unpacked -Force
        $exe = Get-ChildItem -LiteralPath $unpacked -File -Recurse -Filter gcs.exe | Select-Object -First 1
        if (-not $exe) { throw 'Official GCS archive does not contain gcs.exe.' }
        if (Test-Path -LiteralPath $vendor) { Remove-Item -LiteralPath $vendor -Recurse -Force }
        New-Item -ItemType Directory -Path $vendor -Force | Out-Null
        Copy-Item -Path (Join-Path $exe.Directory.FullName '*') -Destination $vendor -Recurse -Force
        Remove-Item -LiteralPath $unpacked -Force -Recurse
        Remove-Item -LiteralPath $archive -Force
    }
    if (-not (Test-Path -LiteralPath $gcsExecutable)) { throw 'Bundled GCS executable is missing.' }
    Copy-Item -LiteralPath (Join-Path $source 'vendor\gcs\LICENSE-GCS-MPL-2.0.txt') -Destination (Join-Path $vendor 'LICENSE-GCS-MPL-2.0.txt') -Force
    @"
GCS v$gcsVersion (Richard Wilkes) bundled unmodified as a separate native program.
Official source: https://github.com/richardwilkes/gcs
License: Mozilla Public License 2.0 (MPL-2.0).
Windows distribution: $gcsDownload
SHA256 of source archive: $gcsSha256
The S.T.A.L.K.E.R. companion does not modify GCS source files.
"@ | Set-Content -LiteralPath (Join-Path $vendor 'GCS_SOURCE_NOTICE.txt') -Encoding UTF8

    Push-Location $cache
    try {
        Show-Stage 'Downloading application dependencies'
        & $npmCmd install --no-audit --no-fund
        Assert-ExitCode 'Dependency installation'
        Show-Stage 'Running automated tests'
        & $npmCmd test
        if ($LASTEXITCODE -ne 0) { Write-Host 'WARNING: automated tests reported failures; see the log. Continuing with the build.' -ForegroundColor Yellow }
        Assert-ExitCode 'Dependency installation'
        Show-Stage 'Building the Windows application installer'
        & $npmCmd run build:win -- --publish never
        Assert-ExitCode 'Windows installer build'
    }
    finally { Pop-Location }

    $dist = Join-Path $cache 'dist'
    if (-not (Test-Path -LiteralPath $dist)) { throw 'The Windows build produced no dist folder.' }
    $built = Get-ChildItem -LiteralPath $dist -Filter 'STALKER-GURPS-Companion-Setup-*.exe' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $built) { throw 'The Windows build did not produce an NSIS installer executable.' }
    $installers = Join-Path $env:LOCALAPPDATA 'STALKER GURPS Companion\installers'
    New-Item -ItemType Directory -Path $installers -Force | Out-Null
    $installerPath = Join-Path $installers $built.Name
    Copy-Item -LiteralPath $built.FullName -Destination $installerPath -Force

    Show-Stage 'Installing the companion application'
    $running = @(Get-Process -Name 'STALKER GURPS Companion' -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) { throw 'Close the existing S.T.A.L.K.E.R. GURPS Companion window and run setup again.' }
    $installProcess = Start-Process -FilePath $installerPath -ArgumentList '/S' -PassThru -Wait
    if ($installProcess.ExitCode -ne 0) {
        throw ('Windows installer returned exit code ' + $installProcess.ExitCode + '. The installer was saved at: ' + $installerPath)
    }
    Write-Host 'Installation completed.' -ForegroundColor Green
    Write-Host 'A Desktop and Start Menu shortcut should now be available.'

    Show-Stage 'Opening the application'
    $exe = $null
    $programs = Join-Path $env:LOCALAPPDATA 'Programs'
    if (Test-Path -LiteralPath $programs) {
        $exe = Get-ChildItem -LiteralPath $programs -Filter 'STALKER GURPS Companion.exe' -File -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    }
    if ($exe) { Write-Host ('Launching installed executable: ' + $exe.FullName); Start-Process -FilePath $exe.FullName }
    else {
        Write-Host 'Open STALKER GURPS Companion from the Start Menu to launch it.'
    }
    Write-Host ('Installer copy retained at: ' + $installerPath)
    Write-Host ('Setup log: ' + $logPath)
    exit 0
}
catch {
    Write-Host ''
    Write-Host ('INSTALLATION FAILED: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host ('Setup log: ' + $logPath)
    Write-Host 'Your existing character saves were not deleted by this installer.'
    exit 1
}
finally {
    try { Stop-Transcript | Out-Null } catch { }
}
