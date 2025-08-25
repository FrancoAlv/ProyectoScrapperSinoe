#!/usr/bin/env node

// Script específico para probar el captcha automático con OpenAI
const { spawn } = require('child_process');

// Obtener URL de argumentos
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('🤖 AI Captcha Testing - Automatic Captcha Solving');
    console.log('');
    console.log('Usage:');
    console.log('  node test-ai-captcha.js <url>');
    console.log('');
    console.log('This will:');
    console.log('  ✅ Open browser in visible mode');
    console.log('  ✅ Fill usuario and password fields');
    console.log('  ✅ Capture captcha image (id="frmLogin:imgCapcha")');
    console.log('  ✅ Send captcha to OpenAI Vision API for solving');
    console.log('  ✅ Fill captcha field with AI-solved value');
    console.log('  ✅ Keep browser open for verification');
    console.log('');
    console.log('Requirements:');
    console.log('  - OPENAI_API_KEY must be set in .env');
    console.log('  - AUTO_SOLVE_CAPTCHA=true in .env');
    console.log('  - INPUT_CAPTCHA=AUTO in .env');
    console.log('');
    console.log('Example:');
    console.log('  node test-ai-captcha.js https://casillas.pj.gob.pe/sinoe/login.xhtml');
    console.log('');
    console.log('Cost estimate: ~$0.01-0.03 per captcha solve with gpt-4o-mini');
    process.exit(1);
}

const url = args[0];

// Validar URL
try {
    new URL(url);
    console.log(`✅ Testing AI captcha solving on: ${url}`);
} catch (error) {
    console.log(`❌ Invalid URL: ${url}`);
    process.exit(1);
}

console.log('🤖 Starting AI captcha solving test...');
console.log('');
console.log('🔧 Configuration:');
console.log('  - Browser: Visible with slow motion');
console.log('  - Captcha mode: Automatic (OpenAI Vision API)');
console.log('  - Wait time: 60 seconds for verification');
console.log('  - Debug logs: Enabled');
console.log('');
console.log('📸 Process:');
console.log('  1. Fill usuario and password fields');
console.log('  2. Find captcha image (id="frmLogin:imgCapcha")');
console.log('  3. Screenshot/capture captcha image');
console.log('  4. Convert to base64');
console.log('  5. Send to OpenAI Vision API');
console.log('  6. Parse AI response');
console.log('  7. Fill captcha field with solved value');
console.log('');
console.log('💰 OpenAI Cost: ~$0.01-0.03 per request');
console.log('─'.repeat(70));

// Configurar para testing interactivo con AI
const env = {
    ...process.env,
    TARGET_URLS: url,
    LOG_LEVEL: 'debug',
    HEADLESS: 'false',
    SLOW_MO: '2000',            // Slower for better observation
    FORM_WAIT_TIME: '60000',    // 60 segundos para verificar resultado
    INPUT_CAPTCHA: 'AUTO',      // Force AI solving
    AUTO_SOLVE_CAPTCHA: 'true', // Enable AI solving
    DEVTOOLS: 'true'            // Open DevTools for inspection
};

// Verificar si OpenAI API key está configurada
if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'sk-your-openai-api-key-here') {
    console.log('❌ Error: OPENAI_API_KEY not configured in .env file');
    console.log('');
    console.log('Please:');
    console.log('1. Get an API key from https://platform.openai.com/');
    console.log('2. Add it to your .env file: OPENAI_API_KEY=sk-your-actual-key');
    console.log('3. Make sure you have GPT-4 Vision access');
    process.exit(1);
}

console.log('🔑 OpenAI API Key: ✅ Configured');
console.log(`🧠 Model: ${process.env.OPENAI_MODEL || 'gpt-4o-mini'}`);
console.log('');

// Ejecutar el scraper
const child = spawn('node', ['index.js'], {
    env: env,
    stdio: 'inherit',
    shell: process.platform === 'win32'
});

child.on('close', (code) => {
    console.log('\n─'.repeat(70));
    if (code === 0) {
        console.log('✅ AI captcha testing completed!');
        console.log('');
        console.log('🔍 Check the browser window:');
        console.log('  - All form fields should be filled');
        console.log('  - Captcha should be solved by AI');
        console.log('  - You can now click "Ingresar" to test login');
        console.log('');
        console.log('📊 Check the logs above for:');
        console.log('  - "Captured captcha image" message');
        console.log('  - "OpenAI response" with solved text');
        console.log('  - "Captcha solved: [value]" confirmation');
    } else {
        console.log(`❌ AI captcha testing failed with code ${code}`);
        console.log('');
        console.log('Common issues:');
        console.log('  - Invalid OpenAI API key');
        console.log('  - Insufficient OpenAI credits');
        console.log('  - Network connectivity issues');
        console.log('  - Captcha image not found on page');
    }
});

child.on('error', (error) => {
    console.error('❌ Failed to start AI captcha tester:', error.message);
    process.exit(1);
});