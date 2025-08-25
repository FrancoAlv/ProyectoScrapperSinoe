// Session management module
class SessionManager {
  constructor(config, logger) {
    this.config = config.formFilling;
    this.logger = logger;
  }

  async handleActiveSession(page) {
    try {
      this.logger.info('🔍 Looking for FINALIZAR SESIONES button...');

      // Strategy 1: Look for button with "FINALIZAR SESIONES" value
      const buttons = await page.$$('button');
      for (const button of buttons) {
        const buttonValue = await page.evaluate(btn => btn.value || '', button);
        if (buttonValue.includes('FINALIZAR SESIONES')) {
          this.logger.info(`Found FINALIZAR SESIONES button with value: "${buttonValue}"`);
          if (await this.isButtonClickable(page, button)) {
            await this.clickButton(page, button);
            await this.wait(5000); // Wait for logout process
            this.logger.info('✅ FINALIZAR SESIONES button clicked successfully');
            return true;
          }
        }
      }

      // Strategy 2: Look for button containing FINALIZAR SESIONES text in children
      const allButtons = await page.$$('button, input[type="submit"], input[type="button"]');
      for (const button of allButtons) {
        const hasFinalizarText = await page.evaluate(btn => {
          const text = btn.textContent || btn.value || '';
          return text.includes('FINALIZAR SESIONES');
        }, button);

        if (hasFinalizarText) {
          this.logger.info('Found button with FINALIZAR SESIONES text');
          if (await this.isButtonClickable(page, button)) {
            await this.clickButton(page, button);
            await this.wait(5000); // Wait for logout process
            this.logger.info('✅ FINALIZAR SESIONES button (text method) clicked successfully');
            return true;
          }
        }
      }

      // Strategy 3: Use XPath selectors
      for (const selector of this.config.selectors.logoutButtonSelectors) {
        if (selector.startsWith('/') || selector.startsWith('//')) {
          // XPath selector
          try {
            const [element] = await page.$x(selector);
            if (element && await this.isButtonClickable(page, element)) {
              this.logger.info(`Found FINALIZAR SESIONES button with XPath: ${selector}`);
              await this.clickButton(page, element);
              await this.wait(5000); // Wait for logout process
              this.logger.info('✅ FINALIZAR SESIONES button (XPath method) clicked successfully');
              return true;
            }
          } catch (error) {
            continue;
          }
        } else {
          // CSS selector
          const button = await page.$(selector);
          if (button && await this.isButtonClickable(page, button)) {
            this.logger.info(`Found FINALIZAR SESIONES button with selector: ${selector}`);
            await this.clickButton(page, button);
            await this.wait(5000); // Wait for logout process
            this.logger.info('✅ FINALIZAR SESIONES button (CSS method) clicked successfully');
            return true;
          }
        }
      }

      this.logger.error('❌ Could not find FINALIZAR SESIONES button');
      return false;

    } catch (error) {
      this.logger.error('Error handling active session:', error.message);
      return false;
    }
  }

  async performFinalLogout(page) {
    try {
      this.logger.info('🚪 Performing final logout...');
      await this.wait(2000);
      
      // Find logout link
      for (const selector of this.config.selectors.finalLogoutSelectors) {
        if (selector.startsWith('/') || selector.startsWith('//')) {
          // XPath selector
          try {
            const [element] = await page.$x(selector);
            if (element && await this.isButtonClickable(page, element)) {
              this.logger.info(`Found logout link with XPath: ${selector}`);
              await this.clickButton(page, element);
              await this.wait(3000);
              this.logger.info('✅ Final logout completed');
              return true;
            }
          } catch (error) {
            continue;
          }
        } else {
          // CSS selector - handle escaped colons
          try {
            const element = await page.$(selector);
            if (element && await this.isButtonClickable(page, element)) {
              this.logger.info(`Found logout link with selector: ${selector}`);
              await this.clickButton(page, element);
              await this.wait(3000);
              this.logger.info('✅ Final logout completed');
              return true;
            }
          } catch (error) {
            // Try alternative approach for ID with colon
            if (selector.includes('frmMenu') && selector.includes('clCerrarSession')) {
              const altElement = await page.$('#frmMenu\\\\:clCerrarSession');
              if (altElement && await this.isButtonClickable(page, altElement)) {
                this.logger.info('Found logout link with alternative selector');
                await this.clickButton(page, altElement);
                await this.wait(3000);
                this.logger.info('✅ Final logout completed');
                return true;
              }
            }
          }
        }
      }
      
      // Fallback: look for any link with "CERRAR" text
      const logoutLinks = await page.$$('a');
      for (const link of logoutLinks) {
        const linkText = await page.evaluate(el => el.textContent?.trim().toUpperCase() || '', link);
        if (linkText.includes('CERRAR') && linkText.includes('SESION')) {
          this.logger.info('Found logout link by text content');
          await this.clickButton(page, link);
          await this.wait(3000);
          this.logger.info('✅ Final logout completed');
          return true;
        }
      }
      
      this.logger.error('❌ Could not find logout link');
      return false;
      
    } catch (error) {
      this.logger.error('Error performing final logout:', error.message);
      return false;
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

module.exports = SessionManager;