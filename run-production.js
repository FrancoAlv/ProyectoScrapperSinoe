#!/usr/bin/env node

// Production runner - Headless mode with persistent WhatsApp sessions
const EthicalScraper = require('./src/ethicalScraper');

// Override environment for production mode
process.env.HEADLESS = 'true';
process.env.WHATSAPP_HEADLESS = 'true';
process.env.LOG_LEVEL = 'info';
process.env.DEVTOOLS = 'false';
process.env.SLOW_MO = '0';

console.log('🚀 SINOE Production Mode - Headless with Persistent Sessions');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📴 Received SIGTERM, shutting down gracefully...');
  if (EthicalScraper.hasInstance()) {
    await EthicalScraper.destroyInstance();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('📴 Received SIGINT, shutting down gracefully...');
  if (EthicalScraper.hasInstance()) {
    await EthicalScraper.destroyInstance();
  }
  process.exit(0);
});

// Run the job
async function main() {
  try {
    const scraper = EthicalScraper.getInstance();
    await scraper.runJob();
    console.log('✅ Production job completed successfully');
    
    // Perform cleanup and destroy singleton
    await EthicalScraper.destroyInstance();
    console.log('🏁 Application shutdown complete');
    
    // Force exit to ensure all handles are closed
    process.exit(0);
  } catch (error) {
    console.error('❌ Production job failed:', error.message);
    
    // Cleanup on error too
    if (EthicalScraper.hasInstance()) {
      await EthicalScraper.destroyInstance();
    }
    
    process.exit(1);
  }
}

main();