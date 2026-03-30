#!/bin/bash
# Environment Validation Script for Gunshi (macOS/Linux)
REQUIRED_JAVA="17"

echo -e "\033[36m--- Environment Check ---\033[0m"

# 1. Check Java Version
JAVA_VER_OUTPUT=$(java -version 2>&1)
if [[ $JAVA_VER_OUTPUT =~ $REQUIRED_JAVA(\..*)? ]]; then
    echo -e "\033[32m[OK] Java Version: $REQUIRED_JAVA\033[0m"
else
    FOUND=$(echo "$JAVA_VER_OUTPUT" | head -n 1)
    echo -e "\033[31m[FAIL] Java Version 17 required. Found: $FOUND\033[0m"
    ENV_ERROR=1
fi

# 2. Check Android SDK
if [[ -n "$ANDROID_HOME" || -n "$ANDROID_SDK_ROOT" ]]; then
    SDK_PATH="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
    echo -e "\033[32m[OK] Android SDK found at: $SDK_PATH\033[0m"
else
    echo -e "\033[33m[WARN] ANDROID_HOME environment variable not set. Build might fail if local.properties is missing.\033[0m"
fi

# 3. Check Gradle Wrapper
if [[ -f "./gradlew" ]]; then
    echo -e "\033[32m[OK] Gradle Wrapper present.\033[0m"
else
    echo -e "\033[31m[FAIL] ./gradlew missing. Run in project root.\033[0m"
    ENV_ERROR=1
fi

echo -e "\033[36m------------------------\033[0m"

if [[ -n "$ENV_ERROR" ]]; then
    echo -e "\033[31mPlease fix the errors above before building.\033[0m"
    exit 1
else
    echo -e "\033[32mEnvironment is ready for building.\033[0m"
fi
