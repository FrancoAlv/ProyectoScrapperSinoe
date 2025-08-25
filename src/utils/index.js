// Utility functions
class Utils {
  static wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static validateUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  static formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  static sanitizeFilename(filename) {
    return filename.replace(/[:.]/g, '-').replace(/[/\\?%*:|"<>]/g, '_');
  }

  static isValidSelector(selector) {
    try {
      document.querySelector(selector);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = Utils;