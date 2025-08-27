// Captcha solving with OpenAI Vision
const OpenAI = require('openai');

class CaptchaSolver {
  constructor(config, logger) {
    this.config = config.formFilling;
    this.logger = logger;
    this.openai = null;
    
    if (this.config.openai.apiKey && this.config.openai.enabled) {
      this.openai = new OpenAI({
        apiKey: this.config.openai.apiKey
      });
      this.logger.info('🤖 OpenAI captcha solver initialized');
    } else {
      this.logger.info('⚠️ OpenAI captcha solver disabled - missing API key or disabled in config');
    }
  }

  async solveCaptcha(page) {
    if (!this.openai || !this.config.openai.enabled) {
      this.logger.info('🔤 Auto captcha solving disabled - using manual value');
      return { text: this.getManualCaptchaValue(), confidence: 0 };
    }

    try {
      this.logger.info('🖼️ Capturing captcha image...');
      
      // Find captcha image
      const captchaImage = await this.findCaptchaImage(page);
      if (!captchaImage) {
        this.logger.error('❌ Captcha image not found');
        return { text: this.getManualCaptchaValue(), confidence: 0 };
      }

      // Capture image as base64
      const imageBase64 = await this.captureImageBase64(page, captchaImage);
      this.logger.info(`Captcha image base64 length: ${imageBase64 ? imageBase64.length : 0}`);
      this.logger.info(`Captcha image base64 snippet: ${imageBase64 ? imageBase64.substring(0, 30) + '...' : 'N/A'}`);
      if (!imageBase64) {
        this.logger.error('❌ Failed to capture captcha image');
        return { text: this.getManualCaptchaValue(), confidence: 0 };
      }

      this.logger.info('🤖 Sending captcha to OpenAI for solving...');
      
      // Solve with OpenAI
      const solvedResult = await this.solveWithOpenAI(imageBase64);
      
      if (solvedResult && solvedResult.text) {
        this.logger.info(`✅ Captcha solved: "${solvedResult.text}" (confidence: ${solvedResult.confidence}%)`);
        return solvedResult;
      } else {
        this.logger.error('❌ OpenAI failed to solve captcha');
        return { text: this.getManualCaptchaValue(), confidence: 0 };
      }

    } catch (error) {
      this.logger.error('❌ Error solving captcha:', error.message);
      return { text: this.getManualCaptchaValue(), confidence: 0 };
    }
  }

  async findCaptchaImage(page) {
    // Strategy 1: Direct ID match (most specific)
    let captchaImage = await page.$(this.config.selectors.captchaImageId);
    if (captchaImage) {
      this.logger.info('Found captcha image with id="frmLogin:imgCapcha"');
      return captchaImage;
    }

    // Strategy 2: Common captcha image selectors
    for (const selector of this.config.selectors.captchaImageSelectors) {
      captchaImage = await page.$(selector);
      if (captchaImage) {
        this.logger.info(`Found captcha image with selector: ${selector}`);
        return captchaImage;
      }
    }

    this.logger.error('No captcha image found with any selector');
    return null;
  }

  async captureImageBase64(page, imageElement) {
    try {
      // Method 1: Screenshot the specific element
      const imageBuffer = await imageElement.screenshot({
        type: 'png',
        omitBackground: true
      });
      
      if (imageBuffer) {
        // Debug: Check if we got bytes array instead of Buffer
        if (Array.isArray(imageBuffer)) {
          this.logger.info(`Got bytes array: ${imageBuffer.slice(0, 10)}...`);
          // Convert byte array to Buffer
          const buffer = Buffer.from(imageBuffer);
          const base64 = buffer.toString('base64');
          this.logger.info(`Converted array to base64: ${base64.length} characters`);
          return base64;
        } else if (Buffer.isBuffer(imageBuffer)) {
          const base64 = imageBuffer.toString('base64');
          this.logger.info(`Buffer to base64: ${base64.length} characters`);
          return base64;
        } else if (typeof imageBuffer === 'object') {
          // Handle object with numeric properties (Uint8Array-like)
          this.logger.info(`Got object with bytes: ${String(imageBuffer).substring(0, 50)}`);
          const bytesArray = Object.values(imageBuffer);
          this.logger.info(`Extracted ${bytesArray.length} bytes`);
          const buffer = Buffer.from(bytesArray);
          const base64 = buffer.toString('base64');
          this.logger.info(`Converted object bytes to base64: ${base64.length} characters`);
          return base64;
        } else {
          this.logger.error(`Unexpected image data type: ${typeof imageBuffer}`);
          this.logger.info(`First few values: ${String(imageBuffer).substring(0, 50)}`);
        }
      }

      // Method 2: Get image src if it's a data URL
      const src = await page.evaluate(img => img.src, imageElement);
      if (src && src.startsWith('data:image/')) {
        const base64 = src.split(',')[1];
        this.logger.debug(`Extracted captcha from data URL: ${base64.length} characters`);
        return base64;
      }

      // Method 3: Navigate to image URL and capture
      if (src && src.startsWith('http')) {
        this.logger.debug(`Navigating to image URL: ${src}`);
        const response = await page.goto(src);
        if (response.ok()) {
          const buffer = await response.buffer();
          const base64 = buffer.toString('base64');
          this.logger.debug(`Downloaded captcha image: ${base64.length} characters`);
          return base64;
        }
      }

      return null;
    } catch (error) {
      this.logger.error('Error capturing image:', error.message);
      return null;
    }
  }

  async solveWithOpenAI(imageBase64) {
    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.openai.model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Please analyze this captcha image and provide: 1) The text/characters you see 2) Your confidence level (0-100). Format your response as: "TEXT:confidence". Example: "ABC123:85". The captcha contains alphanumeric characters. If unclear, make your best guess and lower the confidence.`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${imageBase64}`
                }
              }
            ]
          }
        ],
        max_tokens: 30,
        temperature: 0.1 // Low temperature for consistent results
      });

      const aiResponse = response.choices[0]?.message?.content?.trim();
      
      if (aiResponse) {
        // Parse response format "TEXT:confidence"
        const parts = aiResponse.split(':');
        let text = parts[0];
        let confidence = 50; // Default confidence
        
        if (parts.length >= 2) {
          const confidenceStr = parts[1].replace(/[^0-9]/g, '');
          confidence = parseInt(confidenceStr) || 50;
        }
        
        // Clean the text response
        const cleanedText = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        
        this.logger.info(`OpenAI response: "${aiResponse}" → text: "${cleanedText}", confidence: ${confidence}%`);
        
        return {
          text: cleanedText,
          confidence: confidence
        };
      }

      return null;
    } catch (error) {
      this.logger.error('OpenAI API error:', error.message);
      return null;
    }
  }

  getManualCaptchaValue() {
    // Priority: FORM_FIELDS JSON > Individual env var > fields config > fallback
    if (this.config.formFields.captcha && this.config.formFields.captcha !== 'AUTO') {
      return this.config.formFields.captcha;
    }
    if (this.config.fields.captcha && this.config.fields.captcha !== 'AUTO') {
      return this.config.fields.captcha;
    }
    return 'MANUAL'; // Placeholder indicating manual intervention needed
  }
}

module.exports = CaptchaSolver;