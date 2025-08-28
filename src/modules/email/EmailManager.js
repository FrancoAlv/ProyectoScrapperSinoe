// Email manager for WhatsApp QR code delivery
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs').promises;

class EmailManager {
  constructor(config, logger) {
    this.config = config.email || {};
    this.logger = logger;
    this.transporter = null;
    
    // Debug constructor
    this.logger.debug('📧 EmailManager constructor - config received:', {
      hasEmailConfig: !!config.email,
      enabled: this.config.enabled,
      host: this.config.host,
      userEmail: this.config.userEmail ? 'SET' : 'NOT SET'
    });
  }

  async initialize() {
    try {
      if (!this.config.enabled) {
        this.logger.info('⚠️ Email is disabled in configuration');
        return false;
      }

      // Debug configuration
      this.logger.debug('📧 Email config:', {
        enabled: this.config.enabled,
        host: this.config.host,
        port: this.config.port,
        userEmail: this.config.userEmail ? '***' : 'not set',
        passEmail: this.config.passEmail ? '***' : 'not set'
      });

      // Create reusable transporter object using AWS SES SMTP
      this.transporter = nodemailer.createTransport({
        host: this.config.host || 'email-smtp.us-east-1.amazonaws.com',
        port: this.config.port || 587,
        secure: this.config.secure || false,
        auth: {
          user: this.config.userEmail, // AWS SES SMTP username
          pass: this.config.passEmail  // AWS SES SMTP password
        }
      });

      // Verify connection configuration
      await this.transporter.verify();
      this.logger.info('✅ AWS SES email connection verified successfully');
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to initialize AWS SES email service:', error.message);
      return false;
    }
  }

  async sendQRCode(qrPath, userConfig) {
    try {
      if (!this.transporter) {
        this.logger.error('❌ Email service not initialized');
        return false;
      }

      if (!userConfig.email) {
        this.logger.error('❌ No email configured for user:', userConfig.name);
        return false;
      }

      // Check if QR file exists
      const qrExists = await this.fileExists(qrPath);
      if (!qrExists) {
        this.logger.error(`❌ QR code file not found: ${qrPath}`);
        return false;
      }

      const mailOptions = {
        from: this.config.emailUser || this.config.userEmail, // Use emailUser as sender display
        to: userConfig.email || this.config.emailClient, // Send to user email or default client
        subject: `🏛️ SINOE - Código QR para WhatsApp (${userConfig.name})`,
        html: this.buildQREmailHTML(userConfig),
        attachments: [
          {
            filename: 'whatsapp-qr.png',
            path: qrPath,
            cid: 'qr-code'
          }
        ]
      };

      const info = await this.transporter.sendMail(mailOptions);
      this.logger.info(`✅ QR code sent successfully to ${userConfig.email} (${userConfig.name})`);
      this.logger.debug('Email info:', info.messageId);
      
      return true;
    } catch (error) {
      this.logger.error(`❌ Failed to send QR code to ${userConfig.email}:`, error.message);
      return false;
    }
  }

  buildQREmailHTML(userConfig) {
    const currentDate = new Date().toLocaleString('es-ES', { 
      timeZone: 'America/Lima',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; color: #2c5aa0; margin-bottom: 30px; }
          .qr-container { text-align: center; margin: 30px 0; padding: 20px; background-color: #f8f9fa; border-radius: 8px; }
          .instructions { background-color: #e7f3ff; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .footer { text-align: center; font-size: 12px; color: #666; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
          .highlight { background-color: #fff3cd; padding: 10px; border-radius: 4px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏛️ SINOE - Sistema de Notificaciones</h1>
            <h2>📱 Configuración de WhatsApp</h2>
            <p><strong>Usuario:</strong> ${userConfig.name}</p>
          </div>
          
          <div class="instructions">
            <h3>📋 Instrucciones para conectar WhatsApp:</h3>
            <ol>
              <li>Abre WhatsApp en tu teléfono móvil</li>
              <li>Ve a <strong>Configuración → Dispositivos vinculados</strong></li>
              <li>Toca <strong>"Vincular un dispositivo"</strong></li>
              <li>Escanea el código QR que aparece a continuación</li>
            </ol>
          </div>

          <div class="qr-container">
            <h3>🔍 Código QR para WhatsApp</h3>
            <img src="cid:qr-code" alt="WhatsApp QR Code" style="max-width: 300px; border: 2px solid #ddd; border-radius: 8px;">
          </div>

          <div class="highlight">
            <p><strong>⏰ Importante:</strong> Este código QR expira en unos minutos. Si no puedes escanearlo a tiempo, se generará uno nuevo automáticamente.</p>
          </div>

          <div class="highlight">
            <p><strong>📞 Teléfono configurado:</strong> ${userConfig.phone}</p>
            <p><strong>📧 Email:</strong> ${userConfig.email}</p>
          </div>

          <div class="footer">
            <p>📅 Generado el: ${currentDate}</p>
            <p>🤖 <em>Sistema automático de notificaciones SINOE</em></p>
            <p>🏛️ <em>Poder Judicial del Perú</em></p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  async sendEmail({ to, subject, html, text = null }) {
    try {
      if (!this.transporter) {
        this.logger.error('❌ Email service not initialized');
        return false;
      }

      if (!to || !subject || (!html && !text)) {
        this.logger.error('❌ Missing required email parameters (to, subject, html/text)');
        return false;
      }

      const mailOptions = {
        from: this.config.emailUser || this.config.userEmail,
        to: to,
        subject: subject,
        html: html,
        text: text
      };

      const info = await this.transporter.sendMail(mailOptions);
      this.logger.info(`✅ Email sent successfully to ${to}`);
      this.logger.debug('Email info:', info.messageId);
      
      return true;
    } catch (error) {
      this.logger.error(`❌ Failed to send email to ${to}:`, error.message);
      return false;
    }
  }

  async sendTestEmail(recipient) {
    try {
      return await this.sendEmail({
        to: recipient,
        subject: '🧪 SINOE - Test Email',
        html: `
          <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px;">
            <h2>🧪 Email de Prueba - SINOE</h2>
            <p>✅ El servicio de AWS SES está funcionando correctamente.</p>
            <p>📧 Enviado desde: ${this.config.emailUser}</p>
            <p>📅 ${new Date().toLocaleString('es-ES', { timeZone: 'America/Lima' })}</p>
            <p>🤖 <em>Sistema de notificaciones SINOE</em></p>
          </div>
        `
      });
    } catch (error) {
      this.logger.error(`❌ Failed to send test email:`, error.message);
      return false;
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async close() {
    try {
      if (this.transporter) {
        this.transporter.close();
        this.logger.info('📧 Email service closed');
      }
    } catch (error) {
      this.logger.error('❌ Error closing email service:', error.message);
    }
  }

  getStatus() {
    return {
      initialized: !!this.transporter,
      enabled: this.config.enabled,
      service: 'AWS SES',
      host: this.config.host,
      port: this.config.port,
      emailUser: this.config.emailUser,
      emailClient: this.config.emailClient
    };
  }
}

module.exports = EmailManager;