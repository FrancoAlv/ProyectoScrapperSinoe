#!/usr/bin/env node

// Lambda-optimized runner for SINOE scraper
const EthicalScraper = require('./src/ethicalScraper');

// Override environment for Lambda mode
process.env.HEADLESS = 'true';
process.env.WHATSAPP_HEADLESS = 'true';
process.env.LOG_LEVEL = 'info';
process.env.DEVTOOLS = 'false';
process.env.SLOW_MO = '0';
process.env.LAMBDA_MODE = 'true';

console.log('🚀 SINOE Lambda Mode - Optimized for AWS Lambda');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Lambda-specific optimizations
const LAMBDA_TIMEOUT = parseInt(process.env.LAMBDA_TIMEOUT || '870000'); // 14.5 minutes default

// Graceful timeout handler for Lambda
let timeoutHandle;
if (process.env.LAMBDA_MODE === 'true') {
    timeoutHandle = setTimeout(async () => {
        console.log('⏰ Lambda timeout approaching - initiating graceful shutdown...');
        if (EthicalScraper.hasInstance()) {
            await EthicalScraper.destroyInstance();
        }
        process.exit(124); // Timeout exit code
    }, LAMBDA_TIMEOUT - 30000); // 30 seconds before Lambda timeout
}

// Handle process termination
const cleanup = async () => {
    if (timeoutHandle) {
        clearTimeout(timeoutHandle);
    }
    
    if (EthicalScraper.hasInstance()) {
        console.log('🧹 Lambda cleanup - destroying scraper instance...');
        await EthicalScraper.destroyInstance();
    }
};

process.on('SIGTERM', async () => {
    console.log('📴 Received SIGTERM in Lambda - cleaning up...');
    await cleanup();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('📴 Received SIGINT in Lambda - cleaning up...');
    await cleanup();
    process.exit(0);
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Promise Rejection in Lambda:', reason);
});

// Run the job with Lambda optimizations
async function main() {
    const startTime = Date.now();
    
    try {
        console.log(`⏱️ Lambda execution timeout set to: ${Math.round(LAMBDA_TIMEOUT/1000)}s`);
        
        const scraper = EthicalScraper.getInstance();
        await scraper.runJob();
        
        const duration = Date.now() - startTime;
        console.log(`✅ Lambda execution completed successfully in ${duration}ms`);
        
        // Clear timeout since we finished successfully
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
        
        return {
            success: true,
            duration,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('❌ Lambda execution failed:', error.message);
        
        // Clear timeout
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
        
        // Try to send error notification
        try {
            const scraper = EthicalScraper.getInstance();
            await scraper.sendErrorNotification(error);
        } catch (notificationError) {
            console.error('Failed to send error notification:', notificationError.message);
        }
        
        throw error;
    } finally {
        await cleanup();
    }
}

// Export for Lambda handler, but also support direct execution
if (require.main === module) {
    // Direct execution (for testing)
    main()
        .then(result => {
            console.log('Direct execution result:', result);
            process.exit(0);
        })
        .catch(error => {
            console.error('Direct execution error:', error);
            process.exit(1);
        });
} else {
    // Module export for Lambda handler
    module.exports = { main };
}