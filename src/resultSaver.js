// Results saving module
class ResultSaver {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async saveResults(results) {
    // S3 disabled - only log results to console
    this.logResults(results);
    
    // Optional: Save to S3 if configured (currently disabled)
    if (this.config.outputBucket && results.length > 0) {
      this.logger.debug('S3 saving is disabled - results only logged to console');
      // await this.saveToS3(results);
    }
  }

  async saveToS3(results) {
    try {
      const AWS = require('aws-sdk');
      const s3 = new AWS.S3();
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `scraping-results-${timestamp}.json`;
      
      await s3.putObject({
        Bucket: this.config.outputBucket,
        Key: `results/${filename}`,
        Body: JSON.stringify({
          jobTimestamp: new Date().toISOString(),
          totalResults: results.length,
          results: results
        }, null, 2),
        ContentType: 'application/json'
      }).promise();
      
      this.logger.info(`Results saved to S3: ${filename}`);
    } catch (error) {
      this.logger.error('Failed to save results to S3', { error: error.message });
    }
  }

  logResults(results) {
    this.logger.info('Job completed', {
      totalUrls: this.config.targetUrls.length,
      successfulScrapes: results.filter(r => r.status === 'success').length,
      failedScrapes: results.filter(r => r.status === 'failed').length,
      results: results
    });
  }
}

module.exports = ResultSaver;