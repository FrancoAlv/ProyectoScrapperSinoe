// Main Form Filler module - Refactored and modular
const FormFieldManager = require('./modules/FormFieldManager');
const LoginValidator = require('./modules/validation/LoginValidator');
const SessionManager = require('./modules/session/SessionManager');
const NavigationManager = require('./modules/navigation/NavigationManager');
const DataExtractor = require('./modules/extraction/DataExtractor');

class FormFiller {
  constructor(config, logger) {
    this.config = config.formFilling;
    this.logger = logger;
    
    // Initialize modules
    this.fieldManager = new FormFieldManager(config, logger);
    this.validator = new LoginValidator(config, logger);
    this.sessionManager = new SessionManager(config, logger);
    this.navigationManager = new NavigationManager(config, logger);
    this.dataExtractor = new DataExtractor(config, logger);
  }

  async fillInputs(page) {
    this.logger.info('Looking for input fields...');
    
    try {
      // Wait for page to load completely
      await this.wait(1000);

      // Handle initial modal if present
      await this.navigationManager.handleInitialModal(page);

      // Analyze all inputs for debugging
      await this.fieldManager.analyzeAllInputs(page);

      // Fill form fields
      await this.fieldManager.fillUserFields(page);
      await this.fieldManager.fillPasswordFields(page);
      await this.fieldManager.fillCaptchaFields(page);
      await this.fieldManager.fillRemainingTextInputs(page);

      // Submit form if enabled
      if (this.config.loginAutomation.autoSubmit) {
        await this.submitFormWithRetry(page);
      } else {
        // Wait to see results
        this.logger.info(`Waiting ${this.config.waitTime}ms to see the results...`);
        await this.wait(this.config.waitTime);
      }

    } catch (error) {
      this.logger.error('Error filling inputs:', error.message);
    }
  }

  async submitForm(page) {
    this.logger.info('🚀 Attempting to submit form...');
    
    // Wait before submitting
    this.logger.info(`Waiting ${this.config.loginAutomation.submitDelay}ms before submitting...`);
    await this.wait(this.config.loginAutomation.submitDelay);

    try {
      // Strategy 1: Direct ID match (most specific)
      const submitById = await page.$(this.config.selectors.submitButtonId);
      if (submitById && await this.isButtonClickable(page, submitById)) {
        this.logger.info('Found submit button with id="frmLogin:btnIngresar", clicking...');
        await this.sessionManager.clickButton(page, submitById);
        return;
      }

      // Strategy 2: Try common submit button selectors
      for (const selector of this.config.selectors.submitButtonSelectors) {
        const button = await page.$(selector);
        if (button && await this.isButtonClickable(page, button)) {
          this.logger.info(`Found submit button with selector "${selector}", clicking...`);
          await this.sessionManager.clickButton(page, button);
          return;
        }
      }

      this.logger.error('❌ No submit button found - login must be completed manually');
      
    } catch (error) {
      this.logger.error('❌ Error submitting form:', error.message);
    }
  }

  async submitFormWithRetry(page) {
    let retryCount = 0;
    const maxRetries = this.config.loginAutomation.maxRetries;
    
    while (retryCount <= maxRetries) {
      this.logger.info(`🚀 Login attempt ${retryCount + 1}/${maxRetries + 1}`);
      
      // Re-fill form fields before each attempt (except the first one which was already filled)
      if (retryCount > 0) {
        this.logger.info('🔄 Re-filling form fields for retry attempt...');
        await this.navigationManager.handleInitialModal(page);
        await this.fieldManager.fillUserFields(page);
        await this.fieldManager.fillPasswordFields(page);
        await this.fieldManager.fillCaptchaFields(page);
        await this.fieldManager.fillRemainingTextInputs(page);
      }
      
      // Submit the form
      await this.submitForm(page);
      
      // Wait for response
      await this.wait(3000);
      
      // Check the result using validator
      const loginResult = await this.validator.checkLoginResult(page);
      
      if (loginResult === 'SUCCESS') {
        await this.handleSuccessfulLogin(page);
        return;
      } else if (loginResult === 'SSO_REDIRECT') {
        await this.handleSSORedirect(page);
        continue;
      } else if (loginResult === 'ACTIVE_SESSION') {
        const success = await this.handleActiveSessionRetry(page);
        if (success) continue;
        else return;
      } else if (loginResult === 'CAPTCHA_ERROR' || loginResult === 'LOGIN_ERROR') {
        retryCount++;
        const shouldContinue = await this.handleLoginError(page, loginResult);
        if (shouldContinue) {
          continue;
        } else {
          // Even with high confidence captcha failure, we should try again with new captcha
          this.logger.info('🔄 High confidence captcha failed, will retry with new captcha...');
          continue;
        }
      }
      
      if (retryCount > maxRetries) {
        this.logger.error(`❌ Max retries (${maxRetries}) reached. Login failed.`);
        return;
      }
      
      await this.wait(2000);
    }
  }

  async handleSuccessfulLogin(page) {
    this.logger.info('✅ Login successful!');
    
    // Navigate to Casillas Electronicas
    const navigationSuccess = await this.navigationManager.navigateToCasillasElectronicas(page);
    if (navigationSuccess) {
      this.logger.info('✅ Successfully navigated to Casillas Electrónicas');
      
      // Extract notifications data
      const notificationsData = await this.dataExtractor.extractNotificationsData(page);
      if (notificationsData && notificationsData.length > 0) {
        this.logger.info(`✅ Extracted ${notificationsData.length} notification records`);
        this.logger.info('📊 Notifications Data:', JSON.stringify(notificationsData, null, 2));
      } else {
        this.logger.info('⚠️ No notifications data found or table is empty');
      }
      
      // Final logout
      const logoutSuccess = await this.sessionManager.performFinalLogout(page);
      if (logoutSuccess) {
        this.logger.info('✅ Successfully logged out');
      } else {
        this.logger.info('⚠️ Could not perform final logout');
      }
    } else {
      this.logger.info('⚠️ Login successful but could not navigate to Casillas Electrónicas');
    }
  }

  async handleSSORedirect(page) {
    this.logger.info('🔄 SSO redirect detected, continuing with login process...');
    await this.wait(2000);
    
    // Re-fill form fields after redirect
    await this.navigationManager.handleInitialModal(page);
    await this.fieldManager.fillUserFields(page);
    await this.fieldManager.fillPasswordFields(page);
    await this.fieldManager.fillCaptchaFields(page);
    await this.fieldManager.fillRemainingTextInputs(page);
  }

  async handleActiveSessionRetry(page) {
    this.logger.info('⚠️ Active session detected, handling logout...');
    const logoutSuccess = await this.sessionManager.handleActiveSession(page);
    if (logoutSuccess) {
      this.logger.info('🔄 Restarting login process after logout...');
      await this.wait(3000); // Wait for page to load completely
      
      // Re-fill all form fields after logout
      await this.navigationManager.handleInitialModal(page);
      await this.fieldManager.fillUserFields(page);
      await this.fieldManager.fillPasswordFields(page);
      await this.fieldManager.fillCaptchaFields(page);
      await this.fieldManager.fillRemainingTextInputs(page);
      
      return true; // Continue with the login attempt
    } else {
      this.logger.error('❌ Failed to handle active session');
      return false;
    }
  }

  async handleLoginError(page, loginResult) {
    if (this.fieldManager.lowConfidenceCaptcha || loginResult === 'CAPTCHA_ERROR') {
      this.logger.info('🔄 Low confidence captcha or captcha error, reloading page...');
      await page.reload({ waitUntil: 'networkidle0' });
      await this.wait(2000);
      
      this.fieldManager.lowConfidenceCaptcha = false; // Reset flag
      return true; // Continue retrying with page reload
    } else {
      this.logger.info('⚠️ Login failed with high confidence captcha, will retry with new captcha');
      return false; // Continue retrying but without page reload
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

  async checkForLoginErrors(page) {
    try {
      // Common error selectors
      const errorSelectors = [
        '.error',
        '.alert',
        '.mensaje-error',
        '[class*="error"]',
        '[class*="alert"]',
        '[id*="error"]',
        '[id*="mensaje"]'
      ];

      for (const selector of errorSelectors) {
        const errorElement = await page.$(selector);
        if (errorElement) {
          const errorText = await page.evaluate(el => el.textContent?.trim(), errorElement);
          if (errorText && errorText.length > 0) {
            this.logger.info(`⚠️ Possible error message found: "${errorText}"`);
          }
        }
      }

      // Check if login was successful by looking for post-login elements
      const postLoginSelectors = [
        '[class*="dashboard"]',
        '[class*="home"]',
        '[class*="welcome"]',
        'a[href*="logout"]',
        'button[onclick*="logout"]'
      ];

      for (const selector of postLoginSelectors) {
        const element = await page.$(selector);
        if (element) {
          this.logger.info('✅ Login appears to be successful - found post-login elements');
          return;
        }
      }

    } catch (error) {
      this.logger.debug('Error checking for login status:', error.message);
    }
  }

  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = FormFiller;