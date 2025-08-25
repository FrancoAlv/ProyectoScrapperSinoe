@echo off
setlocal enabledelayedexpansion

echo 🧪 Testing Ethical Scraper Locally

REM Default test URLs (safe for testing)
set DEFAULT_URLS=https://quotes.toscrape.com/,https://httpbin.org/html,https://example.com

REM Configuration
if "%TARGET_URLS%"=="" set TARGET_URLS=%DEFAULT_URLS%
if "%LOG_LEVEL%"=="" set LOG_LEVEL=info
if "%DELAY_MS%"=="" set DELAY_MS=1000

echo 📋 Test Configuration:
echo URLs: %TARGET_URLS%
echo Log Level: %LOG_LEVEL%
echo Delay: %DELAY_MS%ms
echo.

REM Method selection
echo Choose testing method:
echo 1^) Node.js directly ^(fastest^)
echo 2^) Docker container ^(simulates Fargate^)
echo 3^) Both methods
set /p choice="Enter choice (1-3): "

if "%choice%"=="1" goto nodejs
if "%choice%"=="2" goto docker
if "%choice%"=="3" goto both
echo Invalid choice
exit /b 1

:nodejs
echo 🚀 Testing with Node.js...

REM Check if dependencies are installed
if not exist "node_modules" (
    echo 📦 Installing dependencies...
    npm install
)

REM Run with environment variables
set TARGET_URLS=%TARGET_URLS%
set LOG_LEVEL=%LOG_LEVEL%
set DELAY_MS=%DELAY_MS%
set TIMEOUT_MS=10000
node index.js

echo ✅ Node.js test completed
echo.

if "%choice%"=="1" goto end
if "%choice%"=="3" goto docker
goto end

:both
call :nodejs
goto docker

:docker
echo 🐳 Testing with Docker...

REM Check if image exists
docker images | findstr "ethical-scraper-local" >nul
if errorlevel 1 (
    echo 🔨 Building Docker image...
    docker build -t ethical-scraper-local .
)

REM Run container
docker run --rm ^
    -e TARGET_URLS="%TARGET_URLS%" ^
    -e LOG_LEVEL="%LOG_LEVEL%" ^
    -e DELAY_MS="%DELAY_MS%" ^
    -e TIMEOUT_MS="10000" ^
    ethical-scraper-local

echo ✅ Docker test completed

:end
echo.
echo 🎉 Local testing completed successfully!
echo 💡 Tips:
echo - Use LOG_LEVEL=debug for detailed logs
echo - Test with your actual target URLs before deployment
echo - Check that robots.txt is respected in the logs
echo - Verify delays between requests are working

pause