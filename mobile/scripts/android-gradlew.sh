#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"
GRADLE_PROPERTIES="$ANDROID_DIR/gradle.properties"

if [ ! -f "$GRADLE_PROPERTIES" ]; then
  echo "Missing $GRADLE_PROPERTIES" >&2
  exit 1
fi

PINNED_JAVA_HOME="$(awk -F= '/^org\.gradle\.java\.home=/{print $2}' "$GRADLE_PROPERTIES" | tail -n 1)"

if [ -z "$PINNED_JAVA_HOME" ]; then
  echo "Missing org.gradle.java.home in $GRADLE_PROPERTIES" >&2
  exit 1
fi

if [ ! -x "$PINNED_JAVA_HOME/bin/java" ]; then
  echo "Pinned Java runtime is not executable: $PINNED_JAVA_HOME/bin/java" >&2
  exit 1
fi

export JAVA_HOME="$PINNED_JAVA_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

cd "$ANDROID_DIR"
./gradlew "$@"
