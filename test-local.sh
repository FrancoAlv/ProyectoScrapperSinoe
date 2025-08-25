#!/bin/bash

# Script para probar el scraper localmente
set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}🧪 Testing Ethical Scraper Locally${NC}"

# Default test URLs (safe for testing)
DEFAULT_URLS="https://quotes.toscrape.com/,https://httpbin.org/html,https://example.com"

# Configuration
TEST_URLS=${TARGET_URLS:-$DEFAULT_URLS}
TEST_LOG_LEVEL=${LOG_LEVEL:-"info"}
TEST_DELAY=${DELAY_MS:-"1000"}

echo -e "${YELLOW}📋 Test Configuration:${NC}"
echo "URLs: $TEST_URLS"
echo "Log Level: $TEST_LOG_LEVEL"
echo "Delay: ${TEST_DELAY}ms"
echo ""

# Method selection
echo -e "${YELLOW}Choose testing method:${NC}"
echo "1) Node.js directly (fastest)"
echo "2) Docker container (simulates Fargate)"
echo "3) Both methods"
read -p "Enter choice (1-3): " choice

case $choice in
    1|3)
        echo -e "${GREEN}🚀 Testing with Node.js...${NC}"
        
        # Check if dependencies are installed
        if [ ! -d "node_modules" ]; then
            echo -e "${YELLOW}📦 Installing dependencies...${NC}"
            npm install
        fi
        
        # Run with environment variables
        TARGET_URLS="$TEST_URLS" \
        LOG_LEVEL="$TEST_LOG_LEVEL" \
        DELAY_MS="$TEST_DELAY" \
        TIMEOUT_MS="10000" \
        node index.js
        
        echo -e "${GREEN}✅ Node.js test completed${NC}"
        echo ""
        
        if [ "$choice" != "3" ]; then
            exit 0
        fi
        ;;
esac

case $choice in
    2|3)
        echo -e "${GREEN}🐳 Testing with Docker...${NC}"
        
        # Build image if it doesn't exist
        if ! docker images | grep -q "ethical-scraper-local"; then
            echo -e "${YELLOW}🔨 Building Docker image...${NC}"
            docker build -t ethical-scraper-local .
        fi
        
        # Run container
        docker run --rm \
            -e TARGET_URLS="$TEST_URLS" \
            -e LOG_LEVEL="$TEST_LOG_LEVEL" \
            -e DELAY_MS="$TEST_DELAY" \
            -e TIMEOUT_MS="10000" \
            ethical-scraper-local
        
        echo -e "${GREEN}✅ Docker test completed${NC}"
        ;;
esac

echo ""
echo -e "${GREEN}🎉 Local testing completed successfully!${NC}"
echo -e "${YELLOW}💡 Tips:${NC}"
echo "- Use LOG_LEVEL=debug for detailed logs"
echo "- Test with your actual target URLs before deployment"
echo "- Check that robots.txt is respected in the logs"
echo "- Verify delays between requests are working"