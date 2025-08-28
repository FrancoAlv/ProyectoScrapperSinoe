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
        numero: notification.numero || null
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
          item.ultimaActualizacion = timestamp; // Update modification date
          
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

  async getStats() {
    try {
      if (!this.isInitialized) {
        return { 
          enabled: false, 
          error: 'Not initialized',
          totalItems: 0,
          openNotifications: 0
        };
      }

      // Get table description for item count
      const tableInfo = await this.dynamodb.describeTable({ 
        TableName: this.tableName 
      }).promise();

      // Count open notifications
      const openNotifications = await this.getOpenNotifications(1000);

      return {
        enabled: true,
        tableName: this.tableName,
        tableStatus: tableInfo.Table.TableStatus,
        totalItems: tableInfo.Table.ItemCount || 0,
        tableSize: tableInfo.Table.TableSizeBytes || 0,
        openNotifications: openNotifications.length,
        region: this.config.region || 'us-east-1'
      };

    } catch (error) {
      return {
        enabled: false,
        error: error.message,
        totalItems: 0,
        openNotifications: 0
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