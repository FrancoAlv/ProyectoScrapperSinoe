@echo off
setlocal enabledelayedexpansion

REM AWS Deployment Script for Ethical Web Scraper Job (Windows)
echo 🚀 Starting deployment of Ethical Web Scraper Job

REM Configuration
if "%AWS_REGION%"=="" set AWS_REGION=us-east-1
if "%STACK_NAME%"=="" set STACK_NAME=ethical-scraper-job-stack
if "%IMAGE_TAG%"=="" set IMAGE_TAG=latest
if "%SCHEDULE_EXPRESSION%"=="" set SCHEDULE_EXPRESSION=rate(3 hours)

echo 📋 Region: %AWS_REGION%
echo 📋 Stack: %STACK_NAME%
echo 📋 Image Tag: %IMAGE_TAG%
echo 📅 Schedule: %SCHEDULE_EXPRESSION%

REM Validate required parameters
if "%TARGET_URLS%"=="" (
    echo ❌ TARGET_URLS environment variable is required
    echo 💡 Example: set TARGET_URLS=https://example.com,https://test.com
    exit /b 1
)

REM Check if AWS CLI is installed
aws --version >nul 2>&1
if errorlevel 1 (
    echo ❌ AWS CLI is not installed. Please install it first.
    exit /b 1
)

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker is not running. Please start Docker first.
    exit /b 1
)

REM Get AWS Account ID
for /f "tokens=*" %%i in ('aws sts get-caller-identity --query Account --output text') do set AWS_ACCOUNT_ID=%%i
echo 📋 AWS Account ID: %AWS_ACCOUNT_ID%

REM Check if stack exists
aws cloudformation describe-stacks --stack-name %STACK_NAME% --region %AWS_REGION% >nul 2>&1
if errorlevel 1 (
    echo 🆕 Stack does not exist. Please create it first with VPC and Subnet parameters.
    echo aws cloudformation create-stack ^
      --stack-name %STACK_NAME% ^
      --template-body file://aws-fargate.yml ^
      --capabilities CAPABILITY_IAM ^
      --region %AWS_REGION% ^
      --parameters ^
        ParameterKey=VpcId,ParameterValue=vpc-xxxxxxxxx ^
        ParameterKey=SubnetIds,ParameterValue="subnet-xxxxxxxxx,subnet-yyyyyyyyy" ^
        ParameterKey=ImageTag,ParameterValue=%IMAGE_TAG%
    exit /b 1
)

REM Get ECR repository URI
for /f "tokens=*" %%i in ('aws cloudformation describe-stacks --stack-name %STACK_NAME% --region %AWS_REGION% --query "Stacks[0].Outputs[?OutputKey==`ECRRepositoryURI`].OutputValue" --output text') do set ECR_URI=%%i
echo ✅ ECR Repository: %ECR_URI%

REM Build Docker image
echo 🐳 Building Docker image...
docker build -t ethical-scraper .

REM Tag image for ECR
docker tag ethical-scraper:latest %ECR_URI%:%IMAGE_TAG%
docker tag ethical-scraper:latest %ECR_URI%:latest

REM Login to ECR
echo 🔐 Logging into ECR...
for /f "tokens=*" %%i in ('aws ecr get-login-password --region %AWS_REGION%') do set ECR_PASSWORD=%%i
echo %ECR_PASSWORD% | docker login --username AWS --password-stdin %ECR_URI%

REM Push image
echo 📤 Pushing image to ECR...
docker push %ECR_URI%:%IMAGE_TAG%
docker push %ECR_URI%:latest

REM Update ECS service
echo 🔄 Updating ECS service...
aws ecs update-service --cluster ethical-scraper-cluster --service ethical-scraper-service --force-new-deployment --region %AWS_REGION%

REM Get Load Balancer URL
for /f "tokens=*" %%i in ('aws cloudformation describe-stacks --stack-name %STACK_NAME% --region %AWS_REGION% --query "Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue" --output text') do set LB_DNS=%%i

echo 🎉 Deployment completed successfully!
echo 🌐 Service URL: http://%LB_DNS%
echo 💡 Health Check: http://%LB_DNS%/health
echo 🔍 Scrape Endpoint: POST http://%LB_DNS%/scrape

echo 📋 Example usage:
echo curl -X POST http://%LB_DNS%/scrape ^
  -H "Content-Type: application/json" ^
  -d "{\"url\": \"https://example.com\", \"selector\": \"h1\"}"

pause