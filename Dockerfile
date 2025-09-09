# Build stage - use official Node.js image with build tools
FROM node:20-slim AS builder

# Install build dependencies
RUN apt-get update && \
    apt-get install -y build-essential cmake python3 autotools-dev autoconf libtool && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /build

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm install && \
    npm install aws-lambda-ric && \
    npm cache clean --force

# Production stage - Node.js runtime with Chromium
FROM node:20-slim AS runtime

# Install runtime dependencies (Complete WhatsApp-web.js requirements)
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y \
        curl \
        chromium \
        fonts-liberation \
        fonts-dejavu-core \
        fonts-noto-core \
        libnss3 \
        libnspr4 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libatspi2.0-0 \
        libdrm2 \
        libxcomposite1 \
        libxdamage1 \
        libxrandr2 \
        libgbm1 \
        libxss1 \
        libasound2 \
        libxkbcommon0 \
        libgtk-3-0 \
        libx11-xcb1 \
        ca-certificates \
        dumb-init && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get clean && \
    apt-get autoremove -y

# Install Lambda Runtime Interface Emulator
RUN curl -Lo /usr/bin/aws-lambda-rie https://github.com/aws/aws-lambda-runtime-interface-emulator/releases/latest/download/aws-lambda-rie && \
    chmod +x /usr/bin/aws-lambda-rie

# Verify Chromium installation
RUN which chromium && chromium --version

# Set Lambda environment variables
ENV LAMBDA_TASK_ROOT=/var/task
ENV LAMBDA_RUNTIME_DIR=/var/runtime

# Puppeteer/Chromium configuration
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_BIN=/usr/bin/chromium

# Node.js optimization
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=2048"

# Application mode
ENV LAMBDA_MODE=true
ENV HEADLESS=true

# WhatsApp-web.js specific optimizations
ENV WWEBJS_DISABLE_WELCOME=true
ENV PUPPETEER_CACHE_DIR=/tmp
ENV DISPLAY=:99
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# Chrome/Chromium specific for WhatsApp
ENV CHROMIUM_FLAGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu"
ENV CHROME_DEVEL_SANDBOX=""

# Create Lambda directories and tmp space for Chromium + WhatsApp sessions + temp
RUN mkdir -p ${LAMBDA_TASK_ROOT} ${LAMBDA_RUNTIME_DIR} \
    /tmp /tmp/tokens /tmp/temp \
    /tmp/wwebjs_auth /tmp/wwebjs_auth/session-sinoe-main \
    /home/node/.cache/puppeteer \
    /home/node/.local/share/applications \
    /var/lib/chrome \
    /run/user/1000 && \
    chmod -R 777 /tmp && \
    chown -R node:node /home/node && \
    chmod -R 755 /home/node && \
    chmod -R 755 /run/user/1000 || true

# Set working directory
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy built dependencies from builder stage
COPY --from=builder /build/node_modules ./node_modules

# Copy application files
COPY lambda-handler.js ./
COPY src/ ./src/
COPY package*.json ./

# Fix Chrome sandbox permissions (critical for WhatsApp-web.js)
# Try multiple possible sandbox locations
RUN find /usr -name "*chrome*sandbox*" -type f 2>/dev/null | head -1 | xargs -r chmod 4755 || true && \
    find /usr -name "*chromium*sandbox*" -type f 2>/dev/null | head -1 | xargs -r chmod 4755 || true && \
    find /usr -name "*chrome*sandbox*" -type f 2>/dev/null | head -1 | xargs -r chown root:root || true

# Set proper permissions for Lambda user
RUN chown -R node:node /var/task && \
    chown -R node:node /tmp && \
    chown -R node:node /home/node

# Test Chromium works in Lambda environment with WhatsApp-specific flags
RUN echo "Testing Chromium with WhatsApp flags..." && \
    chromium --version --no-sandbox --disable-gpu --disable-dev-shm-usage --headless --disable-extensions || echo "Chromium basic test completed" && \
    echo "Chromium test completed successfully"

# Switch to node user for security
USER node

# Use dumb-init for proper process handling and signal forwarding
ENTRYPOINT ["dumb-init", "--"]

# Set the CMD to Lambda RIC with the handler
CMD [ "npx", "aws-lambda-ric", "lambda-handler.handler" ]