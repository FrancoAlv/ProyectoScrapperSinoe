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

# Install runtime dependencies (Chromium and Puppeteer deps)
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y \
        curl \
        chromium \
        fonts-liberation \
        fonts-dejavu-core \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libatspi2.0-0 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxcomposite1 \
        libxcursor1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxi6 \
        libxrandr2 \
        libxrender1 \
        libxss1 \
        libxtst6 \
        ca-certificates \
        xvfb && \
    rm -rf /var/lib/apt/lists/*

# Install Lambda Runtime Interface Emulator
RUN curl -Lo /usr/bin/aws-lambda-rie https://github.com/aws/aws-lambda-runtime-interface-emulator/releases/latest/download/aws-lambda-rie && \
    chmod +x /usr/bin/aws-lambda-rie

# Verify Chromium installation
RUN which chromium && chromium --version

# Set Lambda environment variables
ENV LAMBDA_TASK_ROOT=/var/task
ENV LAMBDA_RUNTIME_DIR=/var/runtime
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV LAMBDA_MODE=true
ENV HEADLESS=true
ENV CHROME_BIN=/usr/bin/chromium

# Create Lambda directories and tmp space for Chromium + WhatsApp tokens + temp
RUN mkdir -p ${LAMBDA_TASK_ROOT} ${LAMBDA_RUNTIME_DIR} /tmp /tmp/tokens /tmp/temp && \
    chmod 777 /tmp /tmp/tokens /tmp/temp

# Set working directory
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy built dependencies from builder stage
COPY --from=builder /build/node_modules ./node_modules

# Copy application files
COPY lambda-handler.js ./
COPY src/ ./src/
COPY package*.json ./

# Set the CMD to Lambda RIC with the handler (no Xvfb needed for headless screenshots)
CMD [ "npx", "aws-lambda-ric", "lambda-handler.handler" ]