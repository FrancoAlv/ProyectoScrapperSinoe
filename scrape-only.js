#!/usr/bin/env node

// Simple scraping script focused only on scraping - no AWS/S3
const EthicalScraper = require('./src/ethicalScraper');

console.log('🕷️  Pure Scraping Mode - No AWS/S3 Dependencies');
console.log('📋 Results will be logged to console only');
console.log('─'.repeat(60));

async function main() {
  const scraper = new EthicalScraper();
  await scraper.runJob();
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down gracefully');
  process.exit(0);
});

main().catch(error => {
  console.error('\n❌ Scraping failed:', error.message);
  if (process.env.LOG_LEVEL === 'debug') {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
});