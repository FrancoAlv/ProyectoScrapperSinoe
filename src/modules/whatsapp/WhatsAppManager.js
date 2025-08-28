// WhatsApp messaging module using venom-bot with single client - Singleton Pattern with Observer
const venom = require('venom-bot');
const EmailManager = require('../email/EmailManager');
const S3SessionManager = require('../storage/S3SessionManager');
const path = require('path');
const EventEmitter = require('events');

class WhatsAppManager extends EventEmitter {
  constructor(config, logger) {
    // Singleton pattern - prevent multiple instances
    if (WhatsAppManager.instance) {
      return WhatsAppManager.instance;
    }

    super(); // Initialize EventEmitter

    this.config = config.whatsapp || {};
    this.fullConfig = config;
    this.logger = logger;
    this.client = null; // Single WhatsApp client
    this.clientUser = this.parseClientUser(); // Single connecting user
    this.notificationRecipients = this.parseRecipients(); // Multiple notification recipients
    this.emailManager = new EmailManager(config, logger);
    this.s3SessionManager = new S3SessionManager(config, logger);
    this.isInitialized = false;
    this.isConnected = false;

    // Store the singleton instance
    WhatsAppManager.instance = this;

    // Set up observers for connection events
    this.setupObservers();
  }

  parseClientUser() {
    try {
      // Use config first, then environment variable as fallback
      if (this.config.clientUser) {
        return this.config.clientUser;
      }
      // Fallback to environment variable
      if (process.env.WHATSAPP_CLIENT_USER) {
        return JSON.parse(process.env.WHATSAPP_CLIENT_USER);
      }
      return { name: 'main', phone: '', email: '' };
    } catch {
      return { name: 'main', phone: '', email: '' };
    }
  }

  parseRecipients() {
    try {
      // Use config first, then environment variable as fallback
      if (this.config.recipients && this.config.recipients.length > 0) {
        return this.config.recipients;
      }
      // Fallback to environment variable
      if (process.env.WHATSAPP_RECIPIENTS) {
        return JSON.parse(process.env.WHATSAPP_RECIPIENTS);
      }
      return [];
    } catch {
      return [];
    }
  }

  // Static method to get the singleton instance
  static getInstance(config = null, logger = null) {
    if (!WhatsAppManager.instance) {
      if (!config || !logger) {
        throw new Error('WhatsAppManager requires config and logger for first initialization');
      }
      WhatsAppManager.instance = new WhatsAppManager(config, logger);
    }
    return WhatsAppManager.instance;
  }

  // Static method to check if instance exists
  static hasInstance() {
    return !!WhatsAppManager.instance;
  }

  // Static method to destroy the singleton instance
  static async destroyInstance() {
    if (WhatsAppManager.instance) {
      await WhatsAppManager.instance.close();
      WhatsAppManager.instance = null;
    }
  }

  async initialize() {
    try {
      this.logger.info('🚀 Initializing WhatsApp system...');
      
      if (!this.config.enabled) {
        this.logger.info('⚠️ WhatsApp is disabled in configuration');
        return false;
      }

      // Debug configurations
      this.logger.debug('🔧 Full config passed to WhatsApp:', {
        whatsappEnabled: this.config.enabled,
        emailEnabled: this.fullConfig.email?.enabled,
        s3Enabled: this.fullConfig.aws?.enabled,
        recipientsCount: this.notificationRecipients.length
      });

      // Initialize email and S3 services
      const emailInitialized = await this.emailManager.initialize();
      this.logger.debug(`📧 Email initialization result: ${emailInitialized}`);
      
      const s3Initialized = await this.s3SessionManager.initialize();
      this.logger.debug(`☁️ S3 initialization result: ${s3Initialized}`);

      // Initialize single WhatsApp client
      const clientInitialized = await this.initializeClient();
      
      this.isInitialized = clientInitialized;
      this.logger.info(`✅ WhatsApp system initialized: ${clientInitialized ? 'Connected' : 'Failed'}`);
      
      // Start periodic connection verification
      if (this.isInitialized) {
        this.startPeriodicVerification();
      }
      
      return this.isInitialized;
    } catch (error) {
      this.logger.error('❌ Failed to initialize WhatsApp system:', error.message);
      this.isInitialized = false;
      return false;
    }
  }

  async initializeClient() {
    try {
      this.logger.info(`🚀 Initializing WhatsApp client...`);
      
      const sessionName = `${this.config.sessionPrefix || 'sinoe'}-main`;
      const sessionPath = path.join(process.env.LAMBDA_MODE === 'true' ? '/tmp' : process.cwd(), 'tokens', sessionName);

      // Try to download session from S3 if available
      await this.s3SessionManager.downloadSession(sessionName, sessionPath);

      const client = await venom.create({
        session: sessionName,
        multidevice: true,
        headless: this.config.headless !== false, // Use config setting
        devtools: false,
        useChrome: true,
        debug: false,
        logQR: false, // We'll handle QR manually
        browserArgs: process.env.LAMBDA_MODE === 'true' ? [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI',
          '--disable-extensions',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--no-first-run',
          '--no-zygote',
          '--memory-pressure-off',
          '--max_old_space_size=512',
          '--disable-ipc-flooding-protection'
        ] : [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'
        ],
        refreshQR: 30000, // Refresh QR every 30 seconds (longer interval)
        autoClose: 0, // NEVER auto close - sesiones permanentes
        disableSpins: true, // Disable loading spinners in headless
        createPathFileToken: true,
        folderNameToken: process.env.LAMBDA_MODE === 'true' ? '/tmp/tokens' : './tokens',
        // Custom QR handler
        catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
          this.handleQRCode(base64Qr, sessionName, attempts);
        },
        statusFind: (statusSession, session) => {
          this.handleStatusChange(statusSession, session);
        },
        // Puppeteer options for both Lambda and local environments
        puppeteerOptions: {
          headless: this.config.headless !== false,
          executablePath: process.env.LAMBDA_MODE === 'true' ? '/usr/bin/chromium' : undefined,
          timeout: 60000,
          args: process.env.LAMBDA_MODE === 'true' ? [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-extensions',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--no-first-run',
            '--no-zygote',
            '--memory-pressure-off',
            '--max_old_space_size=512',
            '--disable-ipc-flooding-protection'
          ] : [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
          ]
        }
      });

      if (client) {
        this.client = client;
        this.sessionName = sessionName;
        this.isConnected = false;

        this.setupEventListeners(client);
        
        // AGGRESSIVE: Monitor console output for connection status
        this.setupConsoleMonitoring();
        
        // Force check connection status after a delay using observer pattern
        setTimeout(async () => {
          try {
            // First try the official method
            const isReady = await client.isConnected();
            if (isReady) {
              this.updateConnectionState(true, 'timeout verification');
              this.emit('client-ready');
              return;
            }
          } catch (error) {
            this.logger.debug(`Main client - isConnected() error:`, error.message);
          }
          
          // FALLBACK: If we have a client instance and it's been 3+ seconds, assume connected
          // This is because venom-bot often shows "Successfully connected!" but isConnected() fails
          if (client) {
            this.updateConnectionState(true, 'aggressive fallback - client exists');
            this.emit('client-ready');
            this.logger.info(`🔥 Main client - FORCED connection state (venom-bot quirk)`);
          }
        }, 4000); // 4 seconds to allow full initialization
        
        this.logger.info(`✅ WhatsApp client initialized successfully`);
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger.error(`❌ Failed to initialize WhatsApp client:`, error.message);
      return false;
    }
  }

  async handleQRCode(base64Qr, sessionName, attempts) {
    try {
      this.logger.info(`📱 QR Code generated (attempt ${attempts})`);
      
      // Convert base64 to file
      const qrBuffer = Buffer.from(base64Qr.split(',')[1], 'base64');
      const qrPath = path.join(process.env.LAMBDA_MODE === 'true' ? '/tmp' : process.cwd(), 'temp', `qr-${sessionName}-${Date.now()}.png`);
      
      // Ensure temp directory exists
      const fs = require('fs').promises;
      await fs.mkdir(path.dirname(qrPath), { recursive: true });
      await fs.writeFile(qrPath, qrBuffer);

      // Send QR via email if configured
      if (this.clientUser.email) {
        const emailSent = await this.emailManager.sendQRCode(qrPath, this.clientUser);
        if (emailSent) {
          this.logger.info(`📧 QR code sent to ${this.clientUser.email}`);
        }
      } else {
        this.logger.warn(`⚠️ No email configured for WhatsApp client`);
      }

      // Clean up QR file after a delay
      setTimeout(async () => {
        try {
          await fs.unlink(qrPath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }, 300000); // 5 minutes

    } catch (error) {
      this.logger.error(`❌ Error handling QR code:`, error.message);
    }
  }

  async handleStatusChange(statusSession, session) {
    if (!this.client) return;

    this.logger.info(`📱 WhatsApp status: ${statusSession}`);
    
    // List of statuses that indicate connection
    const connectedStatuses = [
      'successChat',
      'Connected', 
      'isLogged',
      'QRCode Success',
      'Checking phone is connected',
      'Successfully connected',
      'Successfully main page'
    ];
    
    // Check if current status indicates connection
    const isConnectedStatus = connectedStatuses.some(status => 
      statusSession.includes(status) || statusSession === status
    );
    
    if (isConnectedStatus) {
      // Use observer pattern to update connection state
      this.updateConnectionState(true, `status: ${statusSession}`);
      
      // Emit ready event for important statuses
      if (statusSession === 'Connected' || statusSession === 'Successfully connected!') {
        this.emit('client-ready');
      }
      
      // Upload session to S3 only for major connection events
      if (statusSession === 'Connected' || statusSession === 'successChat') {
        const sessionPath = path.join(process.env.LAMBDA_MODE === 'true' ? '/tmp' : process.cwd(), 'tokens', this.sessionName);
        await this.s3SessionManager.uploadSession(this.sessionName, sessionPath);
      }
    }
    
    // Handle disconnection statuses
    const disconnectedStatuses = ['notLogged', 'browserClose', 'Was disconnected'];
    const isDisconnectedStatus = disconnectedStatuses.some(status => 
      statusSession.includes(status) || statusSession === status
    );
    
    if (isDisconnectedStatus) {
      // Don't mark as disconnected for temporary disconnections during sync
      if (!statusSession.includes('Disconnected by cell phone')) {
        this.updateConnectionState(false, `status: ${statusSession}`);
      }
    }
  }

  setupEventListeners(client) {
    if (!client) return;

    client.onStateChange((state) => {
      this.logger.info(`WhatsApp state changed: ${state}`);
      
      // More comprehensive connection detection
      const connectedStates = [
        'CONNECTED', 'PAIRING', 'UNPAIRED', 'SYNCING', 'OPENING',
        'MAIN', 'CHAT', 'LOADING_SCREEN'
      ];
      
      const isConnected = connectedStates.includes(state);
      
      if (isConnected) {
        this.updateConnectionState(true, `state: ${state}`);
        this.emit('client-ready');
      } else if (state === 'CONFLICT' || state === 'UNLAUNCHED') {
        this.updateConnectionState(false, `state: ${state}`);
      }
    });

    client.onMessage((message) => {
      // If we can receive messages, we're definitely connected
      if (!this.isConnected) {
        this.updateConnectionState(true, 'received message');
        this.emit('client-ready');
      }
      
      if (this.config.logIncomingMessages) {
        this.logger.info(`Incoming WhatsApp message from ${message.from}: ${message.body}`);
      }
    });

    client.onAck((ackEvent) => {
      // If we can send messages (get acks), we're connected
      if (!this.isConnected) {
        this.updateConnectionState(true, 'message acknowledged');
        this.emit('client-ready');
      }
      
      if (this.config.logMessageStatus) {
        this.logger.debug(`Message status: ${ackEvent.id} - ${ackEvent.ack}`);
      }
    });
  }

  async sendMessage(phoneNumber, message) {
    try {
      if (!this.client || !this.isConnected) {
        this.logger.error('❌ WhatsApp client not connected. Cannot send message.');
        return false;
      }

      // Format phone number (ensure it has country code)
      const formattedNumber = this.formatPhoneNumber(phoneNumber);
      
      const result = await this.client.sendText(formattedNumber, message);
      
      if (result) {
        this.logger.info(`✅ Message sent to ${formattedNumber}`);
        return true;
      } else {
        this.logger.error(`❌ Failed to send message to ${formattedNumber}`);
        return false;
      }
    } catch (error) {
      this.logger.error('❌ Error sending WhatsApp message:', error.message);
      return false;
    }
  }

  async sendMessageToAll(recipients, message) {
    try {
      if (!Array.isArray(recipients)) {
        recipients = [recipients];
      }

      if (!this.client || !this.isConnected) {
        this.logger.error('❌ WhatsApp client not connected');
        return { success: 0, failed: recipients.length, results: [] };
      }

      let results = { success: 0, failed: 0, results: [] };
      
      // Send messages to all recipients
      for (const recipient of recipients) {
        try {
          const success = await this.sendMessage(recipient, message);
          
          if (success) {
            results.success++;
            results.results.push({
              recipient: recipient,
              status: 'sent'
            });
          } else {
            results.failed++;
            results.results.push({
              recipient: recipient,
              status: 'failed',
              error: 'Send failed'
            });
          }
          
          // Small delay between messages
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          results.failed++;
          results.results.push({
            recipient: recipient,
            status: 'error',
            error: error.message
          });
          this.logger.error(`❌ Error sending to ${recipient}:`, error.message);
        }
      }

      this.logger.info(`📊 Bulk message results: ${results.success} sent, ${results.failed} failed`);
      return results;
      
    } catch (error) {
      this.logger.error('❌ Error in bulk message sending:', error.message);
      return { success: 0, failed: recipients.length, results: [], error: error.message };
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

      if (!notificationsData || notificationsData.length === 0) {
        this.logger.info('📱 No notifications to send via WhatsApp');
        return false;
      }

      // Filter only CLOSED notifications
      const closedNotifications = notificationsData.filter(notification => 
        notification.estado === 'CERRADA'
      );

      if (closedNotifications.length === 0) {
        this.logger.info('📱 No closed notifications found - WhatsApp message not sent');
        return false;
      }

      const message = this.formatNotificationsMessage(closedNotifications);
      
      // Send to all configured notification recipients
      const recipients = this.getAllNotificationRecipients();
      if (recipients.length === 0) {
        this.logger.info('⚠️ No notification recipients configured');
        return false;
      }

      const results = await this.sendMessageToAll(recipients, message);
      
      if (results.success > 0) {
        this.logger.info(`📱 Notifications summary sent to ${results.success}/${recipients.length} recipients (${closedNotifications.length} closed records)`);
        return true;
      } else {
        this.logger.error(`❌ Failed to send notifications to any recipients`);
        return false;
      }
    } catch (error) {
      this.logger.error('❌ Error sending notifications summary:', error.message);
      return false;
    }
  }

  getAllNotificationRecipients() {
    let recipients = [];
    
    // Add main notification phone if configured
    if (this.config.notificationPhone) {
      recipients.push(this.config.notificationPhone);
    }
    
    // Add all configured notification recipients
    this.notificationRecipients.forEach(recipient => {
      if (recipient.phone && recipient.receiveNotifications !== false) {
        recipients.push(recipient.phone);
      }
    });
    
    // Remove duplicates
    return [...new Set(recipients)];
  }

  formatNotificationsMessage(notificationsData) {
    const header = `🏛️ *SINOE - Notificaciones Electrónicas*\n`;
    const timestamp = `📅 ${new Date().toLocaleString('es-ES', { 
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })}\n\n`;
    
    const summary = `📊 *Resumen:* ${notificationsData.length} notificación(es) encontrada(s)\n\n`;
    
    let details = '';
    notificationsData.slice(0, 30).forEach((notification, index) => { // Limit to 30 notifications
      const status = notification.estado === 'CERRADA' ? '🔴' : '🟢';
      details += `${status} *${index + 1}.* ${notification.numeroNotificacion}\n`;
      details += `📄 Exp: ${notification.numeroExpediente}\n`;
      details += `📋 ${notification.sumilla.substring(0, 50)}${notification.sumilla.length > 50 ? '...' : ''}\n`;
      details += `🏢 ${notification.oficinaJudicial}\n`;
      details += `📅 ${notification.fecha}\n\n`;
    });
    
    if (notificationsData.length > 30) {
      details += `... y ${notificationsData.length - 30} más.\n\n`;
    }
    
    const footer = `🤖 _Generado automáticamente por el sistema SINOE_`;
    
    return header + timestamp + summary + details + footer;
  }

  formatPhoneNumber(phoneNumber) {
    // Remove all non-numeric characters
    let formatted = phoneNumber.replace(/\D/g, '');
    
    // If it doesn't start with country code, assume Peru (+51)
    if (!formatted.startsWith('51') && formatted.length === 9) {
      formatted = '51' + formatted;
    }
    
    // Add @c.us suffix for WhatsApp
    return formatted + '@c.us';
  }

  async sendTestMessage() {
    try {
      if (!this.config.testPhone) {
        this.logger.error('❌ No test phone configured for WhatsApp');
        return false;
      }

      const testMessage = `🧪 *Test Message*\n\nWhatsApp single client system is working!\n\n📱 Client status: ${this.isConnected ? 'Connected' : 'Disconnected'}\n\n📅 ${new Date().toLocaleString('es-ES', { timeZone: 'America/Lima' })}\n\n🤖 _SINOE Notification System_`;
      
      return await this.sendMessage(this.config.testPhone, testMessage);
    } catch (error) {
      this.logger.error('❌ Error sending test message:', error.message);
      return false;
    }
  }

  getConnectedCount() {
    return this.isConnected ? 1 : 0;
  }

  async close() {
    try {
      this.logger.info('🧹 Closing WhatsApp connection...');
      
      // Clear verification interval
      if (this.verificationInterval) {
        clearInterval(this.verificationInterval);
        this.verificationInterval = null;
        this.logger.info('⏹️ Stopped periodic verification');
      }
      
      if (this.client) {
        try {
          await this.client.close();
          this.logger.info(`📱 WhatsApp connection closed`);
          
          // Upload final session to S3
          const sessionPath = path.join(process.env.LAMBDA_MODE === 'true' ? '/tmp' : process.cwd(), 'tokens', this.sessionName);
          await this.s3SessionManager.uploadSession(this.sessionName, sessionPath);
        } catch (error) {
          this.logger.error(`❌ Error closing WhatsApp connection:`, error.message);
        }
      }
      
      this.client = null;
      this.isConnected = false;
      
      // Close email and S3 services
      await this.emailManager.close();
      
      this.isInitialized = false;
      this.logger.info('✅ WhatsApp connection closed');
    } catch (error) {
      this.logger.error('❌ Error closing WhatsApp system:', error.message);
    }
  }

  // Method to update configuration (useful for singleton pattern)
  updateConfig(newConfig, newLogger = null) {
    this.config = newConfig.whatsapp || {};
    this.fullConfig = newConfig;
    if (newLogger) {
      this.logger = newLogger;
    }
    this.clientUser = this.parseClientUser();
    this.notificationRecipients = this.parseRecipients();
    
    // Update sub-managers with new config
    if (this.emailManager) {
      this.emailManager.config = newConfig.email || {};
    }
    if (this.s3SessionManager) {
      this.s3SessionManager.config = newConfig.aws || {};
    }
    
    this.logger.info('🔄 WhatsApp configuration updated');
  }

  // Method to reset the singleton (useful for testing or reconfiguration)
  static reset() {
    WhatsAppManager.instance = null;
  }

  setupConsoleMonitoring() {
    // Store original console methods
    const originalConsoleLog = console.log;
    const originalConsoleInfo = console.info;
    
    // Connection detection patterns
    const connectionPatterns = [
      /Successfully connected!/i,
      /\[instance: .+\]: Connected/i,
      /WhatsApp connection established/i,
      /Ready to send messages/i,
      /QRCode Success/i,
      /isLogged/i
    ];
    
    const disconnectionPatterns = [
      /Was disconnected/i,
      /Connection lost/i,
      /browserClose/i,
      /notLogged/i
    ];
    
    // Console interceptor
    const interceptConsole = (originalMethod, level) => {
      return (...args) => {
        const message = args.join(' ');
        
        // Check for connection patterns
        if (connectionPatterns.some(pattern => pattern.test(message))) {
          // Check if message relates to our session
          if (message.includes(this.sessionName) || message.includes('sinoe-main')) {
            setTimeout(() => {
              this.logger.info(`🎯 Console Monitor: Detected connection`);
              this.updateConnectionState(true, 'console-detected');
            }, 500);
          }
        }
        
        // Check for disconnection patterns
        if (disconnectionPatterns.some(pattern => pattern.test(message))) {
          if (message.includes(this.sessionName) || message.includes('sinoe-main')) {
            setTimeout(() => {
              this.logger.warn(`🎯 Console Monitor: Detected disconnection`);
              this.updateConnectionState(false, 'console-detected');
            }, 500);
          }
        }
        
        // Call original method
        return originalMethod.apply(console, args);
      };
    };
    
    // Override console methods if not already overridden
    if (!console.log.__intercepted) {
      console.log = interceptConsole(originalConsoleLog, 'log');
      console.log.__intercepted = true;
      console.log.__originalMethod = originalConsoleLog;
    }
    
    if (!console.info.__intercepted) {
      console.info = interceptConsole(originalConsoleInfo, 'info');
      console.info.__intercepted = true;
      console.info.__originalMethod = originalConsoleInfo;
    }
    
    this.logger.info(`🎯 Console monitoring setup for main client`);
  }

  setupObservers() {
    // Listen for connection state changes
    this.on('client-connected', () => {
      this.isConnected = true;
      this.logger.info(`🎯 Observer: Client marked as CONNECTED`);
    });

    this.on('client-disconnected', () => {
      this.isConnected = false;
      this.logger.info(`🎯 Observer: Client marked as DISCONNECTED`);
    });

    this.on('client-ready', () => {
      this.isConnected = true;
      this.logger.info(`🎯 Observer: Client is READY for messaging`);
    });
  }

  // Force update connection state
  updateConnectionState(isConnected, reason = 'manual') {
    const oldState = this.isConnected;
    this.isConnected = isConnected;
    
    // Only log if state actually changed
    if (oldState !== isConnected) {
      this.logger.info(`🔄 State change: Client = ${isConnected ? 'CONNECTED' : 'DISCONNECTED'} (${reason})`);
    }
    
    // Emit event
    this.emit(isConnected ? 'client-connected' : 'client-disconnected');
  }

  // Start periodic verification of connection states
  startPeriodicVerification() {
    // Run verification every 30 seconds
    this.verificationInterval = setInterval(async () => {
      try {
        await this.verifyConnectionStates();
      } catch (error) {
        this.logger.error('❌ Error in periodic verification:', error.message);
      }
    }, 30000); // 30 seconds
    
    // Also run immediate verification after 10 seconds
    setTimeout(async () => {
      try {
        await this.verifyConnectionStates();
      } catch (error) {
        this.logger.error('❌ Error in initial verification:', error.message);
      }
    }, 10000);
    
    this.logger.info('🔄 Started periodic connection verification (every 30 seconds)');
  }

  // Aggressive connection state verification
  async verifyConnectionStates() {
    if (!this.client) return;
    
    try {
      // Try to get connection state from venom-bot
      const hostDevice = await this.client.getHostDevice();
      if (hostDevice && hostDevice.connected) {
        if (!this.isConnected) {
          this.logger.info(`🔍 Verification: Client is actually CONNECTED (hostDevice check)`);
          this.updateConnectionState(true, 'verification-hostDevice');
        }
      }
    } catch (error) {
      // Ignore errors, this is just verification
    }
    
    try {
      // Alternative: Check if we can get WhatsApp Web info
      const isConnectedCheck = await this.client.isConnected();
      if (isConnectedCheck !== this.isConnected) {
        this.logger.info(`🔍 Verification: Client connection state mismatch - updating to ${isConnectedCheck}`);
        this.updateConnectionState(isConnectedCheck, 'verification-isConnected');
      }
    } catch (error) {
      // If client methods fail, it's likely disconnected
      if (this.isConnected) {
        this.logger.warn(`🔍 Verification: Client appears disconnected (client error)`);
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
      s3: this.s3SessionManager.getStatus()
    };
  }
}

module.exports = WhatsAppManager;