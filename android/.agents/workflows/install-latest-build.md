---
description: Install the latest CI build from GitHub
---
This workflow downloads and installs the latest successful CI build to the connected Android device using our custom script. 
This prevents the AI from taking excessive manual steps when fetching and unzipping CI artifacts.

// turbo-all
1. Run `.\install-latest-ci.ps1` from the project root `c:\chat-aggregator-android`. By default it targets 192.168.0.101.
