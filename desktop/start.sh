#!/bin/bash

unset ELECTRON_RUN_AS_NODE
NPM_CACHE_DIR="${TMPDIR:-/tmp}/verity-npm-cache"

echo "========================================"
echo "Quaestio - Quick Start"
echo "========================================"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "[1/2] Installing dependencies..."
    npm install --cache "$NPM_CACHE_DIR"
    echo ""
else
    echo "[OK] Dependencies already installed"
    echo ""
fi

echo "[2/2] Starting Quaestio..."
echo ""
env -u ELECTRON_RUN_AS_NODE npm start
