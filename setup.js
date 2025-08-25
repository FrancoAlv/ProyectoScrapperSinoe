#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🚀 Setting up Ethical Web Scraper...\n');

// Check if .env exists
const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env.example');

if (!fs.existsSync(envPath)) {
    if (fs.existsSync(envExamplePath)) {
        // Copy .env.example to .env
        fs.copyFileSync(envExamplePath, envPath);
        console.log('✅ Created .env file from .env.example');
        console.log('📝 Edit .env file to customize your configuration\n');
    } else {
        console.log('❌ .env.example not found');
        process.exit(1);
    }
} else {
    console.log('ℹ️  .env file already exists\n');
}

// Check if node_modules exists
if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
    console.log('📦 Installing dependencies...');
    const { spawn } = require('child_process');
    
    const npm = spawn('npm', ['install'], {
        stdio: 'inherit',
        shell: process.platform === 'win32'
    });
    
    npm.on('close', (code) => {
        if (code === 0) {
            console.log('\n✅ Dependencies installed successfully!');
            showUsageInstructions();
        } else {
            console.log('\n❌ Failed to install dependencies');
            process.exit(1);
        }
    });
    
    npm.on('error', (error) => {
        console.log('\n❌ Error installing dependencies:', error.message);
        process.exit(1);
    });
} else {
    console.log('✅ Dependencies already installed');
    showUsageInstructions();
}

function showUsageInstructions() {
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Setup Complete!');
    console.log('='.repeat(60));
    console.log('\n📝 Next Steps:');
    console.log('1. Edit .env file with your target URLs and preferences');
    console.log('2. Test locally with one of these commands:');
    console.log('');
    console.log('   📋 Form testing (visible browser):');
    console.log('   node test-forms.js https://your-site.com');
    console.log('');
    console.log('   🔧 General testing:');
    console.log('   node run-local.js https://your-site.com');
    console.log('');
    console.log('   🐛 Debug mode:');
    console.log('   LOG_LEVEL=debug node run-local.js https://your-site.com');
    console.log('');
    console.log('📚 Documentation:');
    console.log('   - Read README.md for detailed instructions');
    console.log('   - Check .env file for all configuration options');
    console.log('   - Use test-forms.js for form filling testing');
    console.log('');
    console.log('🚀 AWS Deployment:');
    console.log('   ./deploy.sh (after configuring AWS CLI)');
    console.log('\n' + '='.repeat(60));
}