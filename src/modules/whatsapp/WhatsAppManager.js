// WhatsApp messaging module using whatsapp-web.js with single client - Singleton Pattern with Observer
// Archivo corregido por ChatGPT (sept-2025)

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const EmailManager = require('../email/EmailManager');
const S3SessionManager = require('../storage/S3SessionManager');
const DynamoDBManager = require('../database/DynamoDBManager');
const path = require('path');
const EventEmitter = require('events');
const fs = require('fs').promises;

class WhatsAppManager extends EventEmitter {
  constructor(config, logger) {
    // Singleton pattern
    if (WhatsAppManager.instance) return WhatsAppManager.instance;
    super();

    this.config = config.whatsapp || {};
    this.fullConfig = config;
    this.logger = logger;
    
    // Log memory at construction
    this.logMemoryAtConstruction();

    this.client = null;
    this.sessionName = null;           // == clientId
    this.dataPath = null;              // base path para LocalAuth
    this.sessionDir = null;            // {dataPath}/session-{clientId}

    this.clientUser = this.parseClientUser();
    this.notificationRecipients = this.parseRecipients();

    this.emailManager = new EmailManager(config, logger);
    this.s3SessionManager = new S3SessionManager(config, logger);
    this.dynamoDBManager = new DynamoDBManager(config.aws, logger);

    this.isInitialized = false;
    this.isConnected = false;
    this.verificationInterval = null;

    WhatsAppManager.instance = this;
    this.setupObservers();
  }

  logMemoryAtConstruction() {
    try {
      const used = process.memoryUsage();
      const totalMB = Math.round(used.rss / 1024 / 1024);
      const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
      
      if (process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) {
        const lambdaMemoryMB = parseInt(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE);
        const usagePercent = Math.round((totalMB / lambdaMemoryMB) * 100);
        
        this.logger.info(`🧠 WhatsApp Constructor Memory: ${totalMB}MB/${lambdaMemoryMB}MB (${usagePercent}%) | Heap: ${heapUsedMB}MB`);
        
        if (usagePercent > 70) {
          this.logger.warn(`⚠️ Memory usage before WhatsApp: ${usagePercent}% - may cause issues`);
        }
      } else {
        this.logger.info(`🧠 WhatsApp Constructor Memory: RSS=${totalMB}MB | Heap=${heapUsedMB}MB`);
      }
    } catch (error) {
      this.logger.debug(`Error logging constructor memory: ${error.message}`);
    }
  }

  checkMemoryAvailability() {
    try {
      const used = process.memoryUsage();
      const totalMB = Math.round(used.rss / 1024 / 1024);
      
      if (process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) {
        const lambdaMemoryMB = parseInt(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE);
        const usagePercent = (totalMB / lambdaMemoryMB) * 100;
        const freeMB = lambdaMemoryMB - totalMB;
        
        // WhatsApp necesita al menos 500MB libres para funcionar bien
        const requiredFreeMB = 500;
        
        if (freeMB < requiredFreeMB) {
          return {
            sufficient: false,
            message: `Only ${freeMB}MB free, need ${requiredFreeMB}MB for WhatsApp. Current usage: ${usagePercent.toFixed(1)}%`
          };
        }
        
        if (usagePercent > 75) {
          return {
            sufficient: false,
            message: `Memory usage too high: ${usagePercent.toFixed(1)}% (${totalMB}MB/${lambdaMemoryMB}MB)`
          };
        }
        
        return {
          sufficient: true,
          message: `Memory OK: ${freeMB}MB free (${usagePercent.toFixed(1)}% used)`
        };
      }
      
      return { sufficient: true, message: 'Memory check skipped (not Lambda)' };
    } catch (error) {
      return { sufficient: true, message: `Memory check failed: ${error.message}` };
    }
  }

  parseClientUser() {
    try {
      if (this.config.clientUser) return this.config.clientUser;
      if (process.env.WHATSAPP_CLIENT_USER) return JSON.parse(process.env.WHATSAPP_CLIENT_USER);
      return { name: 'main', phone: '', email: '' };
    } catch {
      return { name: 'main', phone: '', email: '' };
    }
  }

  parseRecipients() {
    try {
      if (this.config.recipients?.length > 0) return this.config.recipients;
      if (process.env.WHATSAPP_RECIPIENTS) return JSON.parse(process.env.WHATSAPP_RECIPIENTS);
      return [];
    } catch {
      return [];
    }
  }

  static getInstance(config = null, logger = null) {
    if (!WhatsAppManager.instance) {
      if (!config || !logger) throw new Error('WhatsAppManager requires config and logger for first initialization');
      WhatsAppManager.instance = new WhatsAppManager(config, logger);
    }
    return WhatsAppManager.instance;
  }

  static hasInstance() {
    return !!WhatsAppManager.instance;
  }

  static async destroyInstance() {
    if (WhatsAppManager.instance) {
      await WhatsAppManager.instance.close();
      WhatsAppManager.instance = null;
    }
  }

  static reset() {
    WhatsAppManager.instance = null;
  }

  async initialize() {
    try {
      this.logger.info('🚀 Initializing WhatsApp system...');
      
      // Check memory availability in Lambda
      if (process.env.LAMBDA_MODE === 'true') {
        const memoryCheck = this.checkMemoryAvailability();
        if (!memoryCheck.sufficient) {
          this.logger.error(`❌ Insufficient memory for WhatsApp: ${memoryCheck.message}`);
          return false;
        } else {
          this.logger.info(`✅ Memory check passed: ${memoryCheck.message}`);
        }
      }
      
      if (!this.config.enabled) {
        this.logger.info('⚠️ WhatsApp is disabled in configuration');
        return false;
      }

      // Debug
      this.logger.debug('🔧 Full config passed to WhatsApp:', {
        whatsappEnabled: this.config.enabled,
        emailEnabled: this.fullConfig.email?.enabled,
        s3Enabled: this.fullConfig.aws?.enabled,
        recipientsCount: this.notificationRecipients.length
      });

      const emailInitialized = await this.emailManager.initialize();
      this.logger.debug(`📧 Email initialization result: ${emailInitialized}`);

      const s3Initialized = await this.s3SessionManager.initialize();
      this.logger.debug(`☁️ S3 initialization result: ${s3Initialized}`);

      const dynamoInitialized = await this.dynamoDBManager.initialize();
      this.logger.debug(`🗄️ DynamoDB initialization result: ${dynamoInitialized}`);

      const clientInitialized = await this.initializeClient();
      this.isInitialized = clientInitialized;

      if (this.isInitialized) this.startPeriodicVerification();

      this.logger.info(`✅ WhatsApp system initialized: ${clientInitialized ? 'OK' : 'Failed'}`);
      return this.isInitialized;
    } catch (error) {
      this.logger.error('❌ Failed to initialize WhatsApp system:', error.message);
      this.isInitialized = false;
      return false;
    }
  }

  // Espera real a READY/CONNECTED
  waitForReady(ms = 60000) {
    return new Promise((resolve, reject) => {
      if (this.isConnected) return resolve(true);
      if (!this.client) return reject(new Error('no client'));

      const onReady = () => { cleanup(); resolve(true); };
      const onDisc  = (reason) => { cleanup(); reject(new Error(`disconnected before ready: ${reason}`)); };
      const onAuthFail = (msg) => { cleanup(); reject(new Error(`auth_failure: ${msg}`)); };

      const t = setTimeout(() => { cleanup(); reject(new Error('ready timeout')); }, ms);

      const cleanup = () => {
        clearTimeout(t);
        this.client.off('ready', onReady);
        this.client.off('disconnected', onDisc);
        this.client.off('auth_failure', onAuthFail);
      };

      this.client.once('ready', onReady);
      this.client.once('disconnected', onDisc);
      this.client.once('auth_failure', onAuthFail);
    });
  }

  waitForDeliveryConfirmation(messageId, ms = 10000) {
    return new Promise((resolve) => {
      if (!this.client) {
        this.logger.debug('⚠️ No client available for delivery confirmation');
        return resolve(false);
      }

      let ackReceived = false;
      const timeout = setTimeout(() => {
        cleanup();
        if (!ackReceived) {
          this.logger.debug(`⏰ Delivery confirmation timeout for message ${messageId}`);
        }
        resolve(ackReceived);
      }, ms);

      const onMessageAck = (message, ack) => {
        if (message.id.id === messageId || message.id._serialized === messageId) {
          this.logger.debug(`📨 Message ${messageId} delivery status: ${ack} (0=error, 1=pending, 2=server, 3=delivered, 4=read)`);
          
          // Consider message delivered when ack >= 2 (server received or delivered)
          if (ack >= 2) {
            ackReceived = true;
            cleanup();
            resolve(true);
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        if (this.client) {
          this.client.off('message_ack', onMessageAck);
        }
      };

      this.client.on('message_ack', onMessageAck);
    });
  }

  async initializeClient() {
    try {
      this.logger.info('🚀 Initializing WhatsApp client...');

      // --- Sesión: clientId + rutas correctas
      const clientId = this.config.clientId || `${this.config.sessionPrefix || 'sinoe'}-main`;
      this.sessionName = clientId;

      // dataPath base (NO pongas el nombre del cliente aquí)
      this.dataPath = process.env.LAMBDA_MODE === 'true'
          ? '/tmp/wwebjs_auth'
          : path.join(process.cwd(), '.wwebjs_auth');

      this.sessionDir = path.join(this.dataPath, `session-${clientId}`);
      await fs.mkdir(this.sessionDir, { recursive: true });

      // Baja sesión de S3 directamente al sessionDir
      this.logger.info('📦 Downloading session from S3...');
      const sessionDownloaded = await this.s3SessionManager.downloadSession(clientId, this.sessionDir);
      this.logger.info(`📦 Session download result: ${sessionDownloaded}`);

      // Comprobar si hay contenido real
      const hasValidSession = await this.checkValidSession(this.sessionDir);
      this.logger.info(`🔍 Valid session check: ${hasValidSession}`);

      // --- Crear cliente
      const argsLambda =  [
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
      ];
      const argsLocal =  [
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
      ];

      // Log environment info before creating client
      this.logger.info(`🔧 Environment: Lambda=${process.env.LAMBDA_MODE}, Chromium=${process.env.PUPPETEER_EXECUTABLE_PATH}`);
      this.logger.info(`📁 Session path: ${this.sessionDir}`);
      
      this.client = new Client({
        authStrategy: new LocalAuth({ clientId, dataPath: this.dataPath }),
        takeoverOnConflict: true,
        takeoverTimeoutMs: process.env.LAMBDA_MODE === 'true' ? 15000 : 5000, // Como venom-bot
        puppeteer: {
          headless: true,
          executablePath: process.env.LAMBDA_MODE === 'true' ? '/usr/bin/chromium' : undefined,
          timeout: process.env.LAMBDA_MODE === 'true' ? 180000 : 120000, // 3 min como venom-bot
          args: process.env.LAMBDA_MODE === 'true' ? argsLambda : argsLocal,
          // Viewport como venom-bot (más pequeño)
          defaultViewport: { width: 1366, height: 768 },
          // Optimizaciones de venom-bot
          ...(process.env.LAMBDA_MODE === 'true' && {
            ignoreDefaultArgs: ['--disable-extensions'],
            devtools: false,
          })
        },
        // Configuración similar a venom-bot
        webVersionCache: {
          type: 'none' // Evita cache de versión web
        },
        // Opcionales, pero útiles para estabilidad
        qrMaxRetries: 5,  // Como venom-bot
        restartOnAuthFail: true,
        takeoverTimeoutMs: process.env.LAMBDA_MODE === 'true' ? 15000 : 5000
      });

      this.setupEventListeners();

      // Inicialización con timeout robusto (como venom-bot)
      this.logger.info('⏱️ Starting WhatsApp client initialization...');
      const initTimeout = process.env.LAMBDA_MODE === 'true' ? 240000 : 180000; // 4 min en Lambda, 3 min local
      
      try {
        await Promise.race([
          this.client.initialize(),
          new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`WhatsApp initialization timeout after ${initTimeout}ms`)), initTimeout)
          )
        ]);
        this.logger.info('✅ Client.initialize() completed successfully');
      } catch (initError) {
        this.logger.error(`❌ Client initialization failed: ${initError.message}`);
        
        // Log additional debug info like venom-bot
        this.logger.debug(`Error details: ${JSON.stringify({
          name: initError.name,
          message: initError.message,
          stack: initError.stack?.split('\n').slice(0, 3).join('\n')
        })}`);
        throw initError;
      }

      // Esperar READY real (si hay QR, puede expirar)
      try {
        await this.waitForReady(process.env.LAMBDA_MODE === 'true' ? 180000 : 120000); // 3 min en Lambda como venom-bot
        this.updateConnectionState(true, 'ready-wait-ok');
        this.logger.info('✅ WhatsApp READY confirmed');
      } catch (waitErr) {
        this.logger.warn(`⚠️ Not READY yet: ${waitErr.message}`);
        
        // Check if authenticated - if so, we might still be able to send messages
        try {
          const state = await this.client.getState().catch(() => null);
          this.logger.info(`🔍 Current state after ready timeout: ${state}`);
          
          if (state === 'CONNECTED') {
            this.logger.info('🔥 WhatsApp shows CONNECTED despite ready timeout - marking as connected');
            this.updateConnectionState(true, 'connected-despite-timeout');
          } else if (state === 'SYNCING' || state === 'OPENING') {
            this.logger.info(`🔄 WhatsApp still ${state} - giving more time before fallback`);
            // Don't mark as connected, but don't fail either
          }
        } catch (stateError) {
          this.logger.debug(`Could not check state after timeout: ${stateError.message}`);
        }
      }

      // Backup de sesión a S3 si estamos conectados o al menos autenticados
      if (await this.isClientSessionUsable()) {
        try {
          this.logger.info('📦 Backing up WhatsApp session to S3...');
          const uploaded = await this.s3SessionManager.uploadSession(clientId, this.sessionDir);
          if (uploaded) this.logger.info('✅ WhatsApp session backed up to S3 successfully');
        } catch (err) {
          this.logger.warn(`⚠️ Failed to backup session: ${err.message}`);
        }
      }

      return true;
    } catch (error) {
      this.logger.error('❌ Failed to initialize WhatsApp client:', error.message);
      return false;
    }
  }

  async isClientSessionUsable() {
    try {
      if (!this.client) return false;
      const st = await this.client.getState().catch(() => null);
      return st === 'CONNECTED';
    } catch {
      return false;
    }
  }

  setupEventListeners() {
    if (!this.client) return;

    // QR: enviar por email (mejorado como venom-bot)
    let qrAttempts = 0;
    this.client.on('qr', async (qr) => {
      qrAttempts++;
      this.logger.info(`📱 QR Code generated (attempt ${qrAttempts}) - sending via email`);
      
      try {
        const qrBuffer = await this.generateQRImage(qr);
        const qrPath = path.join(
            process.env.LAMBDA_MODE === 'true' ? '/tmp' : process.cwd(),
            'temp',
            `qr-${this.sessionName}-${Date.now()}-attempt${qrAttempts}.png`
        );
        await fs.mkdir(path.dirname(qrPath), { recursive: true });
        await fs.writeFile(qrPath, qrBuffer);

        if (this.clientUser.email) {
          // Add attempt info to user config like venom-bot
          const userConfigWithAttempt = {
            ...this.clientUser,
            qrAttempt: qrAttempts,
            sessionName: this.sessionName
          };
          
          const emailSent = await this.emailManager.sendQRCode(qrPath, userConfigWithAttempt);
          if (emailSent) {
            this.logger.info(`✅ QR code sent to ${this.clientUser.email} (attempt ${qrAttempts})`);
          }
        } else {
          this.logger.error('❌ No email configured for WhatsApp client - cannot send QR in Lambda!');
        }

        // Mostrar en consola solo local
        if (!process.env.LAMBDA_MODE) {
          const qrcode = require('qrcode-terminal');
          qrcode.generate(qr, { small: true });
        }

        // Cleanup con timeout más largo como venom-bot
        setTimeout(async () => {
          try { await fs.unlink(qrPath); } catch {}
        }, process.env.LAMBDA_MODE === 'true' ? 60000 : 300000); // 1 min en Lambda
        
      } catch (error) {
        this.logger.error(`❌ Error handling QR code (attempt ${qrAttempts}):`, error.message);
      }
    });

    this.client.on('authenticated', () => {
      this.logger.info('🔐 WhatsApp authenticated');
      // NO marcamos conectado aquí; esperaremos READY real.
    });

    this.client.on('ready', async () => {
      this.logger.info('✅ WhatsApp client is ready!');
      this.updateConnectionState(true, 'client ready');
      this.emit('client-ready');

      // Backup de sesión tras READY
      try {
        const uploaded = await this.s3SessionManager.uploadSession(this.sessionName, this.sessionDir);
        if (uploaded) this.logger.info('✅ Session backed up to S3 after READY');
      } catch (err) {
        this.logger.warn(`⚠️ Failed to backup session after READY: ${err.message}`);
      }
    });

    this.client.on('message', (message) => {
      if (!this.isConnected) {
        this.updateConnectionState(true, 'received message');
        this.emit('client-ready');
      }
      if (this.config.logIncomingMessages) {
        this.logger.info(`Incoming WhatsApp message from ${message.from}: ${message.body}`);
      }
    });

    this.client.on('message_ack', (message, ack) => {
      if (!this.isConnected) {
        this.updateConnectionState(true, 'message acknowledged');
        this.emit('client-ready');
      }
      if (this.config.logMessageStatus) this.logger.debug(`Message ack: ${message.id.id} - ${ack}`);
    });

    this.client.on('disconnected', (reason) => {
      this.logger.warn(`❌ WhatsApp disconnected: ${reason}`);
      this.updateConnectionState(false, `disconnected: ${reason}`);
    });

    this.client.on('auth_failure', (message) => {
      this.logger.error(`❌ WhatsApp authentication failed: ${message}`);
      this.updateConnectionState(false, 'auth failure');
    });
  }

  async checkValidSession(dir) {
    try {
      const entries = await fs.readdir(dir).catch(() => []);
      this.logger.debug(`📁 Session files found in ${dir}: ${entries.length}`);
      return entries.length > 0; // simple: hay algo dentro
    } catch (error) {
      this.logger.debug(`🔍 Session check error: ${error.message}`);
      return false;
    }
  }

  async generateQRImage(qr) {
    const QRCode = require('qrcode');
    return await QRCode.toBuffer(qr, {
      type: 'png',
      width: 256,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' }
    });
  }

  async sendMessage(phoneNumber, message, retryCount = 0) {
    const MAX_RETRIES = 1;
    try {
      if (!this.client) {
        this.logger.error('❌ No WhatsApp client instance');
        return false;
      }

      // Esperar READY si no está conectado aún
      if (!this.isConnected) {
        this.logger.warn('⏳ Waiting for READY before send...');
        await this.waitForReady(60000).catch(() => null); // Más tiempo para Lambda
      }
      
      // Verificar estado real incluso si isConnected es false
      const state = await this.client.getState().catch(() => null);
      this.logger.debug(`🔍 Current state before send: ${state}, isConnected: ${this.isConnected}`);
      
      // Si el estado es CONNECTED pero no estamos marcados como conectado, corregir
      if (state === 'CONNECTED' && !this.isConnected) {
        this.logger.info('🔥 Correcting connection state - client shows CONNECTED');
        this.updateConnectionState(true, 'corrected-before-send');
      }
      
      // Verificar si podemos enviar
      if (!this.isConnected && state !== 'CONNECTED') {
        this.logger.error(`❌ WhatsApp client not ready. State: ${state}, Connected: ${this.isConnected}`);
        return false;
      }

      if (state && state !== 'CONNECTED') {
        this.logger.warn(`⚠️ WhatsApp state is ${state}. Attempting send anyway...`);
      }

      const formattedNumber = this.formatPhoneNumber(phoneNumber);
      const chatId = `${formattedNumber}@c.us`;

      if (typeof this.client.sendMessage !== 'function') {
        this.logger.error('❌ sendMessage function not available on client');
        return false;
      }

      const messageResult = await this.client.sendMessage(chatId, message);
      this.logger.info(`✅ Message sent to ${formattedNumber}`);
      
      // Wait for message delivery confirmation
      if (messageResult && messageResult.id) {
        this.logger.debug(`🔍 Waiting for delivery confirmation for message ${messageResult.id._serialized}...`);
        await this.waitForDeliveryConfirmation(messageResult.id._serialized, 10000);
      } else {
        // Fallback wait if no message ID available
        this.logger.debug(`⏳ Waiting 3 seconds for message delivery...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      return true;

    } catch (error) {
      this.logger.error('❌ Error sending WhatsApp message:', error.message);

      if (retryCount < MAX_RETRIES) {
        this.logger.info(`🔄 Attempting recovery and retry (${retryCount + 1}/${MAX_RETRIES})`);
        const recovered = await this.attemptClientRecovery();
        if (recovered) {
          await new Promise(r => setTimeout(r, 5000));
          return this.sendMessage(phoneNumber, message, retryCount + 1);
        }
      }
      return false;
    }
  }

  async sendMessageToAll(recipients, message) {
    try {
      if (!Array.isArray(recipients)) recipients = [recipients];

      if (!this.client) {
        this.logger.error('❌ WhatsApp client not initialized');
        return { success: 0, failed: recipients.length, results: [] };
      }

      if (!this.isConnected) {
        this.logger.warn('⏳ Waiting for READY before bulk send...');
        await this.waitForReady(30000).catch(() => null);
      }
      if (!this.isConnected) {
        this.logger.error('❌ WhatsApp client not connected');
        return { success: 0, failed: recipients.length, results: [] };
      }

      let results = { success: 0, failed: 0, results: [] };

      for (const recipient of recipients) {
        try {
          const ok = await this.sendMessage(recipient, message);
          if (ok) {
            results.success++;
            results.results.push({ recipient, status: 'sent' });
          } else {
            results.failed++;
            results.results.push({ recipient, status: 'failed', error: 'Send failed' });
          }
          await new Promise(r => setTimeout(r, 1000)); // peq. delay
        } catch (err) {
          results.failed++;
          results.results.push({ recipient, status: 'error', error: err.message });
          this.logger.error(`❌ Error sending to ${recipient}:`, err.message);
        }
      }

      this.logger.info(`📊 Bulk message results: ${results.success} sent, ${results.failed} failed`);
      return results;

    } catch (error) {
      this.logger.error('❌ Error in bulk message sending:', error.message);
      return { success: 0, failed: Array.isArray(recipients) ? recipients.length : 1, results: [], error: error.message };
    }
  }

  isClientAvailable() {
    return this.client && this.isConnected;
  }

  async sendNotificationsSummary(notificationsData) {
    try {
      if (!this.config.enabled) {
        this.logger.info('⚠️ WhatsApp notifications disabled');
        return false;
      }

      const recipients = this.getAllNotificationRecipients();
      if (recipients.length === 0) {
        this.logger.info('⚠️ No notification recipients configured');
        return false;
      }

      let totalSent = 0;
      let totalFailed = 0;

      for (const recipient of recipients) {
        try {
          const result = await this.sendPersonalizedNotifications(recipient, notificationsData);
          if (result.success) totalSent++; else totalFailed++;
        } catch (error) {
          this.logger.error(`❌ Error sending to ${recipient}:`, error.message);
          totalFailed++;
        }
      }

      if (totalSent > 0) {
        this.logger.info(`📱 Personalized notifications sent to ${totalSent}/${recipients.length} recipients`);
        return true;
      } else {
        this.logger.error('❌ Failed to send notifications to any recipients');
        return false;
      }
    } catch (error) {
      this.logger.error('❌ Error sending notifications summary:', error.message);
      return false;
    }
  }

  async sendPersonalizedNotifications(userPhone, allNotifications = null) {
    try {
      // Always use DynamoDB as the source of truth for filtering sent notifications
      const notificationsToSend = await this.dynamoDBManager.getTodaysNotificationsForUser(userPhone);
      
      this.logger.debug(`📋 Found ${notificationsToSend.length} unsent notifications for ${userPhone} from DynamoDB`);

      if (!notificationsToSend || notificationsToSend.length === 0) {
        this.logger.info(`📱 No new notifications to send to ${userPhone}`);
        return { success: true, count: 0 };
      }

      // Format and send the message with the filtered notifications
      const message = this.formatPersonalizedMessage(notificationsToSend, userPhone);

      const sent = await this.sendMessage(userPhone, message);
      if (sent) {
        // Mark all sent notifications as notified in DynamoDB
        for (const notification of notificationsToSend) {
          await this.dynamoDBManager.markUserAsNotified(
            notification.numeroExpediente, 
            notification.numeroNotificacion, 
            userPhone
          );
        }
        this.logger.info(`📱 Sent ${notificationsToSend.length} notifications to ${userPhone}`);
        return { success: true, count: notificationsToSend.length };
      } else {
        return { success: false, count: 0 };
      }
    } catch (error) {
      this.logger.error(`❌ Error sending personalized notifications to ${userPhone}:`, error.message);
      return { success: false, count: 0 };
    }
  }


  getAllNotificationRecipients() {
    let recipients = [];
    if (this.config.notificationPhone && this.config.notificationPhone !== '') recipients.push(this.config.notificationPhone);
    this.notificationRecipients.forEach(r => { if (r.phone && r.receiveNotifications !== false) recipients.push(r.phone); });
    return [...new Set(recipients)];
  }

  formatPersonalizedMessage(notificationsData, userPhone) {
    const header = `🏛️ *SINOE - Notificaciones Electrónicas*\n`;
    const timestamp = `📅 ${new Date().toLocaleString('es-ES', {
      timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    })}\n\n`;
    const summary = `📊 *Resumen:* ${notificationsData.length} notificación(es) nueva(s)\n\n`;

    let details = '';
    notificationsData.slice(0, 20).forEach((n, idx) => {
      const status = '🔴';
      details += `${status} *${idx + 1}.* ${n.numeroNotificacion}\n`;
      details += `📄 Exp: ${n.numeroExpediente}\n`;
      const sum = (n.sumilla || '').toString();
      details += `📋 ${sum.substring(0, 80)}${sum.length > 80 ? '...' : ''}\n`;
      details += `🏢 ${n.oficinaJudicial || ''}\n`;
      details += `📅 ${n.fecha || ''}\n\n`;
    });
    if (notificationsData.length > 20) details += `... y ${notificationsData.length - 20} notificaciones adicionales.\n\n`;

    const footer = `🤖 _Sistema SINOE - Procesamiento automático cada 3 horas_`;
    return header + timestamp + summary + details + footer;
  }

  formatNotificationsMessage(notificationsData) {
    const notificationsWithStatus = notificationsData.map(n => ({
      ...n, wasSent: false, sendDate: null, isProcessed: false
    }));
    return this.formatPersonalizedMessage(notificationsWithStatus, 'sistema');
  }

  formatPhoneNumber(phoneNumber) {
    let formatted = (phoneNumber || '').toString().replace(/\D/g, '');
    if (!formatted.startsWith('51') && formatted.length === 9) formatted = '51' + formatted;
    return formatted;
  }

  getConnectedCount() {
    return this.isConnected ? 1 : 0;
  }

  async close() {
    try {
      this.logger.info('🧹 Closing WhatsApp connection...');

      if (this.verificationInterval) {
        clearInterval(this.verificationInterval);
        this.verificationInterval = null;
        this.logger.info('⏹️ Stopped periodic verification');
      }

      if (this.client) {
        try {
          await this.client.destroy();
          this.logger.info('📱 WhatsApp connection closed');
          // Subir última sesión
          await this.s3SessionManager.uploadSession(this.sessionName, this.sessionDir);
        } catch (error) {
          this.logger.error('❌ Error closing WhatsApp connection:', error.message);
        }
      }

      this.client = null;
      this.isConnected = false;

      await this.emailManager.close();
      await this.dynamoDBManager.close();

      this.isInitialized = false;
      this.logger.info('✅ WhatsApp connection closed');
    } catch (error) {
      this.logger.error('❌ Error closing WhatsApp system:', error.message);
    }
  }

  updateConfig(newConfig, newLogger = null) {
    this.config = newConfig.whatsapp || {};
    this.fullConfig = newConfig;
    if (newLogger) this.logger = newLogger;

    this.clientUser = this.parseClientUser();
    this.notificationRecipients = this.parseRecipients();

    if (this.emailManager) this.emailManager.config = newConfig.email || {};
    if (this.s3SessionManager) this.s3SessionManager.config = newConfig.aws || {};
    if (this.dynamoDBManager) this.dynamoDBManager.config = newConfig.aws || {};

    this.logger.info('🔄 WhatsApp configuration updated');
  }

  setupObservers() {
    this.on('client-connected', () => {
      this.isConnected = true;
      this.logger.info('🎯 Observer: Client marked as CONNECTED');
    });
    this.on('client-disconnected', () => {
      this.isConnected = false;
      this.logger.info('🎯 Observer: Client marked as DISCONNECTED');
    });
    this.on('client-ready', () => {
      this.isConnected = true;
      this.logger.info('🎯 Observer: Client is READY for messaging');
    });
  }

  updateConnectionState(isConnected, reason = 'manual') {
    const old = this.isConnected;
    this.isConnected = isConnected;
    if (old !== isConnected) this.logger.info(`🔄 State change: Client = ${isConnected ? 'CONNECTED' : 'DISCONNECTED'} (${reason})`);
    this.emit(isConnected ? 'client-connected' : 'client-disconnected');
  }

  startPeriodicVerification() {
    if (this.verificationInterval) clearInterval(this.verificationInterval);

    this.verificationInterval = setInterval(async () => {
      try { await this.verifyConnectionStates(); }
      catch (e) { this.logger.error('❌ Error in periodic verification:', e.message); }
    }, 30000);

    setTimeout(async () => {
      try { await this.verifyConnectionStates(); }
      catch (e) { this.logger.error('❌ Error in initial verification:', e.message); }
    }, 10000);

    this.logger.info('🔄 Started periodic connection verification (every 30 seconds)');
  }

  async attemptClientRecovery() {
    try {
      this.logger.info('🔧 Attempting WhatsApp client recovery by full recreation...');
      if (this.client) {
        try {
          this.logger.info('🗑️ Destroying current client...');
          await this.client.destroy();
        } catch (e) {
          this.logger.debug(`Error destroying client: ${e.message}`);
        }
        this.client = null;
      }

      if (this.verificationInterval) {
        clearInterval(this.verificationInterval);
        this.verificationInterval = null;
      }

      this.updateConnectionState(false, 'recreating client');
      await new Promise(r => setTimeout(r, 2000));

      // Re-crear desde cero usando el mismo flujo
      const ok = await this.initializeClient();
      if (ok && this.isConnected) {
        this.logger.info('✅ Client recreation successful');
        this.startPeriodicVerification();
        return true;
      }
      this.logger.warn('⚠️ Client recreation completed but not connected yet');
      this.startPeriodicVerification();
      return false;

    } catch (error) {
      this.logger.error(`❌ Client recreation failed: ${error.message}`);
      this.updateConnectionState(false, 'recreation failed');
      return false;
    }
  }

  async verifyConnectionStates() {
    if (!this.client) return;
    try {
      const state = await this.client.getState().catch(() => null);
      this.logger.debug(`🔍 Current WhatsApp state: ${state}, Current isConnected: ${this.isConnected}`);

      if (state == null) {
        this.logger.debug('🔍 getState returned null/undefined; preserving current connection state');
        return;
      }

      const connected = (state === 'CONNECTED');
      if (connected !== this.isConnected) {
        this.logger.info(`🔍 Verification: Connection state changed from ${this.isConnected} to ${connected} (state: ${state})`);
        this.updateConnectionState(connected, `verification-state: ${state}`);
      }

      // Si dice CONNECTED pero isConnected=false (caso raro), forzar verificación
      if (state === 'CONNECTED' && !this.isConnected) {
        if (typeof this.client.getContacts === 'function') {
          try { await this.client.getContacts(); this.updateConnectionState(true, 'force-verified'); }
          catch { /* mantener estado */ }
        }
      }

    } catch (error) {
      this.logger.debug(`🔍 Verification error: ${error.message}`);
      if (this.isConnected && /Target closed|Session closed/i.test(error.message)) {
        this.logger.warn(`🔍 Verification: Client appears disconnected (${error.message})`);
        this.updateConnectionState(false, 'verification-error');
      }
    }
  }

  getStatus() {
    return {
      enabled: this.config.enabled,
      initialized: this.isInitialized,
      connected: this.isConnected,
      sessionName: this.sessionName,
      clientUser: this.clientUser,
      notificationRecipients: this.notificationRecipients,
      email: this.emailManager.getStatus(),
      s3: this.s3SessionManager.getStatus(),
      dynamodb: this.dynamoDBManager.getStatus()
    };
  }
}

module.exports = WhatsAppManager;
