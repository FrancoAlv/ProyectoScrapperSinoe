// AWS S3 session storage manager for WhatsApp sessions
const AWS = require('aws-sdk');
const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class S3SessionManager {
  constructor(config, logger) {
    this.config = config.aws || {};
    this.logger = logger;
    this.s3 = null;
    this.bucketName = this.config.bucket || 'sinoe-whatsapp-sessions';
    this.enabled = this.config.enabled || false;
  }

  async initialize() {
    try {
      if (!this.enabled) {
        this.logger.info('⚠️ S3 session storage is disabled');
        return false;
      }

      // Configure AWS
      AWS.config.update({
        region: this.config.region || 'us-east-1'
      });

      this.s3 = new AWS.S3();

      // Test S3 connection
      await this.s3.headBucket({ Bucket: this.bucketName }).promise();
      this.logger.info(`✅ S3 bucket "${this.bucketName}" connection verified`);
      
      return true;
    } catch (error) {
      if (error.code === 'NotFound') {
        this.logger.error(`❌ S3 bucket "${this.bucketName}" not found`);
      } else if (error.code === 'Forbidden') {
        this.logger.error(`❌ Access denied to S3 bucket "${this.bucketName}"`);
      } else {
        this.logger.error('❌ Failed to initialize S3:', error.message);
      }
      return false;
    }
  }

  async uploadSession(sessionName, localSessionPath) {
    try {
      if (!this.enabled || !this.s3) {
        this.logger.debug('S3 not enabled, skipping session upload');
        return false;
      }

      const sessionExists = await this.directoryExists(localSessionPath);
      if (!sessionExists) {
        this.logger.warn(`Session directory not found: ${localSessionPath}`);
        return false;
      }

      // Create tar.gz archive of session directory
      const archiveName = `${sessionName}-${Date.now()}.tar.gz`;
      const archivePath = path.join(process.env.LAMBDA_MODE === 'true' ? '/tmp' : process.cwd(), 'temp', archiveName);
      
      // Ensure temp directory exists
      await fs.mkdir(path.dirname(archivePath), { recursive: true });
      
      this.logger.info(`📦 Creating session archive: ${archiveName}`);
      
      // Create compressed archive
      execSync(`tar -czf "${archivePath}" -C "${path.dirname(localSessionPath)}" "${path.basename(localSessionPath)}"`, {
        stdio: 'pipe'
      });

      // Upload to S3
      const fileBuffer = await fs.readFile(archivePath);
      const s3Key = `sessions/${sessionName}/${archiveName}`;
      
      const uploadParams = {
        Bucket: this.bucketName,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: 'application/gzip',
        Metadata: {
          sessionName: sessionName,
          timestamp: new Date().toISOString(),
          version: 'v1.0'
        }
      };

      const result = await this.s3.upload(uploadParams).promise();
      
      // Clean up local archive
      await fs.unlink(archivePath);
      
      this.logger.info(`✅ Session uploaded to S3: ${s3Key}`);
      return result.Location;
      
    } catch (error) {
      this.logger.error(`❌ Failed to upload session "${sessionName}":`, error.message);
      return false;
    }
  }

  async downloadSession(sessionName, targetPath) {
    try {
      if (!this.enabled || !this.s3) {
        this.logger.debug('S3 not enabled, skipping session download');
        return false;
      }

      // List available sessions for this name
      const listParams = {
        Bucket: this.bucketName,
        Prefix: `sessions/${sessionName}/`
      };

      const objects = await this.s3.listObjectsV2(listParams).promise();
      
      if (!objects.Contents || objects.Contents.length === 0) {
        this.logger.info(`📭 No session found in S3 for: ${sessionName}`);
        return false;
      }

      // Get the most recent session (by modification time)
      const latestSession = objects.Contents.sort((a, b) => 
        new Date(b.LastModified) - new Date(a.LastModified)
      )[0];

      this.logger.info(`📥 Downloading session: ${latestSession.Key}`);

      // Download from S3
      const downloadParams = {
        Bucket: this.bucketName,
        Key: latestSession.Key
      };

      const data = await this.s3.getObject(downloadParams).promise();
      
      // Save to temporary file
      const tempArchivePath = path.join(process.env.LAMBDA_MODE === 'true' ? '/tmp' : process.cwd(), 'temp', `download-${sessionName}.tar.gz`);
      await fs.mkdir(path.dirname(tempArchivePath), { recursive: true });
      await fs.writeFile(tempArchivePath, data.Body);

      // Extract archive
      const extractDir = path.dirname(targetPath);
      await fs.mkdir(extractDir, { recursive: true });
      
      execSync(`tar -xzf "${tempArchivePath}" -C "${extractDir}"`, {
        stdio: 'pipe'
      });

      // Clean up temp file
      await fs.unlink(tempArchivePath);
      
      this.logger.info(`✅ Session downloaded and extracted to: ${targetPath}`);
      return true;
      
    } catch (error) {
      this.logger.error(`❌ Failed to download session "${sessionName}":`, error.message);
      return false;
    }
  }

  async listSessions() {
    try {
      if (!this.enabled || !this.s3) {
        return [];
      }

      const listParams = {
        Bucket: this.bucketName,
        Prefix: 'sessions/'
      };

      const objects = await this.s3.listObjectsV2(listParams).promise();
      
      if (!objects.Contents) {
        return [];
      }

      // Group by session name and get metadata
      const sessions = {};
      objects.Contents.forEach(obj => {
        const parts = obj.Key.split('/');
        if (parts.length >= 3) {
          const sessionName = parts[1];
          if (!sessions[sessionName]) {
            sessions[sessionName] = {
              name: sessionName,
              files: [],
              lastModified: obj.LastModified,
              totalSize: 0
            };
          }
          
          sessions[sessionName].files.push({
            key: obj.Key,
            size: obj.Size,
            lastModified: obj.LastModified
          });
          
          sessions[sessionName].totalSize += obj.Size;
          
          // Update last modified to most recent
          if (obj.LastModified > sessions[sessionName].lastModified) {
            sessions[sessionName].lastModified = obj.LastModified;
          }
        }
      });

      return Object.values(sessions);
      
    } catch (error) {
      this.logger.error('❌ Failed to list sessions from S3:', error.message);
      return [];
    }
  }

  async deleteSession(sessionName) {
    try {
      if (!this.enabled || !this.s3) {
        this.logger.debug('S3 not enabled, skipping session deletion');
        return false;
      }

      // List all objects for this session
      const listParams = {
        Bucket: this.bucketName,
        Prefix: `sessions/${sessionName}/`
      };

      const objects = await this.s3.listObjectsV2(listParams).promise();
      
      if (!objects.Contents || objects.Contents.length === 0) {
        this.logger.info(`📭 No session found to delete: ${sessionName}`);
        return true;
      }

      // Delete all objects for this session
      const deleteParams = {
        Bucket: this.bucketName,
        Delete: {
          Objects: objects.Contents.map(obj => ({ Key: obj.Key }))
        }
      };

      const result = await this.s3.deleteObjects(deleteParams).promise();
      
      this.logger.info(`🗑️ Deleted ${result.Deleted.length} files for session: ${sessionName}`);
      return true;
      
    } catch (error) {
      this.logger.error(`❌ Failed to delete session "${sessionName}":`, error.message);
      return false;
    }
  }

  async directoryExists(dirPath) {
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async cleanupOldSessions(maxAge = 30) {
    try {
      if (!this.enabled || !this.s3) {
        return false;
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxAge);

      const sessions = await this.listSessions();
      let cleanedCount = 0;

      for (const session of sessions) {
        if (new Date(session.lastModified) < cutoffDate) {
          this.logger.info(`🧹 Cleaning up old session: ${session.name} (${session.lastModified})`);
          const deleted = await this.deleteSession(session.name);
          if (deleted) cleanedCount++;
        }
      }

      this.logger.info(`✅ Cleaned up ${cleanedCount} old sessions`);
      return true;
      
    } catch (error) {
      this.logger.error('❌ Failed to cleanup old sessions:', error.message);
      return false;
    }
  }

  getStatus() {
    return {
      enabled: this.enabled,
      bucket: this.bucketName,
      region: this.config.region || 'us-east-1',
      initialized: !!this.s3
    };
  }
}

module.exports = S3SessionManager;