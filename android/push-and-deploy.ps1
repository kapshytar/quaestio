param(
    [string]$CommitMessage = "Auto-update",
    [string]$Branch = ""
)

if ($Branch -eq "") {
    $Branch = (git branch --show-current).Trim()
}

Write-Host "Pushing to $Branch..."
git add .
git commit -m $CommitMessage
git push origin $Branch

Write-Host "Triggering workflow on $Branch..."
gh workflow run build-apk.yml --ref $Branch
Start-Sleep -Seconds 5

$runs = gh run list --limit 1 --branch $Branch --json databaseId | ConvertFrom-Json
if ($runs.Count -eq 0) {
    Write-Host "Failed to find the workflow run."
    exit 1
}
$runId = $runs[0].databaseId

Write-Host "Watching run: $runId"
gh run watch $runId --exit-status
if ($LASTEXITCODE -ne 0) {
    Write-Host "Workflow failed!"
    exit $LASTEXITCODE
}

Write-Host "Downloading artifacts..."
$outDir = "ci-output\deploy-build-$runId"
if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
gh run download $runId --dir $outDir

$apk = Get-ChildItem -Path $outDir -Filter *.apk -Recurse | Select-Object -First 1
if ($apk) {
    Write-Host "Installing $($apk.FullName) to 192.168.0.101:5555"
    adb connect 192.168.0.101:5555
    adb -s "192.168.0.101:5555" install -r "$($apk.FullName)"
    adb -s "192.168.0.101:5555" shell monkey -p com.chataggregator.app -c android.intent.category.LAUNCHER 1
    Write-Host "Done!"
} else {
    Write-Host "No APK found in the downloaded artifacts."
}
