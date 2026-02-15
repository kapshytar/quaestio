@echo off
echo ========================================
echo Chat Aggregator - Quick Start
echo ========================================
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo [1/2] Installing dependencies...
    call npm install
    echo.
) else (
    echo [OK] Dependencies already installed
    echo.
)

echo [2/2] Starting Chat Aggregator...
echo.
call npm start
