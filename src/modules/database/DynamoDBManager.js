const AWS = require('aws-sdk');

class DynamoDBManager {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.tableName = 'DocumentosSinoe';
    this.dynamodb = null;
    this.docClient = null;
    this.isInitialized = false;
  }

  async initialize() {
    try {
      if (!this.config.enabled) {
        this.logger.info('⚠️ DynamoDB disabled in configuration');
        return false;
      }

      // Configure AWS
      AWS.config.update({
        region: this.config.region || 'us-east-1'
      });

      this.dynamodb = new AWS.DynamoDB();
      this.docClient = new AWS.DynamoDB.DocumentClient();

      // Test connection
      await this.testConnection();
      
      this.isInitialized = true;
      this.logger.info('✅ DynamoDB initialized successfully');
      return true;

    } catch (error) {
      this.logger.error('❌ Failed to initialize DynamoDB:', error.message);
      this.isInitialized = false;
      return false;
    }
  }

  async testConnection() {
    try {
      // Simple describe table operation to test connection
      await this.dynamodb.describeTable({ TableName: this.tableName }).promise();
      this.logger.debug('🔗 DynamoDB connection test successful');
    } catch (error) {
      throw new Error(`DynamoDB connection failed: ${error.message}`);
    }
  }

  async saveNotifications(notificationsData, sourceUrl = null) {
    try {
      if (!this.isInitialized) {
        this.logger.warn('⚠️ DynamoDB not initialized - skipping save');
        return { success: 0, failed: 0, errors: ['DynamoDB not initialized'] };
      }

      if (!notificationsData || notificationsData.length === 0) {
        this.logger.info('📄 No notifications to save to DynamoDB');
        return { success: 0, failed: 0, errors: [] };
      }

      const results = {
        success: 0,
        failed: 0,
        errors: [],
        newRecords: 0,
        updatedRecords: 0
      };

      this.logger.info(`💾 Saving ${notificationsData.length} notifications to DynamoDB...`);

      // Process notifications in batches of 25 (DynamoDB batch limit)
      const batchSize = 25;
      for (let i = 0; i < notificationsData.length; i += batchSize) {
        const batch = notificationsData.slice(i, i + batchSize);
        const batchResults = await this.processBatch(batch, sourceUrl);
        
        results.success += batchResults.success;
        results.failed += batchResults.failed;
        results.newRecords += batchResults.newRecords;
        results.updatedRecords += batchResults.updatedRecords;
        results.errors.push(...batchResults.errors);
      }

      this.logger.info(`💾 DynamoDB save complete: ${results.success} saved, ${results.failed} failed (${results.newRecords} new, ${results.updatedRecords} updated)`);
      return results;

    } catch (error) {
      this.logger.error('❌ Error saving notifications to DynamoDB:', error.message);
      return { 
        success: 0, 
        failed: notificationsData?.length || 0, 
        errors: [error.message],
        newRecords: 0,
        updatedRecords: 0
      };
    }
  }

  async processBatch(notifications, sourceUrl) {
    const results = { success: 0, failed: 0, errors: [], newRecords: 0, updatedRecords: 0 };
    
    for (const notification of notifications) {
      try {
        const result = await this.saveNotification(notification, sourceUrl);
        if (result.success) {
          results.success++;
          if (result.isNew) {
            results.newRecords++;
          } else {
            results.updatedRecords++;
          }
        } else {
          results.failed++;
          results.errors.push(result.error);
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`${notification.numeroExpediente}-${notification.numeroNotificacion}: ${error.message}`);
      }
    }

    return results;
  }

  async saveNotification(notification, sourceUrl) {
    try {
      const timestamp = new Date().toISOString();
      const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      
      // Prepare DynamoDB item
      const item = {
        numeroExpediente: notification.numeroExpediente,
        numeroNotificacion: notification.numeroNotificacion,
        estado: notification.estado,
        sumilla: notification.sumilla,
        oficinaJudicial: notification.oficinaJudicial,
        fecha: notification.fecha,
        fechaExtraccion: timestamp,
        ultimaActualizacion: timestamp,
        fuente: sourceUrl || 'SINOE',
        numero: notification.numero || null,
        fechaCreacionItem: currentDate, // Date for filtering current day records
        version: 0, // Initialize version for optimistic locking
        envios: [], // Array to track all user sending statuses
        hashContenido: this.generateContentHash(notification) // Hash to detect content changes
      };

      // Check if record already exists
      const existingItem = await this.getNotification(
        notification.numeroExpediente, 
        notification.numeroNotificacion
      );

      let isNew = false;
      if (existingItem) {
        // Update existing record only if there are changes
        const hasChanges = this.hasSignificantChanges(existingItem, item);
        if (hasChanges) {
          item.fechaCreacion = existingItem.fechaCreacion; // Preserve creation date
          item.fechaCreacionItem = existingItem.fechaCreacionItem; // Preserve original item creation date
          
          // Preserve existing version and envios
          item.version = existingItem.version || 0;
          item.envios = Array.isArray(existingItem.envios) ? existingItem.envios : [];
          
          item.ultimaActualizacion = timestamp; // Update modification date
          
          // If content changed, reset envios for re-sending
          const oldHash = existingItem.hashContenido;
          const newHash = item.hashContenido;
          if (oldHash && newHash && oldHash !== newHash) {
            this.logger.debug(`📝 Content changed for ${notification.numeroExpediente}-${notification.numeroNotificacion} - will resend to users`);
            // Reset envios array to allow re-sending
            item.envios = [];
            item.version = 0; // Reset version as well
          }
          
          await this.docClient.put({
            TableName: this.tableName,
            Item: item
          }).promise();
          
          this.logger.debug(`📝 Updated notification: ${notification.numeroExpediente}-${notification.numeroNotificacion}`);
        } else {
          this.logger.debug(`⏭️ No changes for notification: ${notification.numeroExpediente}-${notification.numeroNotificacion}`);
        }
      } else {
        // Create new record
        item.fechaCreacion = timestamp;
        
        await this.docClient.put({
          TableName: this.tableName,
          Item: item
        }).promise();
        
        isNew = true;
        this.logger.debug(`✨ Created new notification: ${notification.numeroExpediente}-${notification.numeroNotificacion}`);
      }

      return { success: true, isNew };

    } catch (error) {
      this.logger.error(`❌ Error saving notification ${notification.numeroExpediente}-${notification.numeroNotificacion}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async getNotification(numeroExpediente, numeroNotificacion) {
    try {
      const result = await this.docClient.get({
        TableName: this.tableName,
        Key: {
          numeroExpediente: numeroExpediente,
          numeroNotificacion: numeroNotificacion
        }
      }).promise();

      return result.Item || null;
    } catch (error) {
      this.logger.debug(`Error getting notification ${numeroExpediente}-${numeroNotificacion}:`, error.message);
      return null;
    }
  }

  hasSignificantChanges(existingItem, newItem) {
    // Check for changes in important fields
    const fieldsToCheck = ['estado', 'sumilla', 'oficinaJudicial', 'fecha'];
    
    for (const field of fieldsToCheck) {
      if (existingItem[field] !== newItem[field]) {
        return true;
      }
    }
    
    return false;
  }

  async getNotificationsByExpediente(numeroExpediente, limit = 50) {
    try {
      if (!this.isInitialized) {
        throw new Error('DynamoDB not initialized');
      }

      const params = {
        TableName: this.tableName,
        KeyConditionExpression: 'numeroExpediente = :exp',
        ExpressionAttributeValues: {
          ':exp': numeroExpediente
        },
        Limit: limit,
        ScanIndexForward: false // Get most recent first
      };

      const result = await this.docClient.query(params).promise();
      return result.Items || [];

    } catch (error) {
      this.logger.error(`❌ Error querying notifications for ${numeroExpediente}:`, error.message);
      return [];
    }
  }

  async getOpenNotifications(limit = 100) {
    try {
      if (!this.isInitialized) {
        throw new Error('DynamoDB not initialized');
      }

      const params = {
        TableName: this.tableName,
        FilterExpression: 'estado = :estado',
        ExpressionAttributeValues: {
          ':estado': 'ABIERTA'
        },
        Limit: limit
      };

      const result = await this.docClient.scan(params).promise();
      return result.Items || [];

    } catch (error) {
      this.logger.error('❌ Error scanning open notifications:', error.message);
      return [];
    }
  }

  // Generate hash for content change detection
  generateContentHash(notification) {
    const crypto = require('crypto');
    const content = `${notification.estado}-${notification.sumilla}-${notification.oficinaJudicial}-${notification.fecha}`;
    return crypto.createHash('md5').update(content).digest('hex');
  }

  // New method to get today's notifications for WhatsApp sending
  async getTodaysNotificationsForUser(userPhone) {
    try {
      if (!this.isInitialized) {
        throw new Error('DynamoDB not initialized');
      }

      const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      const phoneString = String(userPhone);
      
      // Get all today's notifications
      const params = {
        TableName: this.tableName,
        FilterExpression: 'fechaCreacionItem = :currentDate',
        ExpressionAttributeValues: {
          ':currentDate': currentDate
        }
      };

      const result = await this.docClient.scan(params).promise();
      const allItems = result.Items || [];
      
      // Filter out notifications already sent to this user
      const notSentToUser = allItems.filter(item => {
        if (!Array.isArray(item.envios)) return true;
        
        // Check if user already has an envio record
        const userEnvio = item.envios.find(envio => envio.user === phoneString);
        return !userEnvio || !userEnvio.enviado;
      });

      return notSentToUser;

    } catch (error) {
      this.logger.error(`❌ Error getting today's notifications for user ${userPhone}:`, error.message);
      return [];
    }
  }

  // Mark user as notified for specific notifications (automatic after sending)
  async markUserAsNotified(numeroExpediente, numeroNotificacion, userPhone) {
    if (!this.isInitialized) throw new Error('DynamoDB not initialized');

    const timestamp = new Date().toISOString();
    const phoneString = String(userPhone);

    try {
      // 1) GET actual (solo necesitamos envios y version para optimistic locking)
      const { Item } = await this.docClient.get({
        TableName: this.tableName,
        Key: { numeroExpediente, numeroNotificacion },
        ProjectionExpression: '#e, #v',
        ExpressionAttributeNames: { '#e': 'envios', '#v': 'version' }
      }).promise();

      const prevVersion = Item?.version ?? 0;
      const envios = Array.isArray(Item?.envios) ? [...Item.envios] : [];

      // 2) Merge/dedupe en memoria
      const idx = envios.findIndex(x => x?.user === phoneString);
      const nuevoEnvio = { 
        user: phoneString, 
        enviado: true, 
        fechaEnvio: timestamp, 
        procesado: true 
      };
      
      if (idx >= 0) {
        // Actualizar registro existente
        envios[idx] = { ...envios[idx], ...nuevoEnvio };
      } else {
        // Agregar nuevo registro
        envios.push(nuevoEnvio);
      }

      // 3) UPDATE con condición de versión (optimistic locking)
      await this.docClient.update({
        TableName: this.tableName,
        Key: { numeroExpediente, numeroNotificacion },
        UpdateExpression: 'SET #e = :newEnvios, #v = if_not_exists(#v, :zero) + :one, #ua = :ts',
        ConditionExpression: 'attribute_not_exists(#v) OR #v = :prevVersion',
        ExpressionAttributeNames: { 
          '#e': 'envios', 
          '#v': 'version', 
          '#ua': 'ultimaActualizacion' 
        },
        ExpressionAttributeValues: {
          ':newEnvios': envios,
          ':prevVersion': prevVersion,
          ':zero': 0,
          ':one': 1,
          ':ts': timestamp
        },
        ReturnValues: 'UPDATED_NEW'
      }).promise();

      this.logger.debug(`✅ Marked user ${phoneString} as notified and processed for ${numeroExpediente}-${numeroNotificacion}`);
      return true;

    } catch (error) {
      if (error.code === 'ConditionalCheckFailedException') {
        this.logger.debug(`⚠️ Optimistic lock failed for ${numeroExpediente}-${numeroNotificacion}. Another process updated it.`);
        // En un sistema de alto volumen podrías reintentar aquí
        return false;
      }
      
      this.logger.error(`❌ Error marking user as notified: ${error.message}`);
      return false;
    }
  }

  // Get send status for user (replaced read status)
  async getUserSendStatus(numeroExpediente, numeroNotificacion, userPhone) {
    try {
      if (!this.isInitialized) {
        throw new Error('DynamoDB not initialized');
      }

      const result = await this.docClient.get({
        TableName: this.tableName,
        Key: {
          numeroExpediente: numeroExpediente,
          numeroNotificacion: numeroNotificacion
        }
      }).promise();

      if (result.Item) {
        const userPhoneKey = userPhone.replace(/[^a-zA-Z0-9]/g, '_');
        return result.Item.estadosEnvio?.[userPhoneKey] || null;
      }
      
      return null;

    } catch (error) {
      this.logger.error(`❌ Error getting user send status: ${error.message}`);
      return null;
    }
  }

  // Get notifications with send status for formatting
  async getNotificationsWithSendStatus(notifications, userPhone) {
    try {
      const notificationsWithStatus = [];
      
      for (const notification of notifications) {
        const userPhoneKey = userPhone.replace(/[^a-zA-Z0-9]/g, '_');
        const sendStatus = notification.estadosEnvio?.[userPhoneKey];
        
        notificationsWithStatus.push({
          ...notification,
          wasSent: sendStatus?.enviado || false,
          sendDate: sendStatus?.fechaEnvio || null,
          isProcessed: sendStatus?.procesado || false
        });
      }
      
      return notificationsWithStatus;

    } catch (error) {
      this.logger.error(`❌ Error getting notifications with send status: ${error.message}`);
      return notifications; // Return original notifications if error
    }
  }

  async getStats() {
    try {
      if (!this.isInitialized) {
        return { 
          enabled: false, 
          error: 'Not initialized',
          totalItems: 0,
          openNotifications: 0,
          todaysNotifications: 0
        };
      }

      // Get table description for item count
      const tableInfo = await this.dynamodb.describeTable({ 
        TableName: this.tableName 
      }).promise();

      // Count open notifications
      const openNotifications = await this.getOpenNotifications(1000);

      // Count today's notifications
      const currentDate = new Date().toISOString().split('T')[0];
      const todaysParams = {
        TableName: this.tableName,
        FilterExpression: 'fechaCreacionItem = :currentDate',
        ExpressionAttributeValues: {
          ':currentDate': currentDate
        }
      };
      const todaysResult = await this.docClient.scan(todaysParams).promise();

      return {
        enabled: true,
        tableName: this.tableName,
        tableStatus: tableInfo.Table.TableStatus,
        totalItems: tableInfo.Table.ItemCount || 0,
        tableSize: tableInfo.Table.TableSizeBytes || 0,
        openNotifications: openNotifications.length,
        todaysNotifications: (todaysResult.Items || []).length,
        region: this.config.region || 'us-east-1'
      };

    } catch (error) {
      return {
        enabled: false,
        error: error.message,
        totalItems: 0,
        openNotifications: 0,
        todaysNotifications: 0
      };
    }
  }

  async close() {
    try {
      this.logger.info('🗄️ Closing DynamoDB connections...');
      
      // AWS SDK doesn't require explicit cleanup for DynamoDB
      this.isInitialized = false;
      this.dynamodb = null;
      this.docClient = null;
      
      this.logger.info('✅ DynamoDB connections closed');
    } catch (error) {
      this.logger.error('❌ Error closing DynamoDB:', error.message);
    }
  }

  getStatus() {
    return {
      enabled: this.config.enabled,
      initialized: this.isInitialized,
      tableName: this.tableName,
      region: this.config.region || 'us-east-1'
    };
  }
}

module.exports = DynamoDBManager;