@echo off
setlocal enabledelayedexpansion
title PixelSquad Music Studio — Powered by ACE-Step 1.5

echo ============================================================
echo   PIXELSQUAD MUSIC STUDIO (Powered by ACE-Step 1.5)
echo   Official PixelSquad Enterprise AI Music Creator
echo ============================================================
echo.

cd /d "%~dp0"

REM Check if .venv exists
if not exist ".venv\Scripts\python.exe" (
    echo [Setup] Virtual environment not found. Running uv sync...
    uv sync
)

echo Starting PixelSquad Music Studio on http://127.0.0.1:7865 ...
echo Opening your browser in 2 seconds...

start "" "http://127.0.0.1:7865"

.venv\Scripts\python.exe PixelSquad_Studio\server.py

pause
