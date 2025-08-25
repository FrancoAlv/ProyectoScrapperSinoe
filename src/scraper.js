// Main scraping logic
const puppeteer = require('puppeteer');
const RobotsChecker = require('./robotsChecker');
const FormFiller = require('./formFiller');

class WebScraper {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.browser = null;
    this.robotsChecker = new RobotsChecker(logger);
    this.formFiller = new FormFiller(config, logger);
  }

  async initialize() {
    this.logger.info('Initializing browser...');
    this.browser = await puppeteer.launch(this.config.browser);
    this.logger.info('Browser initialized successfully');
  }

  async scrapeUrl(url, selector = 'body') {
    this.logger.info(`Starting scrape for: ${url}`);
    
    try {
      // Check robots.txt if enabled
      if (this.config.respectRobotsTxt && !await this.robotsChecker.checkRobotsTxt(this.browser, url)) {
        throw new Error('URL disallowed by robots.txt');
      }

      const page = await this.browser.newPage();
      
      // Set user agent
      await page.setUserAgent(this.config.userAgent);
      
      // Navigate to page
      const response = await page.goto(url, {
        waitUntil: 'networkidle0',
        timeout: this.config.timeout
      });

      if (!response.ok()) {
        throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
      }

      // Fill inputs after page loads
      await this.formFiller.fillInputs(page);

      // Extract data based on selector
      const data = await this.extractData(page, selector);

      // Get page metadata
      const metadata = await this.extractMetadata(page);

      // Keep page open for inspection in debug mode
      if (this.config.logLevel === 'debug') {
        this.logger.info('Debug mode: keeping page open for 30 seconds for inspection...');
        await new Promise(resolve => setTimeout(resolve, 30000));
      }

      const result = {
        url,
        timestamp: new Date().toISOString(),
        metadata,
        data,
        dataCount: data.length,
        status: 'success',
        inputsFound: true
      };

      this.logger.info(`Successfully scraped ${url}`, { dataCount: data.length });
      
      // Close page after delay
      setTimeout(() => {
        page.close().catch(() => {});
      }, 10000);
      
      return result;

    } catch (error) {
      this.logger.error(`Failed to scrape ${url}`, { error: error.message });
      return {
        url,
        timestamp: new Date().toISOString(),
        error: error.message,
        status: 'failed'
      };
    }
  }

  async extractData(page, selector) {
    return await page.evaluate((sel) => {
      const elements = document.querySelectorAll(sel);
      return Array.from(elements).map(el => ({
        text: el.textContent?.trim(),
        html: el.innerHTML,
        tag: el.tagName.toLowerCase(),
        attributes: Array.from(el.attributes).reduce((acc, attr) => {
          acc[attr.name] = attr.value;
          return acc;
        }, {})
      }));
    }, selector);
  }

  async extractMetadata(page) {
    return await page.evaluate(() => {
      const getMetaContent = (name) => {
        const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
        return meta ? meta.getAttribute('content') : null;
      };
      
      return {
        title: document.title,
        description: getMetaContent('description'),
        keywords: getMetaContent('keywords'),
        url: window.location.href
      };
    });
  }

  async close() {
    if (this.browser) {
      this.logger.debug('Closing browser...');
      await this.browser.close();
      this.logger.debug('Browser closed');
    }
  }
}

module.exports = WebScraper;