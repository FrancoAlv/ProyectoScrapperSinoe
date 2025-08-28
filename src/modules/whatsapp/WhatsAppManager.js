// WhatsApp messaging module using venom-bot with multi-user support - Singleton Pattern with Observer
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
    this.clients = new Map(); // Store multiple client instances
    this.users = this.config.users || [];
    this.emailManager = new EmailManager(config, logger);
    this.s3SessionManager = new S3SessionManager(config, logger);
    this.isInitialized = false;
    this.connectionStates = new Map(); // Track connection states

    // Store the singleton instance
    WhatsAppManager.instance = this;

    // Set up observers for connection events
    this.setupObservers();
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
      this.logger.info('🚀 Initializing WhatsApp multi-user system...');
      
      if (!this.config.enabled) {
        this.logger.info('⚠️ WhatsApp is disabled in configuration');
        return false;
      }

      if (!this.users || this.users.length === 0) {
        this.logger.error('❌ No WhatsApp users configured');
        return false;
      }

      // Debug configurations
      this.logger.debug('🔧 Full config passed to WhatsApp:', {
        whatsappEnabled: this.config.enabled,
        emailEnabled: this.fullConfig.email?.enabled,
        s3Enabled: this.fullConfig.aws?.enabled,
        usersCount: this.users.length
      });

      // Initialize email and S3 services
      const emailInitialized = await this.emailManager.initialize();
      this.logger.debug(`📧 Email initialization result: ${emailInitialized}`);
      
      const s3Initialized = await this.s3SessionManager.initialize();
      this.logger.debug(`☁️ S3 initialization result: ${s3Initialized}`);

      // Initialize each user's WhatsApp client
      const initPromises = this.users.map(user => this.initializeUserClient(user));
      const results = await Promise.allSettled(initPromises);

      let successCount = 0;
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          successCount++;
        } else {
          this.logger.error(`❌ Failed to initialize client for user: ${this.users[index].name}`);
        }
      });

      this.isInitialized = successCount > 0;
      this.logger.info(`✅ WhatsApp system initialized: ${successCount}/${this.users.length} clients ready`);
      
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

  async initializeUserClient(user) {
    try {
      this.logger.info(`🚀 Initializing WhatsApp for user: ${user.name}`);
      
      const sessionName = `${this.config.sessionPrefix || 'sinoe'}-${user.name}`;
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
        // Lambda-specific Puppeteer options
        puppeteerOptions: {
          headless: this.config.headless !== false,
          executablePath: process.env.LAMBDA_MODE === 'true' ? '/usr/bin/chromium' : undefined,
          timeout: 60000,
          args: process.env.LAMBDA_MODE === 'true' ? [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--memory-pressure-off',
            '--max_old_space_size=512'
          ] : []
        },
        // Custom QR handler
        catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
          this.handleQRCode(user, base64Qr, sessionName, attempts);
        },
        statusFind: (statusSession, session) => {
          this.handleStatusChange(user, statusSession, session);
        },
        // Additional options for persistent sessions
        puppeteerOptions: {
          headless: this.config.headless !== false,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection'
          ]
        }
      });

      if (client) {
        this.clients.set(user.name, {
          client: client,
          user: user,
          sessionName: sessionName,
          isConnected: false
        });

        this.setupUserEventListeners(user, client);
        
        // AGGRESSIVE: Monitor console output for connection status
        this.setupConsoleMonitoring(user.name);
        
        // Force check connection status after a delay using observer pattern
        setTimeout(async () => {
          try {
            // First try the official method
            const isReady = await client.isConnected();
            if (isReady) {
              this.updateConnectionState(user.name, true, 'timeout verification');
              this.emit('client-ready', user.name);
              return;
            }
          } catch (error) {
            this.logger.debug(`${user.name} - isConnected() error:`, error.message);
          }
          
          // FALLBACK: If we have a client instance and it's been 3+ seconds, assume connected
          // This is because venom-bot often shows "Successfully connected!" but isConnected() fails
          if (client) {
            this.updateConnectionState(user.name, true, 'aggressive fallback - client exists');
            this.emit('client-ready', user.name);
            this.logger.info(`🔥 ${user.name} - FORCED connection state (venom-bot quirk)`);
          }
        }, 4000); // 4 seconds to allow full initialization
        
        this.logger.info(`✅ Client initialized for user: ${user.name}`);
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger.error(`❌ Failed to initialize client for ${user.name}:`, error.message);
      return false;
    }
  }

  async handleQRCode(user, base64Qr, sessionName, attempts) {
    try {
      this.logger.info(`📱 QR Code generated for ${user.name} (attempt ${attempts})`);
      
      // Convert base64 to file
      const qrBuffer = Buffer.from(base64Qr.split(',')[1], 'base64');
      const qrPath = path.join(process.env.LAMBDA_MODE === 'true' ? '/tmp' : process.cwd(), 'temp', `qr-${sessionName}-${Date.now()}.png`);
      
      // Ensure temp directory exists
      const fs = require('fs').promises;
      await fs.mkdir(path.dirname(qrPath), { recursive: true });
      await fs.writeFile(qrPath, qrBuffer);

      // Send QR via email if configured
      if (user.email) {
        const emailSent = await this.emailManager.sendQRCode(qrPath, user);
        if (emailSent) {
          this.logger.info(`📧 QR code sent to ${user.email} for user: ${user.name}`);
        }
      } else {
        this.logger.warn(`⚠️ No email configured for user: ${user.name}`);
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
      this.logger.error(`❌ Error handling QR code for ${user.name}:`, error.message);
    }
  }

  async handleStatusChange(user, statusSession, session) {
    const clientData = this.clients.get(user.name);
    if (!clientData) return;

    this.logger.info(`📱 ${user.name} - WhatsApp status: ${statusSession}`);
    
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
      this.updateConnectionState(user.name, true, `status: ${statusSession}`);
      
      // Emit ready event for important statuses
      if (statusSession === 'Connected' || statusSession === 'Successfully connected!') {
        this.emit('client-ready', user.name);
      }
      
      // Upload session to S3 only for major connection events
      if (statusSession === 'Connected' || statusSession === 'successChat') {
        const sessionPath = path.join(process.env.LAMBDA_MODE === 'true' ? '/tmp' : process.cwd(), 'tokens', clientData.sessionName);
        await this.s3SessionManager.uploadSession(clientData.sessionName, sessionPath);
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
        this.updateConnectionState(user.name, false, `status: ${statusSession}`);
      }
    }
  }

  setupUserEventListeners(user, client) {
    if (!client) return;

    client.onStateChange((state) => {
      this.logger.info(`${user.name} - WhatsApp state changed: ${state}`);
      
      // More comprehensive connection detection
      const connectedStates = [
        'CONNECTED', 'PAIRING', 'UNPAIRED', 'SYNCING', 'OPENING',
        'MAIN', 'CHAT', 'LOADING_SCREEN'
      ];
      
      const isConnected = connectedStates.includes(state);
      
      if (isConnected) {
        this.updateConnectionState(user.name, true, `state: ${state}`);
        this.emit('client-ready', user.name);
      } else if (state === 'CONFLICT' || state === 'UNLAUNCHED') {
        this.updateConnectionState(user.name, false, `state: ${state}`);
      }
    });

    client.onMessage((message) => {
      // If we can receive messages, we're definitely connected
      const clientData = this.clients.get(user.name);
      if (clientData && !clientData.isConnected) {
        this.updateConnectionState(user.name, true, 'received message');
        this.emit('client-ready', user.name);
      }
      
      if (this.config.logIncomingMessages) {
        this.logger.info(`${user.name} - Incoming WhatsApp message from ${message.from}: ${message.body}`);
      }
    });

    client.onAck((ackEvent) => {
      // If we can send messages (get acks), we're connected
      const clientData = this.clients.get(user.name);
      if (clientData && !clientData.isConnected) {
        this.updateConnectionState(user.name, true, 'message acknowledged');
        this.emit('client-ready', user.name);
      }
      
      if (this.config.logMessageStatus) {
        this.logger.debug(`${user.name} - Message status: ${ackEvent.id} - ${ackEvent.ack}`);
      }
    });
  }

  async sendMessage(phoneNumber, message, userName = null) {
    try {
      // Get a connected client (specific user or first available)
      const clientData = this.getAvailableClient(userName);
      if (!clientData) {
        this.logger.error('❌ No WhatsApp clients connected. Cannot send message.');
        return false;
      }

      // Format phone number (ensure it has country code)
      const formattedNumber = this.formatPhoneNumber(phoneNumber);
      
      const result = await clientData.client.sendText(formattedNumber, message);
      
      if (result) {
        this.logger.info(`✅ Message sent via ${clientData.user.name} to ${formattedNumber}`);
        return true;
      } else {
        this.logger.error(`❌ Failed to send message via ${clientData.user.name} to ${formattedNumber}`);
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

      const connectedClients = Array.from(this.clients.values()).filter(c => c.isConnected);
      if (connectedClients.length === 0) {
        this.logger.error('❌ No WhatsApp clients connected');
        return { success: 0, failed: recipients.length, results: [] };
      }

      let results = { success: 0, failed: 0, results: [] };
      
      // Distribute messages across available clients
      for (let i = 0; i < recipients.length; i++) {
        const clientData = connectedClients[i % connectedClients.length];
        const recipient = recipients[i];
        
        try {
          const formattedNumber = this.formatPhoneNumber(recipient);
          const result = await clientData.client.sendText(formattedNumber, message);
          
          if (result) {
            results.success++;
            results.results.push({
              recipient: recipient,
              status: 'sent',
              client: clientData.user.name
            });
            this.logger.info(`✅ Message sent via ${clientData.user.name} to ${recipient}`);
          } else {
            results.failed++;
            results.results.push({
              recipient: recipient,
              status: 'failed',
              client: clientData.user.name,
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
            client: clientData.user.name,
            error: error.message
          });
          this.logger.error(`❌ Error sending to ${recipient} via ${clientData.user.name}:`, error.message);
        }
      }

      this.logger.info(`📊 Bulk message results: ${results.success} sent, ${results.failed} failed`);
      return results;
      
    } catch (error) {
      this.logger.error('❌ Error in bulk message sending:', error.message);
      return { success: 0, failed: recipients.length, results: [], error: error.message };
    }
  }

  getAvailableClient(userName = null) {
    this.logger.debug(`🔍 Looking for available client (userName: ${userName || 'any'})`);
    
    // Debug all clients status
    for (const [name, clientData] of this.clients.entries()) {
      this.logger.debug(`Client ${name}: isConnected=${clientData.isConnected}, hasClient=${!!clientData.client}`);
    }
    
    if (userName) {
      const clientData = this.clients.get(userName);
      const available = (clientData && clientData.isConnected) ? clientData : null;
      this.logger.debug(`Specific client ${userName}: ${available ? 'available' : 'not available'}`);
      return available;
    }
    
    // Return first connected client
    for (const [name, clientData] of this.clients.entries()) {
      if (clientData.isConnected) {
        this.logger.debug(`Found available client: ${name}`);
        return clientData;
      }
    }
    
    this.logger.debug(`No available clients found`);
    return null;
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

      // Filter only OPEN notifications
      const openNotifications = notificationsData.filter(notification => 
        notification.estado === 'ABIERTA'
      );

      if (openNotifications.length === 0) {
        this.logger.info('📱 No open notifications found - WhatsApp message not sent');
        return false;
      }

      const message = this.formatNotificationsMessage(openNotifications);
      
      // Send to all configured notification recipients
      const recipients = this.getAllNotificationRecipients();
      if (recipients.length === 0) {
        this.logger.info('⚠️ No notification recipients configured');
        return false;
      }

      const results = await this.sendMessageToAll(recipients, message);
      
      if (results.success > 0) {
        this.logger.info(`📱 Notifications summary sent to ${results.success}/${recipients.length} recipients (${openNotifications.length} open records)`);
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
    
    // Add user phones that want notifications
    this.users.forEach(user => {
      if (user.receiveNotifications && user.phone) {
        recipients.push(user.phone);
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
    notificationsData.slice(0, 30).forEach((notification, index) => { // Limit to 10 notifications
      const status = notification.estado === 'ABIERTA' ? '🟢' : '🔴';
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

      const testMessage = `🧪 *Test Message*\n\nWhatsApp multi-user system is working!\n\n📱 Connected clients: ${this.getConnectedCount()}/${this.users.length}\n\n📅 ${new Date().toLocaleString('es-ES', { timeZone: 'America/Lima' })}\n\n🤖 _SINOE Notification System_`;
      
      return await this.sendMessage(this.config.testPhone, testMessage);
    } catch (error) {
      this.logger.error('❌ Error sending test message:', error.message);
      return false;
    }
  }

  getConnectedCount() {
    return Array.from(this.clients.values()).filter(c => c.isConnected).length;
  }

  async close() {
    try {
      this.logger.info('🧹 Closing all WhatsApp connections...');
      
      // Clear verification interval
      if (this.verificationInterval) {
        clearInterval(this.verificationInterval);
        this.verificationInterval = null;
        this.logger.info('⏹️ Stopped periodic verification');
      }
      
      const closePromises = Array.from(this.clients.values()).map(async (clientData) => {
        try {
          if (clientData.client) {
            await clientData.client.close();
            this.logger.info(`📱 ${clientData.user.name} - WhatsApp connection closed`);
            
            // Upload final session to S3
            const sessionPath = path.join(process.env.LAMBDA_MODE === 'true' ? '/tmp' : process.cwd(), 'tokens', clientData.sessionName);
            await this.s3SessionManager.uploadSession(clientData.sessionName, sessionPath);
          }
        } catch (error) {
          this.logger.error(`❌ Error closing connection for ${clientData.user.name}:`, error.message);
        }
      });

      await Promise.allSettled(closePromises);
      this.clients.clear();
      
      // Close email and S3 services
      await this.emailManager.close();
      
      this.isInitialized = false;
      this.logger.info('✅ All WhatsApp connections closed');
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
    this.users = this.config.users || [];
    
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

  setupConsoleMonitoring(userName) {
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
      return function(...args) {
        const message = args.join(' ');
        
        // Check for connection patterns
        if (connectionPatterns.some(pattern => pattern.test(message))) {
          // Check if message relates to this user's session
          if (message.includes(userName) || message.includes(`sinoe-${userName}`)) {
            setTimeout(() => {
              this.logger.info(`🎯 Console Monitor: Detected connection for ${userName}`);
              this.updateConnectionState(userName, true, 'console-detected');
            }, 500);
          }
        }
        
        // Check for disconnection patterns
        if (disconnectionPatterns.some(pattern => pattern.test(message))) {
          if (message.includes(userName) || message.includes(`sinoe-${userName}`)) {
            setTimeout(() => {
              this.logger.warn(`🎯 Console Monitor: Detected disconnection for ${userName}`);
              this.updateConnectionState(userName, false, 'console-detected');
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
    
    this.logger.info(`🎯 Console monitoring setup for ${userName}`);
  }

  setupObservers() {
    // Listen for connection state changes
    this.on('client-connected', (userName) => {
      const clientData = this.clients.get(userName);
      if (clientData) {
        clientData.isConnected = true;
        this.connectionStates.set(userName, 'connected');
        this.logger.info(`🎯 Observer: ${userName} marked as CONNECTED`);
      }
    });

    this.on('client-disconnected', (userName) => {
      const clientData = this.clients.get(userName);
      if (clientData) {
        clientData.isConnected = false;
        this.connectionStates.set(userName, 'disconnected');
        this.logger.info(`🎯 Observer: ${userName} marked as DISCONNECTED`);
      }
    });

    this.on('client-ready', (userName) => {
      const clientData = this.clients.get(userName);
      if (clientData) {
        clientData.isConnected = true;
        this.connectionStates.set(userName, 'ready');
        this.logger.info(`🎯 Observer: ${userName} is READY for messaging`);
      }
    });
  }

  // Force update connection state
  updateConnectionState(userName, isConnected, reason = 'manual') {
    const clientData = this.clients.get(userName);
    if (clientData) {
      const oldState = clientData.isConnected;
      clientData.isConnected = isConnected;
      this.connectionStates.set(userName, isConnected ? 'connected' : 'disconnected');
      
      // Only log if state actually changed
      if (oldState !== isConnected) {
        this.logger.info(`🔄 State change: ${userName} = ${isConnected ? 'CONNECTED' : 'DISCONNECTED'} (${reason})`);
      }
      
      // Emit event
      this.emit(isConnected ? 'client-connected' : 'client-disconnected', userName);
    }
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
    for (const [userName, clientData] of this.clients.entries()) {
      if (!clientData.client) continue;
      
      try {
        // Try to get connection state from venom-bot
        const hostDevice = await clientData.client.getHostDevice();
        if (hostDevice && hostDevice.connected) {
          if (!clientData.isConnected) {
            this.logger.info(`🔍 Verification: ${userName} is actually CONNECTED (hostDevice check)`);
            this.updateConnectionState(userName, true, 'verification-hostDevice');
          }
        }
      } catch (error) {
        // Ignore errors, this is just verification
      }
      
      try {
        // Alternative: Check if we can get WhatsApp Web info
        const isConnected = await clientData.client.isConnected();
        if (isConnected !== clientData.isConnected) {
          this.logger.info(`🔍 Verification: ${userName} connection state mismatch - updating to ${isConnected}`);
          this.updateConnectionState(userName, isConnected, 'verification-isConnected');
        }
      } catch (error) {
        // If client methods fail, it's likely disconnected
        if (clientData.isConnected) {
          this.logger.warn(`🔍 Verification: ${userName} appears disconnected (client error)`);
          this.updateConnectionState(userName, false, 'verification-error');
        }
      }
    }
  }

  getStatus() {
    const clientStatuses = Array.from(this.clients.entries()).map(([name, clientData]) => ({
      name: name,
      connected: clientData.isConnected,
      sessionName: clientData.sessionName,
      phone: clientData.user.phone,
      email: clientData.user.email
    }));

    return {
      enabled: this.config.enabled,
      initialized: this.isInitialized,
      totalClients: this.users.length,
      connectedClients: this.getConnectedCount(),
      clients: clientStatuses,
      email: this.emailManager.getStatus(),
      s3: this.s3SessionManager.getStatus()
    };
  }
}

module.exports = WhatsAppManager;