#!/bin/bash

echo "========================================"
echo "Chat Aggregator - Quick Start"
echo "========================================"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "[1/2] Installing dependencies..."
    npm install
    echo ""
else
    echo "[OK] Dependencies already installed"
    echo ""
fi

echo "[2/2] Starting Chat Aggregator..."
echo ""
npm start
