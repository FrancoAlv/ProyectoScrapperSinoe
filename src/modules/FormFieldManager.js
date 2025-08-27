// Form field management module
const CaptchaSolver = require('../captchaSolver');

class FormFieldManager {
  constructor(config, logger) {
    this.config = config.formFilling;
    this.logger = logger;
    this.captchaSolver = new CaptchaSolver(config, logger);
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
      const value = await this.determineValueForInput(page, inputDetails);
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

  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = FormFieldManager;