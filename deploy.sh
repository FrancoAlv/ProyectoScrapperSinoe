#!/bin/bash

# AWS Deployment Script for Ethical Web Scraper Job
set -e

# Configuration
REGION=${AWS_REGION:-us-east-1}
STACK_NAME=${STACK_NAME:-ethical-scraper-job-stack}
IMAGE_TAG=${IMAGE_TAG:-latest}
SCHEDULE=${SCHEDULE_EXPRESSION:-"rate(3 hours)"}
TARGET_URLS=${TARGET_URLS:-""}
S3_BUCKET=${S3_BUCKET_NAME:-""}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting deployment of Ethical Web Scraper Job${NC}"
echo -e "${YELLOW}📅 Schedule: ${SCHEDULE}${NC}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Get AWS Account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo -e "${YELLOW}📋 AWS Account ID: ${AWS_ACCOUNT_ID}${NC}"

# Validate required parameters
if [ -z "$TARGET_URLS" ]; then
    echo -e "${RED}❌ TARGET_URLS environment variable is required${NC}"
    echo -e "${YELLOW}💡 Example: export TARGET_URLS=\"https://example.com,https://test.com\"${NC}"
    exit 1
fi

# Step 1: Create or update CloudFormation stack
echo -e "${YELLOW}🏗️ Deploying CloudFormation stack...${NC}"

# Build parameters array
PARAMETERS="ParameterKey=ImageTag,ParameterValue=$IMAGE_TAG"
PARAMETERS="$PARAMETERS ParameterKey=ScheduleExpression,ParameterValue=\"$SCHEDULE\""
PARAMETERS="$PARAMETERS ParameterKey=TargetUrls,ParameterValue=\"$TARGET_URLS\""

if [ ! -z "$S3_BUCKET" ]; then
    PARAMETERS="$PARAMETERS ParameterKey=S3BucketName,ParameterValue=$S3_BUCKET"
fi

# Check if stack exists
if aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION &> /dev/null; then
    echo -e "${YELLOW}📦 Updating existing stack: ${STACK_NAME}${NC}"
    aws cloudformation update-stack \
        --stack-name $STACK_NAME \
        --template-body file://aws-fargate.yml \
        --capabilities CAPABILITY_IAM \
        --region $REGION \
        --parameters $PARAMETERS || {
            echo -e "${YELLOW}ℹ️ No changes to deploy${NC}"
        }
else
    echo -e "${YELLOW}🆕 Creating new stack: ${STACK_NAME}${NC}"
    echo -e "${RED}⚠️ You need to provide VpcId and SubnetIds parameters${NC}"
    echo "Please run with VPC parameters:"
    echo "aws cloudformation create-stack \\"
    echo "  --stack-name $STACK_NAME \\"
    echo "  --template-body file://aws-fargate.yml \\"
    echo "  --capabilities CAPABILITY_IAM \\"
    echo "  --region $REGION \\"
    echo "  --parameters \\"
    echo "    ParameterKey=VpcId,ParameterValue=vpc-xxxxxxxxx \\"
    echo "    ParameterKey=SubnetIds,ParameterValue=\"subnet-xxxxxxxxx,subnet-yyyyyyyyy\" \\"
    echo "    $PARAMETERS"
    exit 1
fi

# Wait for stack to complete
echo -e "${YELLOW}⏳ Waiting for stack operation to complete...${NC}"
aws cloudformation wait stack-update-complete --stack-name $STACK_NAME --region $REGION 2>/dev/null || \
aws cloudformation wait stack-create-complete --stack-name $STACK_NAME --region $REGION 2>/dev/null

# Get ECR repository URI
ECR_URI=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`ECRRepositoryURI`].OutputValue' \
    --output text)

echo -e "${GREEN}✅ ECR Repository: ${ECR_URI}${NC}"

# Step 2: Build and push Docker image
echo -e "${YELLOW}🐳 Building Docker image...${NC}"
docker build -t ethical-scraper .

# Tag image for ECR
docker tag ethical-scraper:latest $ECR_URI:$IMAGE_TAG
docker tag ethical-scraper:latest $ECR_URI:latest

# Login to ECR
echo -e "${YELLOW}🔐 Logging into ECR...${NC}"
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_URI

# Push image
echo -e "${YELLOW}📤 Pushing image to ECR...${NC}"
docker push $ECR_URI:$IMAGE_TAG
docker push $ECR_URI:latest

# Step 3: Get deployment information
echo -e "${YELLOW}📋 Getting deployment information...${NC}"

CLUSTER_NAME=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`ClusterName`].OutputValue' \
    --output text 2>/dev/null || echo "N/A")

SCHEDULE_RULE=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`ScheduleRuleName`].OutputValue' \
    --output text 2>/dev/null || echo "N/A")

LOG_GROUP=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`LogGroupName`].OutputValue' \
    --output text 2>/dev/null || echo "N/A")

S3_BUCKET_OUTPUT=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`S3BucketName`].OutputValue' \
    --output text 2>/dev/null || echo "")

echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo -e "${GREEN}⏰ Scheduled Job: ${SCHEDULE}${NC}"
echo -e "${GREEN}🎯 Target URLs: ${TARGET_URLS}${NC}"
echo -e "${GREEN}🗂️ Cluster: ${CLUSTER_NAME}${NC}"
echo -e "${GREEN}📝 Logs: ${LOG_GROUP}${NC}"

if [ ! -z "$S3_BUCKET_OUTPUT" ]; then
    echo -e "${GREEN}🪣 Results Bucket: ${S3_BUCKET_OUTPUT}${NC}"
fi

echo -e "${YELLOW}📋 Management commands:${NC}"
echo "# View logs:"
echo "aws logs tail ${LOG_GROUP} --follow --region ${REGION}"
echo ""
echo "# Run job manually:"
echo "aws ecs run-task \\"
echo "  --cluster ${CLUSTER_NAME} \\"
echo "  --task-definition \$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs[?OutputKey==\`TaskDefinitionArn\`].OutputValue' --output text) \\"
echo "  --launch-type FARGATE \\"
echo "  --network-configuration 'awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx]}' \\"
echo "  --region ${REGION}"
echo ""
echo "# Disable/Enable schedule:"
echo "aws events disable-rule --name ${SCHEDULE_RULE} --region ${REGION}"
echo "aws events enable-rule --name ${SCHEDULE_RULE} --region ${REGION}"