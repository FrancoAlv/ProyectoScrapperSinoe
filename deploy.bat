@echo off
echo ================================================================
echo 🚀 SINOE SAM Deployment
echo ================================================================

REM Check if SAM is installed
sam --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ SAM CLI not installed
    echo Please install: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html
    pause
    exit /b 1
)

echo ✅ SAM CLI available
echo.

echo 🔧 Building SAM application with Docker...
sam build --use-container

if %errorlevel% neq 0 (
    echo ❌ SAM build failed
    pause
    exit /b 1
)

echo ✅ Build successful
echo.

echo 🚀 Deploying to AWS...
sam deploy

if %errorlevel% equ 0 (
    echo.
    echo ================================================================
    echo 🎉 DEPLOYMENT COMPLETED!
    echo ================================================================
    echo.
    echo 📋 Next steps:
    echo 1. Check AWS Lambda console for your function
    echo 2. Test manually: sam local invoke
    echo 3. View logs: sam logs -f SinoeScraperFunction --tail
    echo.
    echo 💰 Estimated cost: $2.80-10.25/month
    echo.
) else (
    echo ❌ Deployment failed
)

pause
