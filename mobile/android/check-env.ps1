# Environment Validation Script for Gunshi (Windows)
$requiredJava = "17"

Write-Host "--- Environment Check ---" -ForegroundColor Cyan

# 1. Check Java Version
try {
    $javaVerOutput = java -version 2>&1 | Out-String
    if ($javaVerOutput -match "version `"$requiredJava(\..*)?`"") {
        Write-Host "[OK] Java Version: $requiredJava" -ForegroundColor Green
    } else {
        $found = ($javaVerOutput -split "`r?`n")[0]
        Write-Host "[FAIL] Java Version 17 required. Found: $found" -ForegroundColor Red
        $envError = $true
    }
} catch {
    Write-Host "[FAIL] Java not found in PATH." -ForegroundColor Red
    $envError = $true
}

# 2. Check Android SDK
if ($env:ANDROID_HOME -or $env:ANDROID_SDK_ROOT) {
    $sdkPath = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
    Write-Host "[OK] Android SDK found at: $sdkPath" -ForegroundColor Green
} else {
    Write-Host "[WARN] ANDROID_HOME environment variable not set. Build might fail if local.properties is missing." -ForegroundColor Yellow
}

# 3. Check Gradle Wrapper
if (Test-Path "gradlew.bat") {
    Write-Host "[OK] Gradle Wrapper present." -ForegroundColor Green
} else {
    Write-Host "[FAIL] gradlew.bat missing. Run in project root." -ForegroundColor Red
    $envError = $true
}

Write-Host "------------------------" -ForegroundColor Cyan

if ($envError) {
    Write-Host "Please fix the errors above before building." -ForegroundColor Red
    exit 1
} else {
    Write-Host "Environment is ready for building." -ForegroundColor Green
}
