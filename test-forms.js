#!/usr/bin/env node

// Script específico para probar llenado de formularios
const { spawn } = require('child_process');

// Obtener URL de argumentos
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('🧪 Form Testing - Interactive Browser Mode');
    console.log('');
    console.log('Usage:');
    console.log('  node test-forms.js <url>');
    console.log('');
    console.log('This will:');
    console.log('  ✅ Open browser in visible mode');
    console.log('  ✅ Look for inputs with placeholder="Usuario"');
    console.log('  ✅ Look for inputs with name="P5qKey@kVBiG2Yn2dPEwG3&@n"');
    console.log('  ✅ Look for any input[type="text"]');
    console.log('  ✅ Fill found inputs with "151151"');
    console.log('  ✅ Keep browser open for inspection');
    console.log('');
    console.log('Example:');
    console.log('  node test-forms.js https://your-form-site.com');
    process.exit(1);
}

const url = args[0];

// Validar URL
try {
    new URL(url);
    console.log(`✅ Testing form inputs on: ${url}`);
} catch (error) {
    console.log(`❌ Invalid URL: ${url}`);
    process.exit(1);
}

console.log('🚀 Starting interactive browser mode...');
console.log('📝 Will look for and fill these inputs:');
console.log('  - input[placeholder="Usuario"] → 151151');
console.log('  - input[name="P5qKey@kVBiG2Yn2dPEwG3&@n"] → 151151');
console.log('  - Any input[type="text"] that matches criteria');
console.log('');
console.log('🔍 Browser will open and stay visible for inspection');
console.log('─'.repeat(60));

// Configurar para testing interactivo
const env = {
    ...process.env,
    TARGET_URLS: url,
    LOG_LEVEL: 'debug',     // Ver todos los logs
    DELAY_MS: '1000',       // Delay corto para testing
    TIMEOUT_MS: '30000'
};

// Ejecutar el scraper
const child = spawn('node', ['index.js'], {
    env: env,
    stdio: 'inherit',
    shell: process.platform === 'win32'
});

child.on('close', (code) => {
    console.log('\n─'.repeat(60));
    if (code === 0) {
        console.log('✅ Form testing completed!');
        console.log('💡 Check the browser window to see if inputs were filled');
    } else {
        console.log(`❌ Form testing failed with code ${code}`);
    }
});

child.on('error', (error) => {
    console.error('❌ Failed to start form tester:', error.message);
    process.exit(1);
});