param(
    [string]$Repo = "kapshytar/chat-aggregator-mobile",
    [string]$RepoDir = "C:\chat-aggregator-android",
    [string]$Workflow = "Build Android Artifacts",
    [string]$Branch = "main",
    [string]$HeadSha = "",
    [switch]$WaitForHeadRun,
    [int]$WaitTimeoutSec = 900,
    [int]$PollSec = 10,
    [string]$DeviceSerial = "",
    [string]$OutputDir = "C:\chat-aggregator-android\ci-output\latest-ci-install"
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

function Get-AdbPath {
    $preferred = @(
        "C:\Users\kvita\scoop\apps\android-clt\current\platform-tools\adb.exe",
        "C:\Users\kvita\AppData\Local\Microsoft\WinGet\Packages\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\platform-tools\adb.exe"
    )
    foreach ($p in $preferred) {
        if (Test-Path $p) { return $p }
    }
    $cmd = Get-Command adb -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "adb not found in known paths or PATH"
}

function Get-CurrentHeadSha([string]$RepoDir) {
    if (-not (Test-Path $RepoDir)) { return "" }
    try {
        return (git -C $RepoDir rev-parse HEAD).Trim()
    } catch {
        return ""
    }
}

function Get-Runs([string]$Repo, [string]$Workflow) {
    $json = gh run list --repo $Repo --workflow $Workflow --limit 50 --json databaseId,status,conclusion,event,headBranch,headSha,createdAt
    return ($json | ConvertFrom-Json)
}

function Get-LatestSuccessfulPushRunId {
    param([string]$Repo, [string]$Workflow, [string]$Branch)

    $runs = Get-Runs -Repo $Repo -Workflow $Workflow
    $run = $runs |
        Where-Object { $_.event -eq "push" -and $_.headBranch -eq $Branch -and $_.conclusion -eq "success" } |
        Sort-Object createdAt -Descending |
        Select-Object -First 1

    if (-not $run) {
        throw "No successful push run found for workflow '$Workflow' on branch '$Branch'"
    }

    return [string]$run.databaseId
}

function Get-SuccessfulPushRunIdForHeadSha {
    param([string]$Repo, [string]$Workflow, [string]$Branch, [string]$HeadSha)

    $runs = Get-Runs -Repo $Repo -Workflow $Workflow
    $run = $runs |
        Where-Object {
            $_.event -eq "push" -and
            $_.headBranch -eq $Branch -and
            $_.headSha -eq $HeadSha -and
            $_.conclusion -eq "success"
        } |
        Sort-Object createdAt -Descending |
        Select-Object -First 1

    if (-not $run) { return "" }
    return [string]$run.databaseId
}

function Wait-ForSuccessfulPushRunByHeadSha {
    param(
        [string]$Repo,
        [string]$Workflow,
        [string]$Branch,
        [string]$HeadSha,
        [int]$TimeoutSec,
        [int]$PollSec
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $runs = Get-Runs -Repo $Repo -Workflow $Workflow
        $target = $runs |
            Where-Object { $_.event -eq "push" -and $_.headBranch -eq $Branch -and $_.headSha -eq $HeadSha } |
            Sort-Object createdAt -Descending |
            Select-Object -First 1

        if ($target) {
            if ($target.status -eq "completed") {
                if ($target.conclusion -eq "success") {
                    return [string]$target.databaseId
                }
                throw "Head run completed with conclusion '$($target.conclusion)' (run $($target.databaseId))"
            }
            Write-Host "Waiting for run $($target.databaseId): status=$($target.status)"
        } else {
            Write-Host "Waiting for push run for head $HeadSha ..."
        }

        Start-Sleep -Seconds $PollSec
    }

    throw "Timed out waiting for successful push run for head $HeadSha"
}

function Get-ArtifactNameFromRun {
    param([string]$Repo, [string]$RunId)

    $apiPath = "repos/$Repo/actions/runs/$RunId/artifacts"
    $json = gh api $apiPath
    $data = $json | ConvertFrom-Json

    $artifact = $data.artifacts |
        Where-Object { $_.expired -eq $false -and $_.name -like "chat-aggregator-build-*" } |
        Sort-Object created_at -Descending |
        Select-Object -First 1

    if (-not $artifact) {
        throw "Could not find non-expired chat-aggregator-build artifact in run $RunId"
    }

    return [string]$artifact.name
}

function Download-ArtifactWithRetry {
    param([string]$Repo, [string]$RunId, [string]$ArtifactName, [string]$OutputDir)

    for ($i = 1; $i -le 3; $i++) {
        try {
            if (Test-Path $OutputDir) { Remove-Item $OutputDir -Recurse -Force }
            New-Item -ItemType Directory -Path $OutputDir | Out-Null
            gh run download $RunId --repo $Repo --name $ArtifactName --dir $OutputDir | Out-Host
            return
        } catch {
            if ($i -eq 3) { throw }
            Write-Host "Download attempt $i failed, retrying..."
            Start-Sleep -Seconds 3
        }
    }
}

function Get-ConnectedDeviceSerial {
    param([string]$AdbPath, [string]$Requested)

    $lines = & $AdbPath devices | Select-Object -Skip 1
    $devices = @()
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if (-not $trimmed) { continue }
        if ($trimmed -match "^(.+?)\s+device$") {
            $devices += $Matches[1]
        }
    }

    if ($Requested) {
        if ($devices -contains $Requested) { return $Requested }
        throw "Requested device '$Requested' is not connected. Connected: $($devices -join ', ')"
    }

    if ($devices.Count -eq 0) {
        throw "No connected adb devices"
    }

    if ($devices.Count -gt 1) {
        Write-Host "Multiple devices connected; using first: $($devices[0])"
    }

    return $devices[0]
}

Require-Command gh
$adb = Get-AdbPath

if (-not $HeadSha) {
    $HeadSha = Get-CurrentHeadSha -RepoDir $RepoDir
}

$runId = ""
if ($HeadSha) {
    if ($WaitForHeadRun) {
        $runId = Wait-ForSuccessfulPushRunByHeadSha -Repo $Repo -Workflow $Workflow -Branch $Branch -HeadSha $HeadSha -TimeoutSec $WaitTimeoutSec -PollSec $PollSec
    } else {
        $runId = Get-SuccessfulPushRunIdForHeadSha -Repo $Repo -Workflow $Workflow -Branch $Branch -HeadSha $HeadSha
    }
}
if (-not $runId) {
    $runId = Get-LatestSuccessfulPushRunId -Repo $Repo -Workflow $Workflow -Branch $Branch
}

$artifactName = Get-ArtifactNameFromRun -Repo $Repo -RunId $runId

Write-Host "Using run: $runId"
if ($HeadSha) { Write-Host "Head sha: $HeadSha" }
Write-Host "Using artifact: $artifactName"

Download-ArtifactWithRetry -Repo $Repo -RunId $runId -ArtifactName $artifactName -OutputDir $OutputDir

$apk = Get-ChildItem -Path $OutputDir -Recurse -File -Filter *.apk | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) {
    throw "No APK found after artifact download"
}

$serial = Get-ConnectedDeviceSerial -AdbPath $adb -Requested $DeviceSerial
Write-Host "Installing to device: $serial"
Write-Host "APK: $($apk.FullName)"

& $adb -s $serial install -r $apk.FullName | Out-Host

Write-Host "DONE: Installed $($apk.Name) from run $runId to $serial"
