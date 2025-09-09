// Main ethical scraper class - Singleton Pattern
const Config = require('./config');
const Logger = require('./logger');
const WebScraper = require('./scraper');
const ResultSaver = require('./resultSaver');
const WhatsAppManager = require('./modules/whatsapp/WhatsAppManager');
const DynamoDBManager = require('./modules/database/DynamoDBManager');

class EthicalScraper {
  constructor() {
    // Singleton pattern - prevent multiple instances
    if (EthicalScraper.instance) {
      return EthicalScraper.instance;
    }

    this.config = Config.get();
    this.logger = new Logger(this.config.logLevel);
    this.scraper = new WebScraper(this.config, this.logger);
    this.resultSaver = new ResultSaver(this.config, this.logger);
    
    // Debug WhatsApp manager creation
    this.logger.info('🔧 Creating WhatsApp manager instance...');
    this.whatsappManager = WhatsAppManager.getInstance(this.config, this.logger);
    this.logger.info(`✅ WhatsApp manager created. Enabled: ${this.config.whatsapp?.enabled}`);
    
    this.dynamodbManager = new DynamoDBManager(this.config.dynamodb, this.logger);
    this.results = [];
    this.extractedData = null; // Store extracted notifications data

    // Store the singleton instance
    EthicalScraper.instance = this;
  }

  // Memory monitoring utility
  logMemoryUsage(stage) {
    try {
      const used = process.memoryUsage();
      const totalMB = Math.round(used.rss / 1024 / 1024);
      const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
      const externalMB = Math.round(used.external / 1024 / 1024);
      
      // Get system memory if available (Lambda shows this in container)
      let systemInfo = '';
      if (process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) {
        const lambdaMemoryMB = parseInt(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE);
        const usagePercent = Math.round((totalMB / lambdaMemoryMB) * 100);
        systemInfo = ` | Lambda: ${lambdaMemoryMB}MB | Usage: ${usagePercent}%`;
      }
      
      this.logger.info(`🧠 Memory [${stage}]: RSS=${totalMB}MB | Heap=${heapUsedMB}/${heapTotalMB}MB | External=${externalMB}MB${systemInfo}`);
      
      // Warning if memory usage is high
      if (process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) {
        const lambdaMemoryMB = parseInt(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE);
        const usagePercent = (totalMB / lambdaMemoryMB) * 100;
        
        if (usagePercent > 80) {
          this.logger.warn(`⚠️ High memory usage: ${usagePercent.toFixed(1)}% of available ${lambdaMemoryMB}MB`);
        } else if (usagePercent > 90) {
          this.logger.error(`❌ Critical memory usage: ${usagePercent.toFixed(1)}% of available ${lambdaMemoryMB}MB`);
        }
      }
    } catch (error) {
      this.logger.debug(`Error logging memory usage: ${error.message}`);
    }
  }

  // Static method to get the singleton instance
  static getInstance() {
    if (!EthicalScraper.instance) {
      EthicalScraper.instance = new EthicalScraper();
    }
    return EthicalScraper.instance;
  }

  // Static method to check if instance exists
  static hasInstance() {
    return !!EthicalScraper.instance;
  }

  // Static method to destroy the singleton instance
  static async destroyInstance() {
    if (EthicalScraper.instance) {
      await EthicalScraper.instance.cleanup();
      EthicalScraper.instance = null;
    }
  }

  // Method to reset the singleton (useful for testing)
  static reset() {
    EthicalScraper.instance = null;
  }

  async runJob() {
    const startTime = Date.now();
    this.logMemoryUsage('START');
    
    this.logger.info('🚀 Starting SINOE scraping job with WhatsApp notifications', {
      targetUrls: this.config.targetUrls.length,
      whatsappEnabled: this.config.whatsapp?.enabled || false
    });

    if (this.config.targetUrls.length === 0) {
      this.logger.error('No target URLs configured. Set TARGET_URLS environment variable.');
      return;
    }

    try {
      // Initialize DynamoDB system only (defer WhatsApp until after scraping)
      if (this.config.dynamodb?.enabled) {
        this.logger.info('🗄️ Initializing DynamoDB system...');
        const dynamodbInitialized = await this.dynamodbManager.initialize();
        
        if (dynamodbInitialized) {
          this.logger.info('✅ DynamoDB system initialized successfully');
        } else {
          this.logger.warn('⚠️ DynamoDB initialization failed, continuing without database storage');
        }
      }

      // Initialize web scraper (this will use most of the memory)
      this.logger.info('🔧 Initializing web scraper (main browser)...');
      this.logMemoryUsage('BEFORE_BROWSER');
      await this.scraper.initialize();
      this.logMemoryUsage('AFTER_BROWSER');

      // Process each URL with delay between requests
      for (let i = 0; i < this.config.targetUrls.length; i++) {
        const url = this.config.targetUrls[i].trim();
        
        if (!url) continue;

        // Add delay between requests (except for the first one)
        if (i > 0) {
          this.logger.debug(`Waiting ${this.config.delayBetweenRequests}ms before next request...`);
          await new Promise(resolve => setTimeout(resolve, this.config.delayBetweenRequests));
        }

        const result = await this.scraper.scrapeUrl(url);
        this.results.push(result);
        
        // Store extracted data if it contains notifications
        if (result.extractedData && Array.isArray(result.extractedData.notifications)) {
          this.extractedData = result.extractedData;
          this.logger.info(`📊 Data extracted: ${result.extractedData.notifications.length} notifications found`);
        }
      }

      // Save results to file
      this.logger.info('💾 Saving results to files...');
      await this.resultSaver.saveResults(this.results);
      this.logger.info('✅ Results saved to files successfully');
      
      // Save to DynamoDB if we have extracted data
      this.logger.info('💾 Attempting to save to DynamoDB...');
      const dynamoSaved = await this.saveToDynamoDB();
      this.logger.info(`✅ DynamoDB save completed: ${dynamoSaved}`);
      
      // Close web scraper to free memory before WhatsApp initialization
      if (this.scraper) {
        this.logger.info('🧹 Closing web scraper to free memory for WhatsApp...');
        this.logMemoryUsage('BEFORE_CLOSE_BROWSER');
        await this.scraper.close();
        this.scraper = null; // Mark as closed
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
          this.logger.debug('🗑️ Forced garbage collection');
        }
        
        // Wait a bit for cleanup
        await new Promise(resolve => setTimeout(resolve, 2000));
        this.logMemoryUsage('AFTER_CLOSE_BROWSER');
      }
      
      // Now initialize WhatsApp system (using the freed memory)
      this.logger.info('🚀 About to initialize WhatsApp system after scraping...');
      await this.initializeWhatsAppAfterScraping();
      
      // Send WhatsApp notifications if we have extracted data
      await this.sendNotifications();
      
      const duration = Date.now() - startTime;
      this.logMemoryUsage('END');
      this.logger.info('✅ Scraping job completed successfully', { 
        duration: `${duration}ms`,
        totalResults: this.results.length,
        notificationsSent: !!this.extractedData
      });

    } catch (error) {
      this.logger.error('❌ Scraping job failed', { error: error.message });
      
      // Send error notification via WhatsApp if enabled
      await this.sendErrorNotification(error);
      
      throw error; // Re-throw to maintain error handling behavior
    } finally {
      await this.cleanup();
    }
  }

  async initializeWhatsAppAfterScraping() {
    try {
      this.logger.info('📋 Starting WhatsApp initialization method...');
      
      if (!this.config.whatsapp?.enabled) {
        this.logger.warn('⚠️ WhatsApp is disabled in configuration - skipping initialization');
        return false;
      }

      this.logger.info('🔧 WhatsApp enabled - proceeding with initialization...');
      this.logger.info('🧠 Memory optimization: Using freed browser memory for WhatsApp');
      this.logMemoryUsage('BEFORE_WHATSAPP');
      
      this.logger.info('⏳ Calling whatsappManager.initialize()...');
      const whatsappInitialized = await this.whatsappManager.initialize();
      this.logger.info(`🔍 WhatsApp initialization result: ${whatsappInitialized}`);
      this.logMemoryUsage('AFTER_WHATSAPP');
      
      if (whatsappInitialized) {
        this.logger.info('✅ WhatsApp system initialized successfully (memory optimized)');
        return true;
      } else {
        this.logger.warn('⚠️ WhatsApp initialization failed, will fallback to email');
        return false;
      }
      
    } catch (error) {
      this.logger.error('❌ Error initializing WhatsApp after scraping:', error.message);
      this.logMemoryUsage('WHATSAPP_ERROR');
      return false;
    }
  }

  async sendNotifications() {
    try {
      if (!this.config.whatsapp?.enabled || !this.config.whatsapp?.sendOnSuccess) {
        this.logger.debug('WhatsApp notifications disabled or sendOnSuccess=false');
        return false;
      }

      if (!this.extractedData || !this.extractedData.notifications) {
        this.logger.info('📭 No notifications data to send via WhatsApp');
        
        // Send empty notification if configured
        if (this.whatsappManager) {
          const emptyMessage = `🏛️ *SINOE - Notificaciones Electrónicas*\n\n📅 ${new Date().toLocaleString('es-ES', { timeZone: 'America/Lima' })}\n\n📊 No se encontraron notificaciones nuevas.\n\n🤖 _Generado automáticamente por el sistema SINOE_`;
          const recipients = this.whatsappManager.getAllNotificationRecipients();
          if (recipients.length > 0) {
            await this.whatsappManager.sendMessageToAll(recipients, emptyMessage);
            this.logger.info('📱 Empty notification sent via WhatsApp');
          }
        }
        return false;
      }

      const notificationsCount = this.extractedData.notifications.length;
      this.logger.info(`📱 Sending WhatsApp notifications for ${notificationsCount} records...`);
      
      const success = await this.whatsappManager.sendNotificationsSummary(this.extractedData.notifications);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Short delay to ensure messages are sent
      if (success) {
        this.logger.info(`✅ WhatsApp notifications sent successfully (${notificationsCount} records)`);
        return true;
      } else {
        this.logger.warn('⚠️ WhatsApp failed - attempting email fallback...');
        
        // Try email fallback
        const emailSuccess = await this.sendEmailNotifications(this.extractedData.notifications);
        
        if (emailSuccess) {
          this.logger.info(`✅ Email fallback notifications sent successfully (${notificationsCount} records)`);
          return true;
        } else {
          this.logger.error('❌ Both WhatsApp and Email notifications failed');
          return false;
        }
      }
      
    } catch (error) {
      this.logger.error('❌ Error sending notifications:', error.message);
      return false;
    }
  }

  async saveToDynamoDB() {
    try {
      if (!this.config.dynamodb?.enabled) {
        this.logger.debug('📄 DynamoDB disabled - skipping database save');
        return false;
      }

      if (!this.dynamodbManager.isInitialized) {
        this.logger.warn('⚠️ DynamoDB not initialized - skipping database save');
        return false;
      }

      if (!this.extractedData || !this.extractedData.notifications) {
        this.logger.info('📄 No notifications data to save to DynamoDB - continuing with WhatsApp initialization anyway');
        return true; // Don't block WhatsApp initialization
      }

      const notificationsCount = this.extractedData.notifications.length;
      this.logger.info(`💾 Saving ${notificationsCount} notifications to DynamoDB...`);

      // Get the source URL from the first result
      const sourceUrl = this.results.length > 0 ? this.results[0].url : 'SINOE';

      const results = await this.dynamodbManager.saveNotifications(
        this.extractedData.notifications, 
        sourceUrl
      );

      if (results.success > 0) {
        this.logger.info(`✅ DynamoDB save completed: ${results.success}/${notificationsCount} saved (${results.newRecords} new, ${results.updatedRecords} updated)`);
        
        // Log any errors that occurred
        if (results.errors.length > 0) {
          this.logger.warn(`⚠️ Some DynamoDB saves had errors: ${results.failed} failed`);
          results.errors.slice(0, 3).forEach(error => {
            this.logger.debug(`  - ${error}`);
          });
        }
        
        return true;
      } else {
        this.logger.error(`❌ All DynamoDB saves failed: ${results.failed}/${notificationsCount}`);
        return false;
      }

    } catch (error) {
      this.logger.error('❌ Error saving to DynamoDB:', error.message);
      return false;
    }
  }

  async sendEmailNotifications(notificationsData) {
    try {
      if (!this.config.email?.enabled) {
        this.logger.info('⚠️ Email notifications disabled');
        return false;
      }

      if (!notificationsData || notificationsData.length === 0) {
        this.logger.info('📧 No notifications to send via email');
        return false;
      }

      // Email shows ALL notifications (both open and closed)
      const allNotifications = notificationsData; // Show all notifications in email
      
      if (allNotifications.length === 0) {
        this.logger.info('📧 No notifications found - Email not sent');
        return false;
      }
      
      // Separate closed notifications for count in subject
      const closedNotifications = notificationsData.filter(notification => 
        notification.estado === 'CERRADA'
      );

      // Get EmailManager from WhatsAppManager (since it's already initialized there)
      if (!this.whatsappManager?.emailManager) {
        this.logger.error('❌ EmailManager not available');
        return false;
      }

      const emailManager = this.whatsappManager.emailManager;

      // Format email content - show all notifications but highlight counts
      const openCount = allNotifications.filter(n => n.estado !== 'CERRADA').length;
      const closedCount = closedNotifications.length;
      const subject = `🏛️ SINOE - ${allNotifications.length} Notificaciones: ${openCount} Abiertas, ${closedCount} Cerradas`;
      const emailContent = this.formatEmailNotifications(allNotifications);

      // Get all notification recipients from WhatsApp config (same as WhatsApp recipients)
      const allRecipients = this.whatsappManager.getAllNotificationRecipients();
      const emailRecipients = [];
      
      // Get email addresses from WHATSAPP_RECIPIENTS
      this.whatsappManager.notificationRecipients.forEach(recipient => {
        if (recipient.email && recipient.receiveNotifications !== false) {
          emailRecipients.push(recipient.email);
        }
      });

      // Fallback to config email if no recipients found
      if (emailRecipients.length === 0) {
        const fallbackRecipient = this.config.email.clientEmail || this.config.email.emailClient;
        if (fallbackRecipient) {
          emailRecipients.push(fallbackRecipient);
        }
      }

      if (emailRecipients.length === 0) {
        this.logger.error('❌ No email recipients configured');
        return false;
      }

      // Send emails to all recipients
      let successCount = 0;
      let failCount = 0;

      for (const recipient of emailRecipients) {
        try {
          const success = await emailManager.sendEmail({
            to: recipient,
            subject: subject,
            html: emailContent
          });

          if (success) {
            successCount++;
          } else {
            failCount++;
          }
          
          // Small delay between emails
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          failCount++;
          this.logger.error(`❌ Failed to send email to ${recipient}:`, error.message);
        }
      }

      if (successCount > 0) {
        this.logger.info(`📧 Email notifications sent to ${successCount}/${emailRecipients.length} recipients (${allNotifications.length} total: ${openCount} abiertas, ${closedCount} cerradas)`);
        return true;
      } else {
        this.logger.error(`❌ Failed to send email notifications to any recipients (${failCount} failed)`);
        return false;
      }

    } catch (error) {
      this.logger.error('❌ Error sending email notifications:', error.message);
      return false;
    }
  }

  formatEmailNotifications(notificationsData) {
    const timestamp = new Date().toLocaleString('es-ES', { 
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    const openCount = notificationsData.filter(n => n.estado !== 'CERRADA').length;
    const closedCount = notificationsData.filter(n => n.estado === 'CERRADA').length;

    let html = `
    <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
      <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db;">🏛️ SINOE - Notificaciones Electrónicas</h2>
      <p><strong>📅 Fecha:</strong> ${timestamp}</p>
      <p><strong>📊 Resumen:</strong> ${notificationsData.length} notificación(es) encontrada(s)</p>
      <p style="font-size: 16px;">
        <span style="color: #27ae60;">🟢 <strong>${openCount} Abiertas</strong></span> | 
        <span style="color: #e74c3c;">🔴 <strong>${closedCount} Cerradas</strong></span>
      </p>
      
      <h3 style="color: #27ae60;">📋 Detalle de Notificaciones:</h3>
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
        <thead>
          <tr style="background-color: #3498db; color: white;">
            <th style="padding: 10px; border: 1px solid #ddd;">#</th>
            <th style="padding: 10px; border: 1px solid #ddd;">Estado</th>
            <th style="padding: 10px; border: 1px solid #ddd;">Notificación</th>
            <th style="padding: 10px; border: 1px solid #ddd;">Expediente</th>
            <th style="padding: 10px; border: 1px solid #ddd;">Sumilla</th>
            <th style="padding: 10px; border: 1px solid #ddd;">Oficina</th>
            <th style="padding: 10px; border: 1px solid #ddd;">Fecha</th>
          </tr>
        </thead>
        <tbody>
    `;

    notificationsData.forEach((notification, index) => {
      const statusColor = notification.estado === 'ABIERTA' ? '#27ae60' : '#e74c3c';
      const statusIcon = notification.estado === 'ABIERTA' ? '🟢' : '🔴';
      
      html += `
        <tr style="${index % 2 === 0 ? 'background-color: #f8f9fa;' : ''}">
          <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${index + 1}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: center; color: ${statusColor};">
            ${statusIcon} ${notification.estado}
          </td>
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">${notification.numeroNotificacion}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${notification.numeroExpediente}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${notification.sumilla}</td>
          <td style="padding: 8px; border: 1px solid #ddd; font-size: 12px;">${notification.oficinaJudicial}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${notification.fecha}</td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
      
      <div style="margin-top: 30px; padding: 15px; background-color: #ecf0f1; border-radius: 5px;">
        <p style="margin: 0; font-size: 14px; color: #7f8c8d;">
          🤖 <em>Generado automáticamente por el sistema SINOE</em><br>
          📧 <em>Este correo fue enviado como respaldo debido a fallas en WhatsApp</em>
        </p>
      </div>
    </div>
    `;

    return html;
  }

  async sendErrorNotification(error) {
    try {
      // Try WhatsApp first
      if (this.config.whatsapp?.enabled && this.config.whatsapp?.sendOnError && this.whatsappManager) {
        const errorMessage = `🚨 *SINOE - Error de Sistema*\n\n📅 ${new Date().toLocaleString('es-ES', { timeZone: 'America/Lima' })}\n\n❌ Error: ${error.message}\n\n🤖 _Sistema de notificaciones SINOE_`;
        
        const recipients = this.whatsappManager.getAllNotificationRecipients();
        if (recipients.length > 0) {
          try {
            await this.whatsappManager.sendMessageToAll(recipients, errorMessage);
            this.logger.info('📱 Error notification sent via WhatsApp');
            return true;
          } catch (whatsappError) {
            this.logger.warn('⚠️ WhatsApp error notification failed - attempting email fallback...');
          }
        }
      }

      // Email fallback for error notifications
      if (this.config.email?.enabled && this.whatsappManager?.emailManager) {
        const recipient = this.config.email.clientEmail || this.config.email.emailClient;
        if (recipient) {
          const timestamp = new Date().toLocaleString('es-ES', { timeZone: 'America/Lima' });
          const emailContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #e74c3c; border-bottom: 2px solid #e74c3c;">🚨 SINOE - Error de Sistema</h2>
              <p><strong>📅 Fecha:</strong> ${timestamp}</p>
              <div style="background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 5px; padding: 15px; margin: 20px 0;">
                <h3 style="color: #721c24; margin-top: 0;">❌ Error Detectado:</h3>
                <p style="color: #721c24; margin-bottom: 0;"><strong>${error.message}</strong></p>
              </div>
              <div style="margin-top: 20px; padding: 10px; background-color: #ecf0f1; border-radius: 5px;">
                <p style="margin: 0; font-size: 14px; color: #7f8c8d;">
                  🤖 <em>Notificación automática del sistema SINOE</em><br>
                  📧 <em>Enviado por email debido a fallas en WhatsApp</em>
                </p>
              </div>
            </div>
          `;

          const success = await this.whatsappManager.emailManager.sendEmail({
            to: recipient,
            subject: '🚨 SINOE - Error de Sistema',
            html: emailContent
          });

          if (success) {
            this.logger.info('📧 Error notification sent via email fallback');
            return true;
          }
        }
      }
      
      return false;
    } catch (generalError) {
      this.logger.error('❌ Failed to send error notification via any method:', generalError.message);
      return false;
    }
  }

  async cleanup() {
    try {
      this.logger.info('🧹 Performing final cleanup...');
      
      // Close web scraper (if not already closed for memory optimization)
      if (this.scraper) {
        this.logger.debug('🧹 Closing web scraper...');
        await this.scraper.close();
      } else {
        this.logger.debug('🧹 Web scraper already closed (memory optimization)');
      }
      
      // Close WhatsApp connections and clear intervals
      if (this.whatsappManager) {
        this.logger.debug('🧹 Closing WhatsApp manager...');
        await this.whatsappManager.close();
      }

      // Close DynamoDB connections
      if (this.dynamodbManager) {
        this.logger.debug('🧹 Closing DynamoDB manager...');
        await this.dynamodbManager.close();
      }
      
      this.logger.info('✅ Final cleanup completed');
    } catch (error) {
      this.logger.error('❌ Error during cleanup:', error.message);
    }
  }

  // Method to get extracted data (useful for other parts of the application)
  getExtractedData() {
    return this.extractedData;
  }

  // Method to update configuration
  updateConfig(newConfig) {
    this.config = newConfig;
    if (this.whatsappManager) {
      this.whatsappManager.updateConfig(newConfig, this.logger);
    }
    this.logger.info('🔄 EthicalScraper configuration updated');
  }
}

module.exports = EthicalScraper;