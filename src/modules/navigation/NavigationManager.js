// Navigation management module
class NavigationManager {
  constructor(config, logger) {
    this.config = config.formFilling;
    this.logger = logger;
  }

  async handleInitialModal(page) {
    this.logger.info('🔍 Checking for initial modal...');
    
    try {
      // Wait a bit for modal to appear
      await this.wait(500);
      
      // Strategy 1: Check if div with id="dynamicModal" exists
      const modal = await page.$('#dynamicModal');
      if (!modal) {
        this.logger.info('No div with id="dynamicModal" found');
        return;
      }

      this.logger.info('Found div with id="dynamicModal", checking for Accept button...');

      // Strategy 2: Look for button type="button" with value containing "Aceptar" within the modal
      const acceptButton = await page.$('#dynamicModal button[type="button"]');
      if (acceptButton) {
        const buttonValue = await page.evaluate(btn => btn.value || btn.textContent.trim(), acceptButton);
        
        if (buttonValue && buttonValue.includes('Aceptar')) {
          this.logger.info(`Found Accept button with value/text: "${buttonValue}"`);
          if (await this.isButtonClickable(page, acceptButton)) {
            await this.clickButton(page, acceptButton);
            return;
          }
        }
      }

      // Strategy 3: Check all buttons within modal for "Aceptar" in value attribute
      const allButtons = await page.$$('#dynamicModal button[type="button"]');
      for (let i = 0; i < allButtons.length; i++) {
        const button = allButtons[i];
        const buttonValue = await page.evaluate(btn => btn.value, button);
        
        if (buttonValue && buttonValue.includes('Aceptar')) {
          this.logger.info(`Found Accept button (${i + 1}) with value containing "Aceptar": "${buttonValue}"`);
          if (await this.isButtonClickable(page, button)) {
            await this.clickButton(page, button);
            return;
          }
        }
      }

      this.logger.info('No Accept button with value containing "Aceptar" found in modal');

    } catch (error) {
      this.logger.error('Error handling initial modal:', error.message);
    }
  }

  async navigateToCasillasElectronicas(page) {
    try {
      this.logger.info('🔍 Looking for Casillas Electrónicas link...');
      await this.wait(2000); // Wait for page to fully load

      // Strategy 1: Find link by deep child search (most specific approach)
      const casillasLink = await this.findCasillasElectronicasLink(page);
      if (casillasLink) {
        this.logger.info('✅ Found Casillas Electrónicas link, clicking...');
        await this.clickButton(page, casillasLink);
        await this.wait(3000); // Wait for navigation
        return true;
      }

      // Strategy 2: Try XPath selectors
      for (const selector of this.config.selectors.casillasElectronicasSelectors) {
        if (selector.startsWith('/') || selector.startsWith('//')) {
          // XPath selector
          try {
            const [element] = await page.$x(selector);
            if (element && await this.isButtonClickable(page, element)) {
              this.logger.info(`Found Casillas Electrónicas link with XPath: ${selector}`);
              await this.clickButton(page, element);
              await this.wait(3000);
              return true;
            }
          } catch (error) {
            continue;
          }
        } else {
          // CSS selector
          const element = await page.$(selector);
          if (element && await this.isButtonClickable(page, element)) {
            this.logger.info(`Found Casillas Electrónicas link with selector: ${selector}`);
            await this.clickButton(page, element);
            await this.wait(3000);
            return true;
          }
        }
      }

      this.logger.error('❌ Could not find Casillas Electrónicas link');
      return false;

    } catch (error) {
      this.logger.error('Error navigating to Casillas Electrónicas:', error.message);
      return false;
    }
  }

  async findCasillasElectronicasLink(page) {
    try {
      // Strategy: Find all links with class "ui-commandlink ui-widget"
      const commandLinks = await page.$$('a.ui-commandlink.ui-widget');
      
      for (let i = 0; i < commandLinks.length; i++) {
        const link = commandLinks[i];
        
        // Check if this link contains the specific span with "Casillas Electrónicas"
        const hasCasillasText = await page.evaluate(linkEl => {
          // Look for span with class "txtredbtn" containing "Casillas Electrónicas"
          const spans = linkEl.querySelectorAll('span.txtredbtn');
          for (const span of spans) {
            if (span.textContent && span.textContent.includes('Casillas Electrónicas')) {
              return true;
            }
          }
          return false;
        }, link);

        if (hasCasillasText) {
          this.logger.info(`Found Casillas Electrónicas link (${i + 1}) with span.txtredbtn text`);
          return link;
        }
      }

      // Fallback: Look for any element containing "Casillas Electrónicas" text
      const allLinks = await page.$$('a');
      for (let i = 0; i < allLinks.length; i++) {
        const link = allLinks[i];
        const linkText = await page.evaluate(el => el.textContent || '', link);
        
        if (linkText.includes('Casillas Electrónicas')) {
          this.logger.info(`Found Casillas Electrónicas link (${i + 1}) by text content`);
          return link;
        }
      }

      return null;
    } catch (error) {
      this.logger.error('Error finding Casillas Electrónicas link:', error.message);
      return null;
    }
  }

  async isButtonClickable(page, button) {
    return await page.evaluate(el => {
      return el.offsetParent !== null && 
             !el.disabled && 
             el.style.visibility !== 'hidden' &&
             el.style.display !== 'none';
    }, button);
  }

  async clickButton(page, button) {
    try {
      // Scroll button into view
      await button.scrollIntoView();
      await this.wait(300);

      // Highlight the button briefly (visual feedback)
      await page.evaluate(el => {
        el.style.border = '3px solid red';
        el.style.backgroundColor = 'yellow';
      }, button);
      
      await this.wait(500);

      // Click the button
      await button.click();
      
      this.logger.info('✅ Successfully clicked submit button');
      
      // Wait for potential navigation or response
      this.logger.info('⏳ Waiting for page response...');
      await this.wait(3000);

      // Check if we're still on the same page or if there are errors
      const currentUrl = page.url();
      this.logger.info(`Current page URL: ${currentUrl}`);
      
    } catch (error) {
      this.logger.error('Error clicking submit button:', error.message);
    }
  }

  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = NavigationManager;