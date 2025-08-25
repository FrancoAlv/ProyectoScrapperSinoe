// Data extraction module
class DataExtractor {
  constructor(config, logger) {
    this.config = config.formFilling;
    this.logger = logger;
  }

  async extractNotificationsData(page) {
    try {
      this.logger.info('📊 Starting notifications data extraction...');
      await this.wait(3000); // Wait for table to fully load
      
      // Find the notifications table tbody
      let tableBody = null;
      
      for (const selector of this.config.selectors.notificationsTableSelectors) {
        if (selector.startsWith('/') || selector.startsWith('//')) {
          // XPath selector
          try {
            const [element] = await page.$x(selector);
            if (element) {
              this.logger.info(`Found notifications table with XPath: ${selector}`);
              tableBody = element;
              break;
            }
          } catch (error) {
            continue;
          }
        } else {
          // CSS selector
          const element = await page.$(selector);
          if (element) {
            this.logger.info(`Found notifications table with selector: ${selector}`);
            tableBody = element;
            break;
          }
        }
      }
      
      if (!tableBody) {
        this.logger.error('❌ Could not find notifications table');
        return [];
      }
      
      // Extract data from table rows
      const notificationsData = await page.evaluate((tbody) => {
        const rows = tbody.querySelectorAll('tr');
        const data = [];
        
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const cells = row.querySelectorAll('td');
          
          if (cells.length >= 6) { // Ensure we have enough columns
            // Detect notification status from image with null check
            let estado = 'UNKNOWN';
            const imgCell = cells[1].querySelector('img');
            if (imgCell && imgCell.src) {
              const isOpenRow = imgCell.src.endsWith("notificacion-abierta.png");
              estado = isOpenRow ? 'ABIERTA' : 'CERRADA';
            }

            const rowData = {
              numero: i + 1,
              estado: estado,
              numeroNotificacion: cells[3]?.textContent?.trim() || '',
              numeroExpediente: cells[4]?.textContent?.trim() || '',
              sumilla: cells[5]?.textContent?.trim() || '',
              oficinaJudicial: cells[6]?.textContent?.trim() || '',
              fecha: cells[7]?.textContent?.trim() || ''
            };
            
            // Only add if row has actual data
            if (rowData.numeroNotificacion || rowData.numeroExpediente) {
              data.push(rowData);
            }
          }
        }
        
        return data;
      }, tableBody);
      
      this.logger.info(`✅ Successfully extracted ${notificationsData.length} records from notifications table`);
      return notificationsData;
      
    } catch (error) {
      this.logger.error('Error extracting notifications data:', error.message);
      return [];
    }
  }

  async analyzeTableStructure(page) {
    try {
      this.logger.info('🔍 Analyzing table structure for debugging...');
      
      // Find table first
      const tables = await page.$$('table');
      for (let i = 0; i < tables.length; i++) {
        const table = tables[i];
        const tableId = await page.evaluate(el => el.id, table);
        const tableClass = await page.evaluate(el => el.className, table);
        
        this.logger.info(`Table ${i + 1}: id="${tableId}", class="${tableClass}"`);
        
        // Analyze headers
        const headers = await page.evaluate(table => {
          const headerCells = table.querySelectorAll('th');
          return Array.from(headerCells).map(th => th.textContent?.trim() || '');
        }, table);
        
        if (headers.length > 0) {
          this.logger.info(`Headers:`, headers);
        }
        
        // Analyze first data row
        const firstRowData = await page.evaluate(table => {
          const tbody = table.querySelector('tbody');
          if (!tbody) return null;
          
          const firstRow = tbody.querySelector('tr');
          if (!firstRow) return null;
          
          const cells = firstRow.querySelectorAll('td');
          return Array.from(cells).map((cell, index) => ({
            index,
            content: cell.textContent?.trim() || '',
            className: cell.className || ''
          }));
        }, table);
        
        if (firstRowData) {
          this.logger.info(`First row data:`, firstRowData);
        }
      }
      
    } catch (error) {
      this.logger.error('Error analyzing table structure:', error.message);
    }
  }

  async extractAllData(page) {
    try {
      this.logger.info('📊 Starting comprehensive data extraction...');
      
      // First analyze table structure
      await this.analyzeTableStructure(page);
      
      // Then extract notifications data
      const notificationsData = await this.extractNotificationsData(page);
      
      // Create comprehensive result object
      const extractedData = {
        timestamp: new Date().toISOString(),
        source: 'SINOE - Sistema de Notificaciones Electrónicas',
        recordCount: notificationsData.length,
        notifications: notificationsData
      };
      
      this.logger.info('✅ Comprehensive data extraction completed');
      return extractedData;
      
    } catch (error) {
      this.logger.error('Error in comprehensive data extraction:', error.message);
      return {
        timestamp: new Date().toISOString(),
        source: 'SINOE - Sistema de Notificaciones Electrónicas',
        recordCount: 0,
        notifications: [],
        error: error.message
      };
    }
  }

  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = DataExtractor;