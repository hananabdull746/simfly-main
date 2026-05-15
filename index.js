const { 
  default: makeWASocket, 
  DisconnectReason, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore 
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const { handleMessage } = require('./src/handler');
const readline = require('readline');
const { execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const logger = P({ level: 'info' });

// ============================
// 1. VERIFY & INSTALL DEPS
// ============================
const REQUIRED_PACKAGES = [
  '@whiskeysockets/baileys',
  '@hapi/boom',
  'pino',
  'axios',
  'dotenv',
  'firebase-admin',
  'node-cache',
  '@google/generative-ai',
  'qrcode'
];

function ensureDependencies() {
  let installed = 0;
  let failed = 0;

  for (const pkg of REQUIRED_PACKAGES) {
    try {
      require.resolve(pkg);
    } catch (e) {
      logger.info('Installing ' + pkg + '...');
      try {
        execSync('npm install ' + pkg, { stdio: 'inherit', cwd: __dirname });
        installed++;
      } catch (installErr) {
        logger.error('Failed to install ' + pkg);
        failed++;
      }
    }
  }

  if (failed > 0) {
    logger.error(failed + ' package(s) failed. Run: npm install');
    process.exit(1);
  }

  if (installed > 0) {
    logger.info('Dependencies installed. Please restart the bot.');
    process.exit(0);
  }
}

ensureDependencies();

// Now load qrcode after ensuring it's installed
const QRCode = require('qrcode');

// ============================
// 2. VERIFY ENV FILES
// ============================
if (!fs.existsSync('./.env')) {
  logger.error('.env file not found! Create it from .env.example');
  process.exit(1);
}

if (!fs.existsSync('./serviceAccountKey.json')) {
  logger.error('serviceAccountKey.json not found! Add Firebase credentials.');
  process.exit(1);
}

// ============================
// 3. QR CODE WEB SERVER (LOCAL)
// ============================
let qrCodeDataURL = null;
let serverPort = 0;
let qrRawData = null;

async function generateQRImage(qrText) {
  try {
    const dataUrl = await QRCode.toDataURL(qrText, { 
      width: 400, 
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    return dataUrl;
  } catch (err) {
    logger.error('QR generation failed:', err.message);
    return null;
  }
}

function startQRServer() {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/' || req.url === '/qr') {
      if (qrRawData && qrCodeDataURL) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>SimFly Bot - WhatsApp QR</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; 
      text-align: center; 
      padding: 20px; 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container { 
      max-width: 450px; 
      width: 100%;
      background: white; 
      padding: 35px; 
      border-radius: 20px; 
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .logo { font-size: 48px; margin-bottom: 10px; }
    h1 { color: #25d366; margin-bottom: 5px; font-size: 24px; }
    .brand { color: #666; font-size: 14px; margin-bottom: 25px; }
    .qr-wrapper { 
      background: #f8f9fa; 
      padding: 20px; 
      border-radius: 15px; 
      margin: 20px 0;
      border: 2px dashed #ddd;
    }
    .qr-wrapper img { 
      max-width: 100%; 
      width: 280px;
      border-radius: 10px; 
    }
    .steps { 
      text-align: left; 
      background: #f0f7ff; 
      padding: 20px; 
      border-radius: 12px; 
      margin-top: 20px;
      border-left: 4px solid #0084ff;
    }
    .steps h3 { color: #0084ff; margin-bottom: 12px; font-size: 16px; }
    .steps ol { margin: 0; padding-left: 20px; }
    .steps li { margin: 10px 0; color: #444; line-height: 1.5; }
    .steps li b { color: #222; }
    .pairing-box { 
      background: #fff3cd; 
      padding: 15px; 
      border-radius: 12px; 
      margin: 15px 0;
      border: 2px solid #ffc107;
    }
    .pairing-box h3 { color: #856404; margin-bottom: 8px; }
    .code { 
      font-size: 36px; 
      font-weight: bold; 
      color: #856404; 
      letter-spacing: 8px;
      font-family: 'Courier New', monospace;
    }
    .footer { 
      margin-top: 20px; 
      color: #888; 
      font-size: 12px;
    }
    .refresh { 
      color: #e74c3c; 
      font-size: 13px; 
      margin-top: 10px;
      font-weight: 600;
    }
    @media (max-width: 480px) {
      .container { padding: 25px; }
      h1 { font-size: 20px; }
      .code { font-size: 28px; letter-spacing: 5px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">📱</div>
    <h1>SimFly Pakistan Bot</h1>
    <div class="brand">WhatsApp QR Code Login</div>

    <div class="qr-wrapper">
      <img src="${qrCodeDataURL}" alt="WhatsApp QR Code" width="280">
    </div>

    <div class="refresh">⏰ QR refreshes every 30 seconds. Scan quickly!</div>

    <div class="steps">
      <h3>📲 How to Link Your Device</h3>
      <ol>
        <li>Open <b>WhatsApp</b> on your phone</li>
        <li>Tap <b>Settings</b> (bottom right)</li>
        <li>Go to <b>Linked Devices</b></li>
        <li>Tap <b>Link a Device</b></li>
        <li>Point camera at the QR code above</li>
      </ol>
    </div>

    <div class="footer">
      SimFly Pakistan | Gujranwala, Punjab<br>
      Non-PTA iPhone Specialists 🇵🇰
    </div>
  </div>
</body>
</html>`);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>SimFly Bot - Starting...</title>
  <style>
    body { font-family: Arial; text-align: center; padding: 50px; background: #f0f2f5; }
    .loader { border: 4px solid #f3f3f3; border-top: 4px solid #25d366; border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; margin: 20px auto; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <h1>⏳ SimFly Bot is starting...</h1>
  <div class="loader"></div>
  <p>Please wait 10-20 seconds for QR code to appear.</p>
  <script>setTimeout(()=>location.reload(), 5000);</script>
</body>
</html>`);
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(0, '0.0.0.0', () => {
    serverPort = server.address().port;
    console.log('');
    console.log('🌐 QR CODE WEB SERVER STARTED');
    console.log('========================================');
    console.log('');
    console.log('📱 Open this link on your PHONE or COMPUTER:');
    console.log('');
    console.log('   http://YOUR_VPS_IP:' + serverPort);
    console.log('');
    console.log('   (Replace YOUR_VPS_IP with your server IP address)');
    console.log('');
    console.log('========================================');
    console.log('');
  });
}

// ============================
// 4. PHONE NUMBER INPUT
// ============================
function askPhoneNumber() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log('');
    console.log('========================================');
    console.log('   SimFly Pakistan WhatsApp Bot');
    console.log('========================================');
    console.log('');
    console.log('Enter your WhatsApp bot number');
    console.log('Format: 923001234567 (country code, no +, no spaces)');
    console.log('Examples:');
    console.log('  Pakistan:  923001234567');
    console.log('  USA:       14155552671');
    console.log('  UK:        447911123456');
    console.log('  UAE:       971501234567');
    console.log('');

    rl.question('Phone number: ', (input) => {
      rl.close();
      const clean = input.replace(/\D/g, '');

      if (clean.length < 10 || clean.length > 15) {
        console.log('❌ Invalid number. Must be 10-15 digits with country code.');
        process.exit(1);
      }

      console.log('✅ Number accepted: ' + clean);
      resolve(clean);
    });
  });
}

// ============================
// 5. BOT CONNECTION
// ============================
let sock = null;
let reconnectAttempts = 0;

async function connectBot(phoneNumber) {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sockConfig = {
      version,
      logger: P({ level: 'silent' }),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' }))
      },
      browser: ['SimFlyBot', 'Chrome', '1.0'],
      markOnlineOnConnect: true,
      syncFullHistory: false,
      shouldIgnoreJid: (jid) => jid && jid.endsWith('@g.us') || jid === 'status@broadcast',
      getMessage: async () => undefined
    };

    const hasSession = state.creds && state.creds.me && state.creds.me.id;
    if (phoneNumber && !hasSession) {
      sockConfig.pairingCode = true;
      sockConfig.phoneNumber = phoneNumber;
    }

    sock = makeWASocket(sockConfig);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Generate LOCAL QR image when QR is available
      if (qr) {
        qrRawData = qr;
        qrCodeDataURL = await generateQRImage(qr);

        console.log('');
        console.log('📱 QR CODE GENERATED!');
        console.log('');
        console.log('🌐 OPTION 1 - Web Browser (Easiest):');
        console.log('   http://YOUR_VPS_IP:' + serverPort);
        console.log('');
        console.log('📋 OPTION 2 - Pairing Code (if shown below):');
        console.log('   Use the 8-digit code in WhatsApp > Linked Devices');
        console.log('');

        // Try terminal QR as fallback
        try {
          const qrcodeTerminal = require('qrcode-terminal');
          console.log('📱 OPTION 3 - Terminal QR:');
          qrcodeTerminal.generate(qr, { small: true });
        } catch (e) {
          // qrcode-terminal not installed, skip
        }
        console.log('');
      }

      // Show pairing code
      if (update.pairingCode) {
        console.log('');
        console.log('========================================');
        console.log('🔑 PAIRING CODE: ' + update.pairingCode);
        console.log('========================================');
        console.log('');
        console.log('📲 Steps:');
        console.log('   1. Open WhatsApp on your phone');
        console.log('   2. Settings → Linked Devices');
        console.log('   3. Tap "Link with phone number"');
        console.log('   4. Enter: ' + update.pairingCode);
        console.log('');
      }

      if (connection === 'close') {
        qrRawData = null;
        qrCodeDataURL = null;
        const statusCode = (lastDisconnect && lastDisconnect.error instanceof Boom) 
          ? lastDisconnect.error.output.statusCode 
          : null;

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect && reconnectAttempts < 10) {
          reconnectAttempts++;
          const delay = Math.min(5000 * reconnectAttempts, 30000);
          console.log('🔌 Reconnecting in ' + delay + 'ms... (attempt ' + reconnectAttempts + '/10)');
          setTimeout(() => connectBot(phoneNumber), delay);
        } else if (statusCode === DisconnectReason.loggedOut) {
          console.log('🚫 Logged out. Delete auth_info_baileys folder and restart.');
          process.exit(1);
        } else {
          console.log('❌ Max reconnection attempts reached.');
          process.exit(1);
        }
      } else if (connection === 'open') {
        reconnectAttempts = 0;
        qrRawData = null;
        qrCodeDataURL = null;
        console.log('');
        console.log('========================================');
        console.log('✅✅✅ SimFly Bot CONNECTED! ✅✅✅');
        console.log('========================================');
        console.log('');
        console.log('🤖 Bot is live and handling messages');
        console.log('👨‍💼 Admin commands: /menu');
        console.log('');
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        try {
          const jid = msg.key.remoteJid;
          if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;
          await handleMessage(msg, sock);
        } catch (err) {
          logger.error('MESSAGE ERROR', err);
        }
      }
    });

    sock.ev.on('call', async (callEvents) => {
      for (const call of callEvents) {
        if (call.status === 'offer') {
          try {
            await sock.rejectCall(call.id, call.from);
            await sock.sendMessage(call.from, { 
              text: '❌ Calls are not supported. Please send a text message for instant support.' 
            });
          } catch (e) {}
        }
      }
    });

    sock.ev.on('error', (err) => {
      logger.error('SOCKET ERROR', err);
    });

  } catch (err) {
    console.error('❌ FATAL ERROR:', err.message);
    setTimeout(() => connectBot(phoneNumber), 10000);
  }
}

// ============================
// 6. STARTUP
// ============================
(async () => {
  try {
    startQRServer();

    const authExists = fs.existsSync('./auth_info_baileys/creds.json');
    let phoneNumber = null;

    if (!authExists) {
      phoneNumber = await askPhoneNumber();
    } else {
      console.log('');
      console.log('✅ Existing session found. Connecting...');
      console.log('   (If you want to re-link, delete auth_info_baileys folder)');
      console.log('');
    }

    await connectBot(phoneNumber);
  } catch (err) {
    console.error('❌ STARTUP ERROR:', err);
    process.exit(1);
  }
})();

process.on('SIGINT', () => {
  console.log('');
  console.log('🛑 Shutting down SimFly Bot...');
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ UNHANDLED:', err);
});