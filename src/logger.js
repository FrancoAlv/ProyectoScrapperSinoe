// Logger module
class Logger {
  constructor(logLevel = 'info') {
    this.logLevel = logLevel;
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, level, message, data };
    
    if (level === 'error' || level === 'warn' || this.logLevel === 'debug') {
      console.log(JSON.stringify(logEntry));
    } else if (this.logLevel === 'info' && level !== 'debug') {
      console.log(JSON.stringify(logEntry));
    }
  }

  info(message, data = null) {
    this.log('info', message, data);
  }

  debug(message, data = null) {
    this.log('debug', message, data);
  }

  error(message, data = null) {
    this.log('error', message, data);
  }

  warn(message, data = null) {
    this.log('warn', message, data);
  }
}

module.exports = Logger;