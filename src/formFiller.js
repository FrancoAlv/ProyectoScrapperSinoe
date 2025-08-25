// Form filling module
const CaptchaSolver = require('./captchaSolver');

class FormFiller {
  constructor(config, logger) {
    this.config = config.formFilling;
    this.logger = logger;
    this.captchaSolver = new CaptchaSolver(config, logger);
  }

  async fillInputs(page) {
    this.logger.info('Looking for input fields...');
    
    try {
      // Wait for page to load completely
      await this.wait(1000);

      // Handle initial modal if present
      await this.handleInitialModal(page);

      // Analyze all inputs for debugging
      await this.analyzeAllInputs(page);

      // Fill usuario/username fields
      await this.fillUserFields(page);

      // Fill password fields
      await this.fillPasswordFields(page);

      // Fill captcha fields
      await this.fillCaptchaFields(page);

      // Fill any remaining text inputs with fallback logic
      await this.fillRemainingTextInputs(page);

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

  async analyzeAllInputs(page) {
    const allInputs = await page.$$('input');
    this.logger.info(`Found ${allInputs.length} total inputs on page`);
    
    for (let i = 0; i < allInputs.length; i++) {
      const input = allInputs[i];
      const inputInfo = await page.evaluate(el => ({
        type: el.type,
        placeholder: el.placeholder,
        name: el.name,
        id: el.id,
        className: el.className,
        value: el.value,
        visible: el.offsetParent !== null
      }), input);
      
      this.logger.info(`Input ${i + 1}:`, inputInfo);
    }
  }

  async fillUserFields(page) {
    this.logger.info('🔑 Filling usuario/username fields...');
    const userValue = this.getUserValue();
    
    // Strategy 1: Direct placeholder match
    const userByPlaceholder = await page.$(this.config.selectors.userByPlaceholder);
    if (userByPlaceholder && await this.isInputVisible(page, userByPlaceholder)) {
      this.logger.info(`Found input with placeholder "Usuario", filling with: ${userValue}`);
      await this.fillInput(page, userByPlaceholder, userValue);
      return;
    }

    // Strategy 2: Specific name match
    const userByName = await page.$(this.config.selectors.userByName);
    if (userByName && await this.isInputVisible(page, userByName)) {
      this.logger.info(`Found input with name "P5qKey@kVBiG2Yn2dPEwG3&@n", filling with: ${userValue}`);
      await this.fillInput(page, userByName, userValue);
      return;
    }

    // Strategy 3: Common user selectors
    for (const selector of this.config.selectors.userCommonSelectors) {
      const input = await page.$(selector);
      if (input && await this.isInputVisible(page, input)) {
        this.logger.info(`Found user input with selector "${selector}", filling with: ${userValue}`);
        await this.fillInput(page, input, userValue);
        return;
      }
    }

    this.logger.info('No user/usuario input fields found');
  }

  async fillPasswordFields(page) {
    this.logger.info('🔒 Filling password fields...');
    const passwordValue = this.getPasswordValue();
    
    // Strategy 1: Direct placeholder match
    const passByPlaceholder = await page.$(this.config.selectors.passwordByPlaceholder);
    if (passByPlaceholder && await this.isInputVisible(page, passByPlaceholder)) {
      this.logger.info(`Found input with placeholder "Contraseña", filling with: ${passwordValue}`);
      await this.fillInput(page, passByPlaceholder, passwordValue);
      return;
    }

    // Strategy 2: Password type
    const passByType = await page.$(this.config.selectors.passwordByType);
    if (passByType && await this.isInputVisible(page, passByType)) {
      this.logger.info(`Found password type input, filling with: ${passwordValue}`);
      await this.fillInput(page, passByType, passwordValue);
      return;
    }

    // Strategy 3: Common password selectors
    for (const selector of this.config.selectors.passwordCommonSelectors) {
      const input = await page.$(selector);
      if (input && await this.isInputVisible(page, input)) {
        this.logger.info(`Found password input with selector "${selector}", filling with: ${passwordValue}`);
        await this.fillInput(page, input, passwordValue);
        return;
      }
    }

    this.logger.info('No password input fields found');
  }

  async fillCaptchaFields(page) {
    this.logger.info('🔤 Filling captcha fields...');
    
    // Find the captcha input field first
    const captchaInput = await this.findCaptchaInput(page);
    if (!captchaInput) {
      this.logger.info('No captcha input fields found');
      return;
    }

    // Get captcha value - either from OpenAI or manual
    let captchaValue = await this.getCaptchaValue(page);
    
    // If captcha value is AUTO or empty, try to solve it
    if (!captchaValue || captchaValue === 'AUTO' || captchaValue === 'MANUAL') {
      this.logger.info('🤖 Attempting to solve captcha automatically...');
      const captchaResult = await this.captchaSolver.solveCaptcha(page);
      
      if (captchaResult && captchaResult.text) {
        // Check confidence level
        if (captchaResult.confidence >= this.config.loginAutomation.minCaptchaConfidence) {
          this.logger.info(`✅ High confidence captcha (${captchaResult.confidence}%), using: ${captchaResult.text}`);
          captchaValue = captchaResult.text;
        } else {
          this.logger.info(`⚠️ Low confidence captcha (${captchaResult.confidence}%), will retry if login fails`);
          captchaValue = captchaResult.text;
          // Store low confidence flag for retry logic
          this.lowConfidenceCaptcha = true;
        }
      } else {
        captchaValue = 'MANUAL';
      }
    }

    if (captchaValue && captchaValue !== 'MANUAL') {
      this.logger.info(`Found captcha input, filling with solved value: ${captchaValue}`);
      await this.fillInput(page, captchaInput, captchaValue);
      return captchaValue; // Return for retry logic
    } else {
      this.logger.info('❌ Could not solve captcha automatically - manual intervention required');
      this.logger.info('💡 The browser will stay open for manual captcha entry');
      return null;
    }
  }

  async findCaptchaInput(page) {
    // Strategy 1: Direct ID match (most specific)
    const captchaById = await page.$(this.config.selectors.captchaById);
    if (captchaById && await this.isInputVisible(page, captchaById)) {
      this.logger.info('Found captcha input with id="frmLogin:captcha"');
      return captchaById;
    }

    // Strategy 2: Placeholder match
    const captchaByPlaceholder = await page.$(this.config.selectors.captchaByPlaceholder);
    if (captchaByPlaceholder && await this.isInputVisible(page, captchaByPlaceholder)) {
      this.logger.info('Found captcha input by placeholder');
      return captchaByPlaceholder;
    }

    // Strategy 3: Common captcha selectors
    for (const selector of this.config.selectors.captchaCommonSelectors) {
      const input = await page.$(selector);
      if (input && await this.isInputVisible(page, input)) {
        this.logger.info(`Found captcha input with selector "${selector}"`);
        return input;
      }
    }

    return null;
  }

  async fillRemainingTextInputs(page) {
    this.logger.info('📝 Checking remaining text inputs...');
    const textInputs = await page.$$(this.config.selectors.textInputs);
    
    for (let i = 0; i < textInputs.length; i++) {
      const input = textInputs[i];
      const inputDetails = await page.evaluate(el => ({
        placeholder: el.placeholder,
        name: el.name,
        id: el.id,
        type: el.type,
        value: el.value,
        visible: el.offsetParent !== null,
        disabled: el.disabled
      }), input);
      
      this.logger.debug(`Text input ${i + 1}:`, inputDetails);
      
      // Skip if already filled or not visible
      if (inputDetails.disabled || !inputDetails.visible || inputDetails.value) {
        continue;
      }

      // Determine what to fill based on input characteristics
      const value = this.determineValueForInput(inputDetails);
      if (value) {
        this.logger.info(`Filling remaining input ${i + 1} (${inputDetails.placeholder || inputDetails.name || inputDetails.id}) with: ${value}`);
        await this.fillInput(page, input, value);
      }
    }
  }

  getUserValue() {
    // Priority: FORM_FIELDS JSON > Individual env var > fields config > fallback
    if (this.config.formFields.usuario) return this.config.formFields.usuario;
    if (this.config.formFields.user) return this.config.formFields.user;
    return this.config.fields.usuario;
  }

  getPasswordValue() {
    // Priority: FORM_FIELDS JSON > Individual env var > fields config > fallback
    if (this.config.formFields.password) return this.config.formFields.password;
    if (this.config.formFields.contraseña) return this.config.formFields.contraseña;
    return this.config.fields.password;
  }

  async getCaptchaValue(page) {
    // Priority: FORM_FIELDS JSON > Individual env var > fields config > fallback
    let value = null;
    
    if (this.config.formFields.captcha) {
      value = this.config.formFields.captcha;
    } else if (this.config.formFields.codigo) {
      value = this.config.formFields.codigo;
    } else {
      value = this.config.fields.captcha;
    }

    // If value is AUTO, let the captcha solver handle it
    if (value === 'AUTO') {
      this.logger.info('🤖 Captcha set to AUTO - will use OpenAI to solve');
      return 'AUTO';
    }

    return value;
  }

  determineValueForInput(inputDetails) {
    const placeholder = (inputDetails.placeholder || '').toLowerCase();
    const name = (inputDetails.name || '').toLowerCase();
    const id = (inputDetails.id || '').toLowerCase();
    
    // Check if it's a user field
    if (placeholder.includes('usuario') || placeholder.includes('user') || 
        name.includes('user') || id.includes('user')) {
      return this.getUserValue();
    }
    
    // Check if it's a password field (shouldn't happen here but safety check)
    if (placeholder.includes('contraseña') || placeholder.includes('password') ||
        name.includes('pass') || id.includes('pass')) {
      return this.getPasswordValue();
    }
    
    // Check if it's a captcha field
    if (placeholder.includes('captcha') || placeholder.includes('código') || placeholder.includes('codigo') ||
        placeholder.includes('verificación') || name.includes('captcha') || id.includes('captcha')) {
      return this.getCaptchaValue();
    }

    return null; // Don't fill unknown fields
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
        await this.clickButton(page, submitById);
        return;
      }

      // Strategy 2: Try common submit button selectors
      for (const selector of this.config.selectors.submitButtonSelectors) {
        const button = await page.$(selector);
        if (button && await this.isButtonClickable(page, button)) {
          this.logger.info(`Found submit button with selector "${selector}", clicking...`);
          await this.clickButton(page, button);
          return;
        }
      }

      this.logger.error('❌ No submit button found - login must be completed manually');
      
    } catch (error) {
      this.logger.error('❌ Error submitting form:', error.message);
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

      // Look for common error messages
      await this.checkForLoginErrors(page);
      
    } catch (error) {
      this.logger.error('Error clicking submit button:', error.message);
    }
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

  async isInputVisible(page, input) {
    return await page.evaluate(el => el.offsetParent !== null && !el.disabled, input);
  }

  async fillInput(page, input, value) {
    await input.click();
    await input.focus();
    
    // Clear input first
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Delete');
    
    // Type the value
    await page.keyboard.type(value, { delay: this.config.typeDelay });
    await this.wait(500);
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

  async isModalVisible(page, modal) {
    return await page.evaluate(el => {
      return el.offsetParent !== null && 
             (el.classList.contains('show') || 
              el.classList.contains('modal-open') ||
              el.style.display !== 'none');
    }, modal);
  }

  async submitFormWithRetry(page) {
    let retryCount = 0;
    const maxRetries = this.config.loginAutomation.maxRetries;
    
    while (retryCount <= maxRetries) {
      this.logger.info(`🚀 Login attempt ${retryCount + 1}/${maxRetries + 1}`);
      
      // Submit the form
      await this.submitForm(page);
      
      // Wait for response
      await this.wait(3000);
      
      // Check the result
      const loginResult = await this.checkLoginResult(page);
      
      if (loginResult === 'SUCCESS') {
        this.logger.info('✅ Login successful!');
        
        // Navigate to Casillas Electronicas
        const navigationSuccess = await this.navigateToCasillasElectronicas(page);
        if (navigationSuccess) {
          this.logger.info('✅ Successfully navigated to Casillas Electrónicas');
          
          // Extract notifications data
          const notificationsData = await this.extractNotificationsData(page);
          if (notificationsData && notificationsData.length > 0) {
            this.logger.info(`✅ Extracted ${notificationsData.length} notification records`);
            this.logger.info('📊 Notifications Data:', JSON.stringify(notificationsData, null, 2));
          } else {
            this.logger.info('⚠️ No notifications data found or table is empty');
          }
          
          // Final logout
          const logoutSuccess = await this.performFinalLogout(page);
          if (logoutSuccess) {
            this.logger.info('✅ Successfully logged out');
          } else {
            this.logger.info('⚠️ Could not perform final logout');
          }
        } else {
          this.logger.info('⚠️ Login successful but could not navigate to Casillas Electrónicas');
        }
        return;
      } else if (loginResult === 'SSO_REDIRECT') {
        this.logger.info('🔄 SSO redirect detected, continuing with login process...');
        await this.wait(2000);
        
        // Re-fill form fields after redirect
        await this.handleInitialModal(page);
        await this.fillUserFields(page);
        await this.fillPasswordFields(page);
        await this.fillCaptchaFields(page);
        await this.fillRemainingTextInputs(page);
        
        continue; // Continue with the login attempt
      } else if (loginResult === 'ACTIVE_SESSION') {
        this.logger.info('⚠️ Active session detected, handling logout...');
        const logoutSuccess = await this.handleActiveSession(page);
        if (logoutSuccess) {
          this.logger.info('🔄 Restarting login process after logout...');
          retryCount = 0; // Reset retry count
          await this.wait(3000); // Wait for page to load completely
          
          // Re-fill all form fields after logout
          await this.handleInitialModal(page);
          await this.fillUserFields(page);
          await this.fillPasswordFields(page);
          await this.fillCaptchaFields(page);
          await this.fillRemainingTextInputs(page);
          
          continue; // Continue with the login attempt
        } else {
          this.logger.error('❌ Failed to handle active session');
          return;
        }
      } else if (loginResult === 'CAPTCHA_ERROR' || loginResult === 'LOGIN_ERROR') {
        if (this.lowConfidenceCaptcha || loginResult === 'CAPTCHA_ERROR') {
          this.logger.info('🔄 Low confidence captcha or captcha error, reloading page...');
          await page.reload({ waitUntil: 'networkidle0' });
          await this.wait(2000);
          
          // Re-fill the form
          await this.handleInitialModal(page);
          await this.fillUserFields(page);
          await this.fillPasswordFields(page);
          const newCaptchaValue = await this.fillCaptchaFields(page);
          
          this.lowConfidenceCaptcha = false; // Reset flag
          retryCount++;
          continue;
        } else {
          this.logger.error('❌ Login failed with high confidence captcha');
          retryCount++;
        }
      }
      
      if (retryCount > maxRetries) {
        this.logger.error(`❌ Max retries (${maxRetries}) reached. Login failed.`);
        return;
      }
      
      await this.wait(2000);
    }
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

  async extractNotificationsData(page) {
    try {
      this.logger.info('📊 Starting notifications data extraction...');
      await this.wait(3000); // Wait for table to fully load
      
      // Find the notifications table tbody
      let tableBody = null;
      
      for (const selector of this.config.selectors.notificationsTableSelectors) {
        if (selector.startsWith('/') || selector.startsWith('//')) {
          // XPath selector
          try {
            const [element] = await page.$x(selector);
            if (element) {
              this.logger.info(`Found notifications table with XPath: ${selector}`);
              tableBody = element;
              break;
            }
          } catch (error) {
            continue;
          }
        } else {
          // CSS selector
          const element = await page.$(selector);
          if (element) {
            this.logger.info(`Found notifications table with selector: ${selector}`);
            tableBody = element;
            break;
          }
        }
      }
      
      if (!tableBody) {
        this.logger.error('❌ Could not find notifications table');
        return [];
      }
      
      // Extract data from table rows
      const notificationsData = await page.evaluate((tbody) => {
        const rows = tbody.querySelectorAll('tr');
        const data = [];
        
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const cells = row.querySelectorAll('td');
          
          if (cells.length >= 6) { // Ensure we have enough columns
            const rowData = {
              numero: i + 1,
              numeroNotificacion: cells[3]?.textContent?.trim() || '',
              numeroExpediente: cells[4]?.textContent?.trim() || '',
              sumilla: cells[5]?.textContent?.trim() || '',
              oficinaJudicial: cells[6]?.textContent?.trim() || '',
              fecha: cells[7]?.textContent?.trim() || ''
            };
            
            // Only add if row has actual data
            if (rowData.numeroNotificacion || rowData.numeroExpediente) {
              data.push(rowData);
            }
          }
        }
        
        return data;
      }, tableBody);
      
      this.logger.info(`✅ Successfully extracted ${notificationsData.length} records from notifications table`);
      return notificationsData;
      
    } catch (error) {
      this.logger.error('Error extracting notifications data:', error.message);
      return [];
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
              const altElement = await page.$('#frmMenu\\:clCerrarSession');
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

  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = FormFiller;