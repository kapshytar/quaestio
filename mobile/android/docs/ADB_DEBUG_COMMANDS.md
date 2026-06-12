# ADB Debug Commands

Use these commands to control runtime debug flags without opening app settings.

## Enable Detailed Logging
```bash
adb shell am broadcast \
  -a com.chataggregator.app.action.SET_DETAILED_LOGGING \
  --ez enabled true \
  -n com.chataggregator.app/.AdbControlReceiver
```

## Disable Detailed Logging
```bash
adb shell am broadcast \
  -a com.chataggregator.app.action.SET_DETAILED_LOGGING \
  --ez enabled false \
  -n com.chataggregator.app/.AdbControlReceiver
```

## Enable/Disable Unstable Features (Attach, etc.)
```bash
adb shell am broadcast \
  -a com.chataggregator.app.action.SET_UNSTABLE_FEATURES \
  --ez enabled true \
  -n com.chataggregator.app/.AdbControlReceiver
```

```bash
adb shell am broadcast \
  -a com.chataggregator.app.action.SET_UNSTABLE_FEATURES \
  --ez enabled false \
  -n com.chataggregator.app/.AdbControlReceiver
```

## Useful logcat filter
```bash
adb logcat | grep -E "MainActivity|ChatFragment|MergeFragment|MergeApiClient|AdbControlReceiver"
```

## Fast APK install (delta patching — much faster than full reinstall)
```bash
adb -s 192.168.0.38:5555 install -r --fastdeploy app\build\outputs\apk\debug\app-debug.apk
```
`--fastdeploy` sends only changed parts of the APK. ~3-5x faster than a full install.
Full workflow (build + fast install):
```bash
.\gradlew assembleDebug && adb -s 192.168.0.38:5555 install -r --fastdeploy app\build\outputs\apk\debug\app-debug.apk
```
