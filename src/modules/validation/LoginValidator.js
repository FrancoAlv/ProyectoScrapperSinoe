// Login validation module
class LoginValidator {
  constructor(config, logger) {
    this.config = config.formFilling;
    this.logger = logger;
  }

  async checkLoginResult(page) {
    try {
      // Case 0: Check for SSO validation page and redirect to login
      const currentUrl = page.url();
      if (currentUrl.includes('sso-validar.xhtml')) {
        this.logger.info('🔍 Detected SSO validation page, redirecting to login...');
        await this.redirectToLogin(page);
        return 'SSO_REDIRECT';
      }

      // Case 1: Check for successful login FIRST (specific SINOE logo image)
      const loginSuccess = await this.validateSuccessfulLogin(page);
      if (loginSuccess) {
        this.logger.info('🔍 Detected successful login - found SINOE logo');
        return 'SUCCESS';
      }

      // Case 2: Check for active session message
      const activeSessionFound = await this.checkActiveSessionMessage(page);
      if (activeSessionFound) {
        this.logger.info('🔍 Detected active session message');
        return 'ACTIVE_SESSION';
      }

      // Case 3: Check for login errors (captcha or credentials)
      const errorResult = await this.checkLoginErrors(page);
      if (errorResult) {
        return errorResult;
      }

      // Case 4: Fallback - Check for other successful login elements
      const successSelectors = [
        '[class*="dashboard"]',
        '[class*="home"]',
        '[class*="welcome"]',
        'a[href*="logout"]',
        'button[onclick*="logout"]',
        '.main-content',
        '#main-panel'
      ];

      for (const selector of successSelectors) {
        const element = await page.$(selector);
        if (element) {
          this.logger.info('🔍 Detected successful login elements (fallback)');
          return 'SUCCESS';
        }
      }

      // Case 5: Default to login error if no success indicators found
      this.logger.info('🔍 No success indicators found, assuming login error');
      return 'LOGIN_ERROR';

    } catch (error) {
      this.logger.error('Error checking login result:', error.message);
      return 'LOGIN_ERROR';
    }
  }

  async validateSuccessfulLogin(page) {
    try {
      // Strategy 1: Look for specific SINOE logo image by src
      const logoImages = await page.$$('img');
      for (const img of logoImages) {
        const src = await page.evaluate(el => el.src, img);
        if (src && src.includes('logo-menu-sinoe.png')) {
          this.logger.info(`✅ Found SINOE logo image: ${src}`);
          return true;
        }
      }

      // Strategy 2: Try XPath selectors for the logo image
      for (const selector of this.config.selectors.successLoginImageSelectors) {
        if (selector.startsWith('/') || selector.startsWith('//')) {
          // XPath selector
          try {
            const [element] = await page.$x(selector);
            if (element) {
              this.logger.info(`✅ Found SINOE logo with XPath: ${selector}`);
              return true;
            }
          } catch (error) {
            continue;
          }
        } else {
          // CSS selector
          const element = await page.$(selector);
          if (element) {
            this.logger.info(`✅ Found SINOE logo with selector: ${selector}`);
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      this.logger.error('Error validating successful login:', error.message);
      return false;
    }
  }

  async checkActiveSessionMessage(page) {
    try {
      // Check all strong, alert, and td elements for "SESIÓN ACTIVA" text
      for (const selector of this.config.selectors.activeSessionSelectors) {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const text = await page.evaluate(el => el.textContent?.trim() || '', element);
          if (text.includes('SESIÓN ACTIVA') || text.includes('Se ha detectado que usted cuenta con una')) {
            this.logger.info(`Found active session text: "${text}"`);
            return true;
          }
        }
      }
      return false;
    } catch (error) {
      this.logger.error('Error checking active session:', error.message);
      return false;
    }
  }

  async checkLoginErrors(page) {
    try {
      const errorSelectors = [
        '.error',
        '.alert-danger',
        '.mensaje-error',
        '[class*="error"]',
        'td'
      ];

      for (const selector of errorSelectors) {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const errorText = await page.evaluate(el => el.textContent?.trim().toLowerCase() || '', element);
          if (errorText.length > 0) {
            if (errorText.includes('captcha') || errorText.includes('código') || errorText.includes('incorrecto')) {
              this.logger.info(`🔍 Detected captcha/login error: ${errorText}`);
              return 'CAPTCHA_ERROR';
            } else if (errorText.includes('inválido') || errorText.includes('error')) {
              this.logger.info(`🔍 Detected login error: ${errorText}`);
              return 'LOGIN_ERROR';
            }
          }
        }
      }
      return null;
    } catch (error) {
      this.logger.error('Error checking login errors:', error.message);
      return 'LOGIN_ERROR';
    }
  }

  async redirectToLogin(page) {
    try {
      this.logger.info('🔄 Redirecting from SSO validation page to login...');
      
      // Navigate directly to the login page
      const loginUrl = 'https://casillas.pj.gob.pe/sinoe/login.xhtml';
      await page.goto(loginUrl, { waitUntil: 'networkidle0' });
      
      // Wait for page to load completely
      await this.wait(3000);
      
      this.logger.info('✅ Successfully redirected to login page');
      return true;
      
    } catch (error) {
      this.logger.error('Error redirecting to login:', error.message);
      return false;
    }
  }

  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = LoginValidator;