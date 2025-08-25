#!/usr/bin/env node

// Script para ejecutar el scraper fácilmente en local
const { spawn } = require('child_process');
const path = require('path');

// Obtener URLs de argumentos de línea de comandos
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('🧪 Ethical Web Scraper - Local Runner');
    console.log('');
    console.log('Usage:');
    console.log('  node run-local.js <url1> [url2] [url3] ...');
    console.log('');
    console.log('Examples:');
    console.log('  node run-local.js https://quotes.toscrape.com');
    console.log('  node run-local.js https://quotes.toscrape.com https://example.com');
    console.log('  node run-local.js "https://quotes.toscrape.com" "https://httpbin.org/html"');
    console.log('');
    console.log('Options (set as environment variables):');
    console.log('  LOG_LEVEL=debug     - Show detailed logs');
    console.log('  DELAY_MS=1000      - Delay between requests (ms)');
    console.log('  TIMEOUT_MS=10000   - Request timeout (ms)');
    console.log('');
    console.log('Examples with options:');
    console.log('  LOG_LEVEL=debug node run-local.js https://quotes.toscrape.com');
    console.log('  DELAY_MS=500 node run-local.js https://example.com');
    process.exit(1);
}

// Validar URLs
const validUrls = [];
for (const arg of args) {
    try {
        new URL(arg);
        validUrls.push(arg);
        console.log(`✅ Valid URL: ${arg}`);
    } catch (error) {
        console.log(`❌ Invalid URL: ${arg}`);
        process.exit(1);
    }
}

if (validUrls.length === 0) {
    console.log('❌ No valid URLs provided');
    process.exit(1);
}

console.log(`\n🚀 Running scraper with ${validUrls.length} URL(s)...`);
console.log('─'.repeat(50));

// Configurar variables de entorno
const env = {
    ...process.env,
    TARGET_URLS: validUrls.join(','),
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    DELAY_MS: process.env.DELAY_MS || '2000',
    TIMEOUT_MS: process.env.TIMEOUT_MS || '30000'
};

// Ejecutar el scraper
const child = spawn('node', ['index.js'], {
    env: env,
    stdio: 'inherit',
    shell: process.platform === 'win32'
});

child.on('close', (code) => {
    if (code === 0) {
        console.log('\n✅ Scraping completed successfully!');
    } else {
        console.log(`\n❌ Scraping failed with code ${code}`);
    }
    process.exit(code);
});

child.on('error', (error) => {
    console.error('❌ Failed to start scraper:', error.message);
    process.exit(1);
});