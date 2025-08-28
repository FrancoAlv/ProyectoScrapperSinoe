# SINOE Web Scraper - Deployment Guide

🚀 Complete infrastructure deployment for SINOE web scraper with WhatsApp notifications, DynamoDB storage, and email fallbacks.

## 🏗️ Architecture Overview

This deployment creates:
- **ECS Fargate Task**: Headless web scraper running on schedule
- **DynamoDB Table**: `DocumentosSinoe` for persistent data storage
- **S3 Bucket**: WhatsApp session storage and backup
- **Secrets Manager**: Secure credential storage
- **CloudWatch**: Comprehensive logging and monitoring
- **EventBridge**: Automated scheduling
- **ECR Repository**: Docker image storage

## 📋 Prerequisites

1. **AWS CLI** installed and configured
   ```bash
   aws configure
   ```

2. **Docker** installed and running
   ```bash
   docker --version
   ```

3. **Required Credentials**:
   - SINOE login credentials
   - OpenAI API key for CAPTCHA solving
   - AWS account with appropriate permissions

## 🔧 Environment Variables

### Required
```bash
export SINOE_USERNAME="your-sinoe-username"
export SINOE_PASSWORD="your-sinoe-password"
export OPENAI_API_KEY="sk-your-openai-api-key"
```

### Optional (with defaults)
```bash
export WHATSAPP_PHONE="51913052298"              # WhatsApp notification phone
export EMAIL_ADDRESS="franco.caralv@gmail.com"   # Email fallback address
export PROJECT_NAME="sinoe-scraper"              # AWS resources prefix
export AWS_REGION="us-east-1"                    # AWS region
export SCHEDULE_EXPRESSION="rate(3 hours)"       # Execution schedule
```

### Network Configuration (auto-detected if not set)
```bash
export VPC_ID="vpc-xxxxxxxxx"                    # VPC for ECS tasks
export SUBNET_IDS="subnet-xxx,subnet-yyy"        # Subnets for ECS tasks
```

## 🚀 Deployment Steps

1. **Set required environment variables**:
   ```bash
   export SINOE_USERNAME="your-username"
   export SINOE_PASSWORD="your-password"
   export OPENAI_API_KEY="sk-your-api-key"
   ```

2. **Run deployment script**:
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```

3. **Monitor deployment**:
   - Watch CloudFormation stack creation in AWS Console
   - Check ECS cluster and task definition
   - Verify DynamoDB table creation

## 📊 Infrastructure Components

### DynamoDB Table: DocumentosSinoe
- **Partition Key**: `numeroExpediente` (String)
- **Sort Key**: `numeroNotificacion` (String)
- **Billing**: Pay-per-request
- **Features**: Point-in-time recovery, encryption at rest

### S3 Bucket: WhatsApp Sessions
- **Purpose**: Store persistent WhatsApp session data
- **Lifecycle**: 30-day version retention
- **Security**: Private bucket with encryption

### ECS Fargate Task
- **CPU**: 1024 units (1 vCPU)
- **Memory**: 2048 MB (2 GB)
- **Network**: awsvpc mode with public IP
- **Image**: Auto-built from Dockerfile

### Secrets Manager
- **SINOE Credentials**: Username/password
- **OpenAI Credentials**: API key
- **Integration**: Automatically injected into ECS task

## 🔍 Monitoring & Management

### View Real-time Logs
```bash
aws logs tail /ecs/sinoe-scraper --follow --region us-east-1
```

### Run Manual Execution
```bash
aws ecs run-task \
  --cluster sinoe-scraper-cluster \
  --task-definition sinoe-scraper-task \
  --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[subnet-xxx],assignPublicIp=ENABLED}' \
  --region us-east-1
```

### Query DynamoDB Data
```bash
# Scan all notifications
aws dynamodb scan --table-name DocumentosSinoe --region us-east-1

# Query specific expediente
aws dynamodb query \
  --table-name DocumentosSinoe \
  --key-condition-expression 'numeroExpediente = :exp' \
  --expression-attribute-values '{":exp":{"S":"your-expediente-number"}}' \
  --region us-east-1
```

### Manage Schedule
```bash
# Disable automatic execution
aws events disable-rule --name sinoe-scraper-schedule --region us-east-1

# Enable automatic execution
aws events enable-rule --name sinoe-scraper-schedule --region us-east-1
```

## 📱 WhatsApp Integration

### Features
- **Multi-user support**: Configure multiple WhatsApp sessions
- **Session persistence**: Sessions stored in S3
- **QR code delivery**: QR codes sent via email for setup
- **Automatic reconnection**: Handles disconnections gracefully

### Configuration
WhatsApp users are configured via environment variables in the ECS task:
```json
WHATSAPP_USERS='[
  {
    "name": "user1",
    "phone": "51913052298",
    "email": "franco.caralv@gmail.com",
    "receiveNotifications": true
  }
]'
```

## 📧 Email Fallback System

When WhatsApp fails, the system automatically sends notifications via AWS SES:
- **Format**: HTML email with formatted table
- **Content**: Only OPEN notifications
- **Recipient**: Configured email address
- **Sender**: admin@obstelig.com (configurable)

## 🗄️ Data Storage

### DynamoDB Schema
```json
{
  "numeroExpediente": "00187-2025-0-2001-JP-FC-01",
  "numeroNotificacion": "43443-2025",
  "estado": "ABIERTA",
  "sumilla": "ADJ. RES. 5 + ESC.",
  "oficinaJudicial": "1° JUZGADO DE PAZ LETRADO - Sede El CHIPE",
  "fecha": "25/08/2025 16:27:57",
  "fechaExtraccion": "2025-08-26T04:22:57.203Z",
  "ultimaActualizacion": "2025-08-26T04:22:57.203Z",
  "fechaCreacion": "2025-08-26T04:22:57.203Z",
  "fuente": "https://casillas.pj.gob.pe/sinoe/login.xhtml",
  "numero": 1
}
```

## 🛠️ Troubleshooting

### Common Issues

1. **CloudFormation Stack Fails**
   - Check IAM permissions
   - Verify VPC and subnet configuration
   - Ensure unique S3 bucket name

2. **ECS Task Fails to Start**
   - Check secrets in Secrets Manager
   - Verify Docker image in ECR
   - Review CloudWatch logs

3. **WhatsApp Connection Issues**
   - Check S3 bucket permissions
   - Verify email configuration for QR codes
   - Review WhatsApp session logs

4. **DynamoDB Write Errors**
   - Check IAM permissions for DynamoDB
   - Verify table exists and is active
   - Review error logs for specific failures

### Debug Commands
```bash
# Check stack status
aws cloudformation describe-stacks --stack-name sinoe-scraper --region us-east-1

# List ECS tasks
aws ecs list-tasks --cluster sinoe-scraper-cluster --region us-east-1

# Describe task failures
aws ecs describe-tasks --cluster sinoe-scraper-cluster --tasks task-arn --region us-east-1

# Check DynamoDB table
aws dynamodb describe-table --table-name DocumentosSinoe --region us-east-1
```

## 🔄 Updates and Maintenance

### Deploy New Version
```bash
export IMAGE_TAG="v1.1"
./deploy.sh
```

### Update Configuration
Modify environment variables in CloudFormation template and redeploy.

### Backup and Recovery
- DynamoDB: Point-in-time recovery enabled
- S3: Version control and lifecycle policies
- Secrets: Automatic rotation available

## 💰 Cost Optimization

- **ECS Fargate**: Runs only when scheduled (3 hours intervals)
- **DynamoDB**: Pay-per-request billing
- **S3**: Lifecycle policies for old session data
- **CloudWatch**: 30-day log retention

Estimated monthly cost: $20-50 USD (depending on usage)

## 🔐 Security Features

- **IAM Roles**: Least privilege access
- **Secrets Manager**: Encrypted credential storage
- **VPC**: Network isolation
- **Encryption**: At rest and in transit
- **Non-root Container**: Security hardened

## 📈 Performance

- **Execution Time**: 1-2 minutes per run
- **Memory Usage**: 1-1.5 GB peak
- **CPU Usage**: Burst during execution
- **Network**: Minimal bandwidth usage

---

## 🎯 Quick Start Summary

```bash
# 1. Set credentials
export SINOE_USERNAME="your-username"
export SINOE_PASSWORD="your-password"  
export OPENAI_API_KEY="sk-your-key"

# 2. Deploy
./deploy.sh

# 3. Monitor
aws logs tail /ecs/sinoe-scraper --follow
```

🎉 **That's it!** Your SINOE scraper is now running automatically every 3 hours with full notification support and persistent data storage.