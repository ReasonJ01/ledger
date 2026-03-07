# Start TigerBeetle single-replica cluster for development
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$DataDir = Join-Path $ProjectRoot "data"
$TbDir = Join-Path $ProjectRoot "tigerbeetle"
$DataFile = Join-Path $DataDir "0_0.tigerbeetle"

# Ensure data directory exists
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

# Download TigerBeetle if not present
$TbExe = Join-Path $TbDir "tigerbeetle.exe"
if (-not (Test-Path $TbExe)) {
    Write-Host "Downloading TigerBeetle..."
    $ZipPath = Join-Path $ProjectRoot "tigerbeetle.zip"
    Invoke-WebRequest -Uri "https://windows.tigerbeetle.com" -OutFile $ZipPath -UseBasicParsing
    Expand-Archive -Path $ZipPath -DestinationPath $TbDir -Force
    Remove-Item $ZipPath -Force
}

# Stop any existing TigerBeetle
$existing = Get-Process -Name "tigerbeetle" -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Stopping existing TigerBeetle..."
    $existing | Stop-Process -Force
    Start-Sleep -Seconds 3
}

# Remove data file so format creates a fresh one (ensures clean reset)
if (Test-Path $DataFile) {
    Write-Host "Removing existing data file..."
    Remove-Item $DataFile -Force
}

# Format data file (creates fresh)
Write-Host "Formatting TigerBeetle data file..."
& $TbExe format --cluster=1 --replica=0 --replica-count=1 --development $DataFile

# Start replica
Write-Host "Starting TigerBeetle on port 3000..."
& $TbExe start --addresses=3000 --development $DataFile
