#!/usr/bin/env node

// Script específico para probar llenado de captcha
const { spawn } = require('child_process');

// Obtener URL de argumentos
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('🔤 Captcha Testing - Interactive Browser Mode');
    console.log('');
    console.log('Usage:');
    console.log('  node test-captcha.js <url> [captcha-value]');
    console.log('');
    console.log('This will:');
    console.log('  ✅ Open browser in visible mode');
    console.log('  ✅ Fill usuario field with configured value');
    console.log('  ✅ Fill password field with configured value');
    console.log('  ✅ Fill captcha field (id="frmLogin:captcha") with provided value');
    console.log('  ✅ Keep browser open for manual captcha correction if needed');
    console.log('');
    console.log('Examples:');
    console.log('  node test-captcha.js https://casillas.pj.gob.pe/sinoe/login.xhtml');
    console.log('  node test-captcha.js https://casillas.pj.gob.pe/sinoe/login.xhtml WXYZ5');
    console.log('');
    console.log('Environment Variables:');
    console.log('  INPUT_USUARIO=151151 (from .env)');
    console.log('  INPUT_PASSWORD=yourpass (from .env)');
    console.log('  INPUT_CAPTCHA=ABCDE (from .env or command line)');
    process.exit(1);
}

const url = args[0];
const captchaValue = args[1];

// Validar URL
try {
    new URL(url);
    console.log(`✅ Testing form with captcha on: ${url}`);
} catch (error) {
    console.log(`❌ Invalid URL: ${url}`);
    process.exit(1);
}

console.log('🚀 Starting captcha testing mode...');
console.log('📝 Will fill these fields:');
console.log('  - Usuario/Username → from INPUT_USUARIO (.env)');
console.log('  - Contraseña/Password → from INPUT_PASSWORD (.env)');

if (captchaValue) {
    console.log(`  - Captcha (id="frmLogin:captcha") → ${captchaValue}`);
} else {
    console.log('  - Captcha → from INPUT_CAPTCHA (.env)');
}

console.log('');
console.log('💡 Tips:');
console.log('  - The browser will stay open so you can manually correct captcha');
console.log('  - Look at the captcha image and update the field if needed');
console.log('  - You can then click "Ingresar" manually to test login');
console.log('─'.repeat(70));

// Configurar para testing interactivo
const env = {
    ...process.env,
    TARGET_URLS: url,
    LOG_LEVEL: 'debug',
    HEADLESS: 'false',
    SLOW_MO: '1500',
    FORM_WAIT_TIME: '60000' // 60 segundos para inspeccionar
};

// Override captcha value if provided
if (captchaValue) {
    env.INPUT_CAPTCHA = captchaValue;
}

// Ejecutar el scraper
const child = spawn('node', ['index.js'], {
    env: env,
    stdio: 'inherit',
    shell: process.platform === 'win32'
});

child.on('close', (code) => {
    console.log('\n─'.repeat(70));
    if (code === 0) {
        console.log('✅ Captcha testing completed!');
        console.log('💡 Check the browser window - all fields should be filled');
        console.log('🔍 Verify the captcha matches the image and login manually');
    } else {
        console.log(`❌ Captcha testing failed with code ${code}`);
    }
});

child.on('error', (error) => {
    console.error('❌ Failed to start captcha tester:', error.message);
    process.exit(1);
});