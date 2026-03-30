param (
    [string]$DeviceIp = "192.168.0.101"
)

Write-Host "Connecting to ADB device ${DeviceIp}..."
adb connect "${DeviceIp}:5555"

# Wait a moment for connection to stabilize
Start-Sleep -Seconds 2

Write-Host "Fetching latest successful run ID from main branch..."
$runId = gh run list --branch main --status success --limit 1 --json databaseId -q ".[0].databaseId"

if (-not $runId) {
    Write-Host "Failed to find a successful run."
    exit 1
}

Write-Host "Run ID: $runId"
$outDir = "C:\chat-aggregator-android\ci-output\latest-build"

if (Test-Path $outDir) {
    Remove-Item -Recurse -Force $outDir
}

Write-Host "Downloading artifacts..."
gh run download $runId --dir $outDir

if (-not $?) {
    Write-Host "Download failed."
    exit 1
}

$apk = Get-ChildItem -Path $outDir -Filter *.apk -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $apk) {
    Write-Host "No APK found in the downloaded artifacts."
    exit 1
}

Write-Host "Found APK: $($apk.FullName)"
Write-Host "Installing via ADB..."

adb -s "${DeviceIp}:5555" install -r "$($apk.FullName)"

if ($?) {
    Write-Host "Install successful!"
}
else {
    Write-Host "Install failed."
}
