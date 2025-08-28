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
    this.whatsappManager = WhatsAppManager.getInstance(this.config, this.logger);
    this.dynamodbManager = new DynamoDBManager(this.config.dynamodb, this.logger);
    this.results = [];
    this.extractedData = null; // Store extracted notifications data

    // Store the singleton instance
    EthicalScraper.instance = this;
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
    this.logger.info('🚀 Starting SINOE scraping job with WhatsApp notifications', {
      targetUrls: this.config.targetUrls.length,
      whatsappEnabled: this.config.whatsapp?.enabled || false
    });

    if (this.config.targetUrls.length === 0) {
      this.logger.error('No target URLs configured. Set TARGET_URLS environment variable.');
      return;
    }

    try {
      // Initialize WhatsApp system first
      if (this.config.whatsapp?.enabled) {
        this.logger.info('🔧 Initializing WhatsApp system...');
        const whatsappInitialized = await this.whatsappManager.initialize();
        
        if (whatsappInitialized) {
          this.logger.info('✅ WhatsApp system initialized successfully');
          
          // Send test message if configured
          if (this.config.whatsapp.testPhone) {
            await this.whatsappManager.sendTestMessage();
          }
        } else {
          this.logger.warn('⚠️ WhatsApp initialization failed, continuing without notifications');
        }
      }

      // Initialize DynamoDB system
      if (this.config.dynamodb?.enabled) {
        this.logger.info('🗄️ Initializing DynamoDB system...');
        const dynamodbInitialized = await this.dynamodbManager.initialize();
        
        if (dynamodbInitialized) {
          this.logger.info('✅ DynamoDB system initialized successfully');
        } else {
          this.logger.warn('⚠️ DynamoDB initialization failed, continuing without database storage');
        }
      }

      // Initialize web scraper
      await this.scraper.initialize();

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

      // Save results
      await this.resultSaver.saveResults(this.results);
      
      // Save to DynamoDB if we have extracted data
      await this.saveToDynamoDB();
      
      // Send WhatsApp notifications if we have extracted data
      await this.sendNotifications();
      
      const duration = Date.now() - startTime;
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
        this.logger.info('📄 No notifications data to save to DynamoDB');
        return false;
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

      // Filter only OPEN notifications (same logic as WhatsApp)
      const openNotifications = notificationsData.filter(notification => 
        notification.estado === 'ABIERTA'
      );

      if (openNotifications.length === 0) {
        this.logger.info('📧 No open notifications found - Email not sent');
        return false;
      }

      // Get EmailManager from WhatsAppManager (since it's already initialized there)
      if (!this.whatsappManager?.emailManager) {
        this.logger.error('❌ EmailManager not available');
        return false;
      }

      const emailManager = this.whatsappManager.emailManager;

      // Format email content
      const subject = `🏛️ SINOE - ${openNotifications.length} Notificación(es) Electrónica(s) Pendiente(s)`;
      const emailContent = this.formatEmailNotifications(openNotifications);

      // Send email to configured recipient
      const recipient = this.config.email.clientEmail || this.config.email.emailClient;
      if (!recipient) {
        this.logger.error('❌ No email recipient configured');
        return false;
      }

      const success = await emailManager.sendEmail({
        to: recipient,
        subject: subject,
        html: emailContent
      });

      if (success) {
        this.logger.info(`📧 Email notifications sent successfully to ${recipient} (${openNotifications.length} open records)`);
        return true;
      } else {
        this.logger.error('❌ Failed to send email notifications');
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

    let html = `
    <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
      <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db;">🏛️ SINOE - Notificaciones Electrónicas</h2>
      <p><strong>📅 Fecha:</strong> ${timestamp}</p>
      <p><strong>📊 Resumen:</strong> ${notificationsData.length} notificación(es) pendiente(s)</p>
      
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
      this.logger.info('🧹 Performing cleanup...');
      
      // Close web scraper
      if (this.scraper) {
        await this.scraper.close();
      }
      
      // Close WhatsApp connections and clear intervals
      if (this.whatsappManager) {
        await this.whatsappManager.close();
      }

      // Close DynamoDB connections
      if (this.dynamodbManager) {
        await this.dynamodbManager.close();
      }
      
      this.logger.info('✅ Cleanup completed');
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