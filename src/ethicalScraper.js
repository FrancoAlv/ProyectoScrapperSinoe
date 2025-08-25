// Main ethical scraper class
const Config = require('./config');
const Logger = require('./logger');
const WebScraper = require('./scraper');
const ResultSaver = require('./resultSaver');

class EthicalScraper {
  constructor() {
    this.config = Config.get();
    this.logger = new Logger(this.config.logLevel);
    this.scraper = new WebScraper(this.config, this.logger);
    this.resultSaver = new ResultSaver(this.config, this.logger);
    this.results = [];
  }

  async runJob() {
    const startTime = Date.now();
    this.logger.info('Starting scheduled scraping job', {
      targetUrls: this.config.targetUrls.length,
      config: this.config
    });

    if (this.config.targetUrls.length === 0) {
      this.logger.error('No target URLs configured. Set TARGET_URLS environment variable.');
      return;
    }

    try {
      await this.scraper.initialize();

      // Process each URL with delay between requests
      for (let i = 0; i < this.config.targetUrls.length; i++) {
        const url = this.config.targetUrls[i].trim();
        
        if (!url) continue;

        // Add delay between requests (except for the first one)
        if (i > 0) {
          this.logger.debug(`Waiting ${this.config.delayBetweenRequests}ms before next request...`);
          await new Promise(resolve => setTimeout(resolve, this.config.delayBetweenRequests));
        }

        const result = await this.scraper.scrapeUrl(url);
        this.results.push(result);
      }

      await this.resultSaver.saveResults(this.results);
      
      const duration = Date.now() - startTime;
      this.logger.info('Scraping job completed successfully', { 
        duration: `${duration}ms`,
        totalResults: this.results.length
      });

    } catch (error) {
      this.logger.error('Scraping job failed', { error: error.message });
      process.exit(1);
    } finally {
      await this.scraper.close();
    }
  }
}

module.exports = EthicalScraper;