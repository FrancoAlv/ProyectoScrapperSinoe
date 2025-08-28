// Load environment variables from .env file
require('dotenv').config();

// Configuration module
class Config {
  static get() {
    return {
      userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
      respectRobotsTxt: process.env.RESPECT_ROBOTS === 'false' ? false : true,
      delayBetweenRequests: parseInt(process.env.DELAY_MS || '3000'),
      timeout: parseInt(process.env.TIMEOUT_MS || '30000'),
      targetUrls: process.env.TARGET_URLS ? process.env.TARGET_URLS.split(',') : [],
      outputBucket: process.env.S3_BUCKET || null,
      logLevel: process.env.LOG_LEVEL || 'info',

      // WhatsApp configuration - Single client with multiple recipients
      whatsapp: {
        enabled: process.env.WHATSAPP_ENABLED === 'true',
        sessionPrefix: process.env.WHATSAPP_SESSION_PREFIX || 'sinoe',
        headless: process.env.WHATSAPP_HEADLESS !== 'false',
        notificationPhone: process.env.WHATSAPP_NOTIFICATION_PHONE || '',
        testPhone: process.env.WHATSAPP_TEST_PHONE || '',
        logIncomingMessages: process.env.WHATSAPP_LOG_INCOMING === 'true',
        logMessageStatus: process.env.WHATSAPP_LOG_MESSAGE_STATUS === 'true',
        sendOnSuccess: process.env.WHATSAPP_SEND_ON_SUCCESS === 'true',
        sendOnError: process.env.WHATSAPP_SEND_ON_ERROR === 'true',
        // Single client configuration (who connects to WhatsApp)
        clientUser: (() => {
          try {
            return process.env.WHATSAPP_CLIENT_USER ? JSON.parse(process.env.WHATSAPP_CLIENT_USER) : {
              name: 'main',
              phone: process.env.WHATSAPP_NOTIFICATION_PHONE || '',
              email: process.env.EMAILCLIENT || ''
            };
          } catch {
            return {
              name: 'main',
              phone: process.env.WHATSAPP_NOTIFICATION_PHONE || '',
              email: process.env.EMAILCLIENT || ''
            };
          }
        })(),
        // Multiple notification recipients
        recipients: (() => {
          try {
            return process.env.WHATSAPP_RECIPIENTS ? JSON.parse(process.env.WHATSAPP_RECIPIENTS) : [
              {
                name: 'Franco',
                phone: process.env.WHATSAPP_NOTIFICATION_PHONE || '',
                email: process.env.EMAILCLIENT || '',
                receiveNotifications: true
              }
            ];
          } catch {
            return [{
              name: 'Franco',
              phone: process.env.WHATSAPP_NOTIFICATION_PHONE || '',
              email: process.env.EMAILCLIENT || '',
              receiveNotifications: true
            }];
          }
        })()
      },

      // Email configuration for QR codes (AWS SES)
      email: {
        enabled: process.env.EMAIL_ENABLED === 'true',
        host: process.env.HOST || 'email-smtp.us-east-1.amazonaws.com',
        port: parseInt(process.env.EMAIL_PORT || '587'),
        secure: process.env.EMAIL_SECURE === 'true',
        userEmail: process.env.USEREMAIL || '', // AWS SES SMTP username
        passEmail: process.env.PASSEMAIL || '', // AWS SES SMTP password
        emailUser: process.env.EMAILUSER || 'admin@obstelig.com', // Sender display name
        emailClient: process.env.EMAILCLIENT || 'franco.caralv@gmail.com' // Default recipient
      },

      // AWS S3 configuration for session storage
      aws: {
        enabled: process.env.AWS_S3_ENABLED === 'true',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        region: process.env.AWS_REGION || 'us-east-1',
        bucket: process.env.AWS_S3_BUCKET || 'sinoe-whatsapp-sessions'
      },

      // AWS DynamoDB configuration for data storage
      dynamodb: {
        enabled: process.env.DYNAMODB_ENABLED === 'true',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        region: process.env.DYNAMODB_REGION || process.env.AWS_REGION || 'us-east-1',
        tableName: process.env.DYNAMODB_TABLE_NAME || 'DocumentosSinoe'
      },
      
      // Browser configuration
      browser: {
        headless: process.env.HEADLESS === 'true' ? 'new' : false,
        slowMo: parseInt(process.env.SLOW_MO || '100'),
        devtools: false,
        defaultViewport: { width: 1280, height: 720 },
        executablePath: process.env.LAMBDA_MODE === 'true' ? '/usr/bin/chromium' : undefined,
        timeout: 60000,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-gpu-sandbox',
          '--disable-software-rasterizer',
          '--no-first-run',
          '--no-zygote',
          '--disable-extensions',
          '--disable-default-apps',
          '--disable-background-networking',
          '--disable-sync',
          '--disable-translate',
          '--hide-scrollbars',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-default-browser-check',
          '--safebrowsing-disable-auto-update',
          '--disable-client-side-phishing-detection',
          '--disable-features=TranslateUI',
          '--disable-features=BlinkGenPropertyTrees',
          '--disable-features=VizDisplayCompositor',
          '--disable-ipc-flooding-protection'
        ]
      },
      
      // Form filling configuration
      formFilling: {
        // Field values configuration
        fields: {
          usuario: process.env.INPUT_USUARIO || '151151',
          password: process.env.INPUT_PASSWORD || 'defaultpassword123',
          captcha: process.env.INPUT_CAPTCHA || 'AUTO'
        },

        // OpenAI configuration for captcha solving
        openai: {
          apiKey: process.env.OPENAI_API_KEY || '',
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          enabled: process.env.AUTO_SOLVE_CAPTCHA === 'true'
        },

        // Login automation settings
        loginAutomation: {
          autoSubmit: process.env.AUTO_SUBMIT_FORM === 'true',
          submitDelay: parseInt(process.env.SUBMIT_DELAY || '1500'),
          maxRetries: parseInt(process.env.LOGIN_MAX_RETRIES || '3'),
          minCaptchaConfidence: parseInt(process.env.MIN_CAPTCHA_CONFIDENCE || '70')
        },
        
        // Parse JSON configuration if provided
        formFields: (() => {
          try {
            return process.env.FORM_FIELDS ? JSON.parse(process.env.FORM_FIELDS) : {};
          } catch {
            return {};
          }
        })(),
        
        // Legacy support
        inputValue: process.env.INPUT_VALUE || process.env.INPUT_USUARIO || '151151',
        
        waitTime: parseInt(process.env.FORM_WAIT_TIME || '10000'),
        typeDelay: parseInt(process.env.TYPE_DELAY || '50'),
        
        selectors: {
          // Usuario/Username selectors
          userByPlaceholder: 'input[placeholder="Usuario"]',
          userByName: 'input[name="P5qKey@kVBiG2Yn2dPEwG3&@n"]',
          userCommonSelectors: [
            'input[placeholder*="Usuario"]',
            'input[placeholder*="usuario"]', 
            'input[placeholder*="User"]',
            'input[placeholder*="user"]',
            'input[id*="user"]',
            'input[id*="User"]',
            'input[id*="login"]',
            'input[name*="user"]',
            'input[class*="user"]'
          ],
          
          // Password selectors
          passwordByPlaceholder: 'input[placeholder="Contraseña"]',
          passwordByType: 'input[type="password"]',
          passwordCommonSelectors: [
            'input[placeholder*="Contraseña"]',
            'input[placeholder*="contraseña"]',
            'input[placeholder*="Password"]',
            'input[placeholder*="password"]',
            'input[placeholder*="Pass"]',
            'input[id*="pass"]',
            'input[id*="Pass"]',
            'input[id*="password"]',
            'input[name*="pass"]',
            'input[class*="pass"]'
          ],
          
          // Captcha selectors
          captchaById: 'input[id="frmLogin:captcha"]',
          captchaImageId: 'img[id="frmLogin:imgCapcha"]',
          captchaByPlaceholder: 'input[placeholder*="Captcha"]',
          captchaCommonSelectors: [
            'input[placeholder*="captcha"]',
            'input[placeholder*="Captcha"]',
            'input[placeholder*="CAPTCHA"]',
            'input[placeholder*="código"]',
            'input[placeholder*="codigo"]',
            'input[placeholder*="verificación"]',
            'input[id*="captcha"]',
            'input[id*="Captcha"]',
            'input[name*="captcha"]',
            'input[class*="captcha"]'
          ],
          captchaImageSelectors: [
            'img[id="frmLogin:imgCapcha"]',
            'img[id*="captcha"]',
            'img[id*="Captcha"]',
            'img[class*="captcha"]',
            'img[alt*="captcha"]'
          ],

          // Submit button selectors
          submitButtonId: 'button[id="frmLogin:btnIngresar"]',
          submitButtonSelectors: [
            'button[id="frmLogin:btnIngresar"]',
            'input[id="frmLogin:btnIngresar"]',
            'button[type="submit"]',
            'input[type="submit"]',
            'button[class*="btn"]',
            'button[class*="submit"]',
            'input[value*="Ingresar"]',
            'button[value*="Ingresar"]',
            'a[onclick*="submit"]'
          ],
          
          // Modal selectors
          modalAcceptSelectors: [
            '#dynamicModal button[data-dismiss="modal"]',
            '#dynamicModal .btn-default',
            '#dynamicModal .btn:contains("Aceptar")',
            '#dynamicModal button:contains("Aceptar")',
            '#dynamicModal .modal-footer button',
            '.modal button[data-dismiss="modal"]'
          ],

          // Post-login selectors
          logoutButtonSelectors: [
            'button[value*="FINALIZAR SESIONES"]',
            '/html/body/div[1]/div[3]/table/tbody/tr[2]/td/form/button',
            '//*[@id="j_idt9:btnSalir"]'
          ],
          
          // Session detection selectors
          activeSessionSelectors: [
            'strong',
            '.alert',
            'td'
          ],

          // Success login validation selectors
          successLoginImageSelectors: [
            'img[src="/sinoe/resources/images/logo-menu-sinoe.png"]',
            'img[src*="logo-menu-sinoe.png"]',
            '/html/body/div[1]/form/div[1]/div/div[3]/div/div[1]/a/div/img',
            '//*[@id="frmNuevo:j_idt38"]/div/img'
          ],

          // Casillas Electronicas link selectors
          casillasElectronicasSelectors: [
            '/html/body/div[1]/form/div[1]/div/div[3]/div/div[1]/a',
            '//*[@id="frmNuevo:j_idt38"]',
            'a.ui-commandlink.ui-widget'
          ],

          // Data extraction selectors
          notificationsTableSelectors: [
            '/html/body/span/div/div[3]/div/form[2]/div[2]/div[2]/div/div/div[2]/table/tbody',
            '//*[@id="frmBusqueda:tblLista_data"]',
            'table tbody[id*="tblLista_data"]',
            '.ui-datatable-data tbody'
          ],

          // Logout selectors
          finalLogoutSelectors: [
            '#frmMenu\\:clCerrarSession',
            '/html/body/span/div/div[3]/div/form[1]/div[1]/table/tbody/tr/td[2]/table/tbody/tr/td[3]/a',
            'a[id*="clCerrarSession"]',
            'a:contains("CERRAR SESION")'
          ],

          // General selectors
          textInputs: 'input[type="text"]',
          allInputs: 'input'
        }
      }
    };
  }
}

module.exports = Config;