const EthicalScraper = require('./src/ethicalScraper');

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

// Run the job
async function main() {
  const scraper = new EthicalScraper();
  await scraper.runJob();
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});