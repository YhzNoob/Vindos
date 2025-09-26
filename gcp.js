// install dulu: npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const readline = require('readline');

puppeteer.use(StealthPlugin());

class GCSAutomation {
    constructor() {
        this.accounts = [];
        this.browsers = [];
        this.activeSessions = [];
    }

    async init() {
        // Baca daftar akun
        this.accounts = this.readAccounts();
        if (this.accounts.length === 0) {
            console.log('❌ Tidak ada akun yang ditemukan di email.txt');
            return;
        }
        console.log(`📧 Found ${this.accounts.length} accounts`);
    }

    readAccounts() {
        try {
            const data = fs.readFileSync('email.txt', 'utf8');
            return data.split('\n')
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('#') && l.includes(':'))
                .map(line => {
                    const [email, password] = line.split(':').map(s => s.trim());
                    return { email, password };
                });
        } catch (error) {
            return [];
        }
    }

    async launchBrowser() {
        return await puppeteer.launch({
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--window-size=1200,800'
            ],
            ignoreHTTPSErrors: true
        });
    }

    async loginToGoogle(email, password, page) {
        try {
            console.log(`🔐 Attempting login for: ${email}`);
            
            await page.goto('https://accounts.google.com/Login', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            // Tunggu dan isi email
            await page.waitForSelector('input[type="email"]', { timeout: 10000 });
            await page.type('input[type="email"]', email);
            await page.click('#identifierNext');

            await page.waitForTimeout(3000);

            // Cek jika ada CAPTCHA
            if (await this.checkCaptcha(page)) {
                console.log(`⚠️ ${email} - CAPTCHA detected, waiting for manual solve...`);
                await page.waitForTimeout(15000); // Tunggu 15 detik untuk manual solve
            }

            // Isi password
            await page.waitForSelector('input[type="password"]', { timeout: 10000 });
            await page.type('input[type="password"]', password);
            await page.click('#passwordNext');

            await page.waitForTimeout(5000);

            // Cek login berhasil
            if (await this.isLoggedIn(page)) {
                console.log(`✅ Login successful for: ${email}`);
                return true;
            } else {
                console.log(`❌ Login failed for: ${email}`);
                return false;
            }

        } catch (error) {
            console.log(`🚨 Login error for ${email}:`, error.message);
            return false;
        }
    }

    async checkCaptcha(page) {
        try {
            const captchaSelectors = [
                '.g-recaptcha',
                '#recaptcha',
                '[aria-label*="captcha"]',
                'iframe[src*="recaptcha"]'
            ];

            for (const selector of captchaSelectors) {
                if (await page.$(selector) !== null) {
                    return true;
                }
            }

            // Check for CAPTCHA text
            const pageContent = await page.content();
            const captchaIndicators = ['captcha', 'recaptcha', 'verify you are human', 'not a robot'];
            return captchaIndicators.some(indicator => 
                pageContent.toLowerCase().includes(indicator.toLowerCase())
            );
        } catch (error) {
            return false;
        }
    }

    async isLoggedIn(page) {
        try {
            // Check multiple indicators of successful login
            const currentUrl = page.url();
            const loggedInUrls = [
                'myaccount.google.com',
                'console.cloud.google.com',
                'accounts.google.com/signin/v2/challenge'
            ];

            if (loggedInUrls.some(url => currentUrl.includes(url))) {
                return true;
            }

            // Check for profile element
            const profileElement = await page.$('[aria-label*="Google Account"]');
            return profileElement !== null;
        } catch (error) {
            return false;
        }
    }

    async enable2FA(page, email) {
        try {
            console.log(`🔐 Setting up 2FA for: ${email}`);
            
            await page.goto('https://myaccount.google.com/security', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            await page.waitForTimeout(3000);

            // Click 2-step verification
            const twoStepSelector = 'a[href*="signinoptions/two-step-verification"]';
            await page.waitForSelector(twoStepSelector, { timeout: 10000 });
            await page.click(twoStepSelector);

            await page.waitForTimeout(2000);

            // Start 2FA setup
            const getStartedBtn = await page.$('button:contains("Get started")') || 
                                 await page.$('div[role="button"]:contains("Get started")');
            
            if (getStartedBtn) {
                await getStartedBtn.click();
                console.log(`✅ 2FA setup initiated for: ${email}`);
                
                // Tunggu proses setup (user mungkin perlu manual intervention)
                await page.waitForTimeout(5000);
                return true;
            } else {
                console.log(`ℹ️ 2FA already setup or not available for: ${email}`);
                return false;
            }

        } catch (error) {
            console.log(`❌ 2FA setup error for ${email}:`, error.message);
            return false;
        }
    }

    async openCloudShell(page, email) {
        try {
            console.log(`🚀 Opening Cloud Shell for: ${email}`);
            
            await page.goto('https://console.cloud.google.com/cloudshell', {
                waitUntil: 'networkidle2',
                timeout: 60000
            });

            await page.waitForTimeout(10000);

            // Wait for Cloud Shell to load
            const cloudShellReady = await page.waitForSelector('cloud-shell-terminal', {
                timeout: 60000
            }).catch(() => false);

            if (cloudShellReady) {
                console.log(`✅ Cloud Shell ready for: ${email}`);
                return true;
            } else {
                console.log(`❌ Cloud Shell failed to load for: ${email}`);
                return false;
            }

        } catch (error) {
            console.log(`🚨 Cloud Shell error for ${email}:`, error.message);
            return false;
        }
    }

    async executeCommandInShell(page, command, email) {
        try {
            // Focus on terminal
            await page.click('cloud-shell-terminal');
            await page.waitForTimeout(1000);

            // Type command
            await page.keyboard.type(command);
            await page.keyboard.press('Enter');
            
            console.log(`📡 Command executed for ${email}: ${command}`);
            
            // Wait for command execution
            await page.waitForTimeout(3000);

            return true;
        } catch (error) {
            console.log(`❌ Command execution error for ${email}:`, error.message);
            return false;
        }
    }

    async broadcastCommand(command) {
        console.log(`\n📢 Broadcasting command: ${command}`);
        console.log('=' .repeat(50));

        const results = [];
        
        for (const session of this.activeSessions) {
            const { page, email } = session;
            
            try {
                const success = await this.executeCommandInShell(page, command, email);
                results.push({
                    email,
                    success,
                    message: success ? 'Command executed' : 'Command failed'
                });
            } catch (error) {
                results.push({
                    email,
                    success: false,
                    message: error.message
                });
            }

            // Delay antara akun
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        return results;
    }

    async runAutomation() {
        await this.init();
        
        console.log('🚀 Starting GCS Automation...\n');

        for (const account of this.accounts) {
            console.log(`\n🔧 Processing: ${account.email}`);
            console.log('-'.repeat(40));

            try {
                const browser = await this.launchBrowser();
                const page = await browser.newPage();
                
                // Set user agent untuk mimic human
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

                // Login process
                const loginSuccess = await this.loginToGoogle(account.email, account.password, page);
                
                if (loginSuccess) {
                    // Enable 2FA
                    await this.enable2FA(page, account.email);
                    
                    // Open Cloud Shell
                    const shellReady = await this.openCloudShell(page, account.email);
                    
                    if (shellReady) {
                        this.activeSessions.push({
                            email: account.email,
                            page: page,
                            browser: browser
                        });
                        console.log(`✅ Session active for: ${account.email}`);
                    }
                } else {
                    console.log(`❌ Session failed for: ${account.email}`);
                    await browser.close();
                }

                // Delay antara akun
                await new Promise(resolve => setTimeout(resolve, 5000));

            } catch (error) {
                console.log(`💥 Critical error for ${account.email}:`, error.message);
            }
        }

        console.log(`\n🎯 Active sessions: ${this.activeSessions.length}`);
        return this.activeSessions.length > 0;
    }

    async interactiveMode() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

        console.log('🎮 GCS Interactive Mode Started');
        console.log('Commands: broadcast <command>, quit, list, status\n');

        while (true) {
            const input = await question('gcs> ');
            const [command, ...args] = input.trim().split(' ');

            switch (command) {
                case 'broadcast':
                    if (args.length > 0) {
                        const cmd = args.join(' ');
                        const results = await this.broadcastCommand(cmd);
                        
                        console.log('\n📊 Broadcast Results:');
                        results.forEach(result => {
                            console.log(`${result.email}: ${result.success ? '✅' : '❌'} ${result.message}`);
                        });
                    }
                    break;

                case 'list':
                    console.log('\n📋 Active Sessions:');
                    this.activeSessions.forEach(session => {
                        console.log(`- ${session.email}`);
                    });
                    break;

                case 'status':
                    console.log(`\n📊 Status: ${this.activeSessions.length} active sessions`);
                    break;

                case 'quit':
                case 'exit':
                    console.log('👋 Shutting down...');
                    await this.cleanup();
                    rl.close();
                    return;

                default:
                    console.log('❌ Unknown command. Available: broadcast, list, status, quit');
            }
        }
    }

    async cleanup() {
        console.log('\n🧹 Cleaning up...');
        for (const session of this.activeSessions) {
            try {
                await session.browser.close();
            } catch (error) {
                console.log(`Error closing browser for ${session.email}:`, error.message);
            }
        }
    }
}

// Main execution
async function main() {
    const automator = new GCSAutomation();
    
    try {
        const success = await automator.runAutomation();
        
        if (success) {
            await automator.interactiveMode();
        } else {
            console.log('❌ No active sessions created. Exiting...');
        }
    } catch (error) {
        console.log('💥 Main execution error:', error);
    } finally {
        await automator.cleanup();
    }
}

// Package.json dependencies
const packageJson = {
    "name": "gcs-automation",
    "version": "1.0.0",
    "description": "Google Cloud Shell Automation",
    "main": "gcs_automation.js",
    "dependencies": {
        "puppeteer": "^21.0.0",
        "puppeteer-extra": "^3.3.6",
        "puppeteer-extra-plugin-stealth": "^2.11.2"
    },
    "scripts": {
        "start": "node gcs_automation.js"
    }
};

// Check if package.json exists, if not create it
if (!fs.existsSync('package.json')) {
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
    console.log('📦 Created package.json');
}

// Run the main function
if (require.main === module) {
    console.log('🔧 GCS Automation Tool');
    console.log('⚠️  For educational purposes only!');
    main();
}

module.exports = GCSAutomation;