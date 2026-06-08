# QA Buddy Installer Script
# Designed to be run via: irm https://raw.githubusercontent.com/ridhanshr/QABuddy/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

# Configuration
$RepoOwner = "ridhanshr"
$RepoName = "QABuddy"
$AppName = "QA Buddy"
$TempInstallerPath = Join-Path $env:TEMP "QA_Buddy_Setup.exe"

Write-Host "=============================================" -ForegroundColor Green
Write-Host "       Installing $AppName Desktop           " -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""

try {
    # 1. Fetch latest release details from GitHub API
    Write-Host "Connecting to GitHub API to find the latest version..." -ForegroundColor Gray
    $ApiUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"
    
    # Configure Security Protocol for TLS 1.2
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    
    try {
        $ReleaseInfo = Invoke-RestMethod -Uri $ApiUrl -Method Get -Headers @{"User-Agent"="PowerShell-Installer"} -UseBasicParsing
    } catch {
        Write-Host ""
        Write-Host "Error: Could not retrieve release information from GitHub API." -ForegroundColor Red
        Write-Host "Please ensure:" -ForegroundColor Yellow
        Write-Host " 1. The repository 'https://github.com/$RepoOwner/$RepoName' exists and is Public." -ForegroundColor Yellow
        Write-Host " 2. You have published at least one Release on GitHub." -ForegroundColor Yellow
        Write-Host " 3. You are connected to the Internet." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Technical Details: $_" -ForegroundColor DarkGray
        exit 1
    }

    $Version = $ReleaseInfo.tag_name
    Write-Host "Found version $Version" -ForegroundColor Green

    # 2. Find the setup executable asset (.exe)
    $Asset = $ReleaseInfo.assets | Where-Object { $_.name -like "*Setup*.exe" } | Select-Object -First 1
    if (-not $Asset) {
        $Asset = $ReleaseInfo.assets | Where-Object { $_.name -like "*.exe" } | Select-Object -First 1
    }

    if (-not $Asset) {
        Write-Host "Error: No .exe setup files were found in the latest release ($Version)." -ForegroundColor Red
        Write-Host "Please make sure you have uploaded the build (e.g., 'QA Buddy Setup $Version.exe') as an asset to the release." -ForegroundColor Yellow
        exit 1
    }

    $DownloadUrl = $Asset.browser_download_url
    $FileName = $Asset.name
    $FileSizeMB = [Math]::Round($Asset.size / 1MB, 2)

    Write-Host "Downloading $FileName ($FileSizeMB MB)..." -ForegroundColor Gray

    # Save current ProgressPreference to restore later
    $OldProgressPreference = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'

    # Download the installer
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempInstallerPath -UseBasicParsing

    # Restore ProgressPreference
    $ProgressPreference = $OldProgressPreference
    Write-Host "Download complete." -ForegroundColor Green

    # 3. Launch the Installer
    Write-Host "Launching installer..." -ForegroundColor Gray
    Write-Host "Please complete the setup wizard that has opened." -ForegroundColor Yellow
    
    # Start the installer and wait for it to complete
    $Process = Start-Process -FilePath $TempInstallerPath -Wait -PassThru
    
    if ($Process.ExitCode -eq 0) {
        Write-Host ""
        Write-Host "=============================================" -ForegroundColor Green
        Write-Host "       $AppName Installed Successfully!      " -ForegroundColor Green
        Write-Host "=============================================" -ForegroundColor Green
    } else {
        Write-Host "Installer exited with code: $($Process.ExitCode)" -ForegroundColor Yellow
    }

} catch {
    Write-Host ""
    Write-Host "An unexpected error occurred during installation:" -ForegroundColor Red
    Write-Host $_ -ForegroundColor Red
} finally {
    # 4. Clean up
    if (Test-Path $TempInstallerPath) {
        Write-Host "Cleaning up temporary files..." -ForegroundColor Gray
        Remove-Item -Path $TempInstallerPath -Force -ErrorAction SilentlyContinue
    }
}
