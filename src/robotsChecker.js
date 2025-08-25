// Robots.txt checker module
class RobotsChecker {
  constructor(logger) {
    this.logger = logger;
  }

  async checkRobotsTxt(browser, url) {
    try {
      const domain = new URL(url).origin;
      const robotsUrl = `${domain}/robots.txt`;
      
      this.logger.debug(`Checking robots.txt: ${robotsUrl}`);
      
      const page = await browser.newPage();
      const response = await page.goto(robotsUrl, { 
        waitUntil: 'networkidle0',
        timeout: 10000
      });
      
      if (response.status() === 200) {
        const robotsContent = await page.content();
        await page.close();
        
        // Basic robots.txt parsing for User-agent: *
        const disallowPatterns = robotsContent.match(/Disallow:\s*([^\r\n]+)/gi);
        if (disallowPatterns) {
          const urlPath = new URL(url).pathname;
          for (const pattern of disallowPatterns) {
            const disallowPath = pattern.replace(/Disallow:\s*/i, '').trim();
            if (disallowPath && urlPath.startsWith(disallowPath)) {
              this.logger.info(`URL blocked by robots.txt: ${url}`);
              return false;
            }
          }
        }
      }
      
      await page.close();
      return true;
    } catch (error) {
      this.logger.debug(`Could not check robots.txt for ${url}:`, error.message);
      return true; // Allow if robots.txt cannot be checked
    }
  }
}

module.exports = RobotsChecker;