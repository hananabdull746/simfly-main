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
const https = require('https');

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
  '@google/generative-ai'
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
// 3. QR CODE WEB SERVER
// ============================
let qrCodeData = null;
let serverPort = 0;

function startQRServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/qr') {
      if (qrCodeData) {
        const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(qrCodeData);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>SimFly Bot - WhatsApp QR Code</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: Arial, sans-serif; text-align: center; padding: 40px; background: #f0f2f5; }
    .container { max-width: 500px; margin: 0 auto; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #25d366; margin-bottom: 10px; }
    h2 { color: #333; font-size: 18px; margin-bottom: 20px; }
    img { max-width: 100%; border-radius: 10px; margin: 20px 0; }
    .steps { text-align: left; background: #f8f9fa; padding: 20px; border-radius: 10px; margin-top: 20px; }
    .steps ol { margin: 0; padding-left: 20px; }
    .steps li { margin: 10px 0; color: #555; }
    .pairing { background: #e7f3ff; padding: 15px; border-radius: 10px; margin: 15px 0; border-left: 4px solid #0084ff; }
    .code { font-size: 32px; font-weight: bold; color: #0084ff; letter-spacing: 5px; }
    .refresh { color: #888; font-size: 12px; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📱 SimFly Pakistan Bot</h1>
    <h2>Scan QR Code with WhatsApp</h2>
    <img src="${qrUrl}" alt="WhatsApp QR Code" width="300">
    <div class="steps">
      <ol>
        <li>Open <b>WhatsApp</b> on your phone</li>
        <li>Go to <b>Settings → Linked Devices</b></li>
        <li>Tap <b>Link a Device</b></li>
        <li>Point camera at the QR code above</li>
      </ol>
    </div>
    <p class="refresh">QR refreshes every 30 seconds. Keep this page open.</p>
  </div>
</body>
</html>`);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Waiting for QR code...</h1><p>Please wait, the bot is starting...</p>');
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(0, '0.0.0.0', () => {
    serverPort = server.address().port;
    console.log('');
    console.log('🌐 QR Code Web Server started!');
    console.log('   Open in browser: http://YOUR_VPS_IP:' + serverPort);
    console.log('   (Replace YOUR_VPS_IP with your actual server IP)');
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
    console.log('Examples: 923001234567 | 14155552671 | 447911123456');
    console.log('');

    rl.question('Phone number: ', (input) => {
      rl.close();
      const clean = input.replace(/\D/g, '');

      if (clean.length < 10 || clean.length > 15) {
        console.log('Invalid number. Must be 10-15 digits.');
        process.exit(1);
      }

      console.log('Number accepted: ' + clean);
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

    // Only add pairingCode if we have a phone number AND no existing session
    const hasSession = state.creds && state.creds.me && state.creds.me.id;
    if (phoneNumber && !hasSession) {
      sockConfig.pairingCode = true;
      sockConfig.phoneNumber = phoneNumber;
    }

    sock = makeWASocket(sockConfig);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Capture QR code and serve via web
      if (qr) {
        qrCodeData = qr;
        console.log('');
        console.log('📱 QR CODE GENERATED!');
        console.log('');
        console.log('Option 1 - Web Browser (Easiest):');
        console.log('   http://YOUR_VPS_IP:' + serverPort);
        console.log('');
        console.log('Option 2 - Direct QR Link:');
        console.log('   https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(qr).substring(0, 60) + '...');
        console.log('');
        console.log('Option 3 - Terminal QR (if supported):');
        try {
          const qrcode = require('qrcode-terminal');
          qrcode.generate(qr, { small: true });
        } catch (e) {
          console.log('   (qrcode-terminal not installed, use web browser)');
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
        console.log('WhatsApp > Settings > Linked Devices > Link with phone number');
        console.log('Enter code: ' + update.pairingCode);
        console.log('');
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect && lastDisconnect.error instanceof Boom) 
          ? lastDisconnect.error.output.statusCode 
          : null;

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect && reconnectAttempts < 10) {
          reconnectAttempts++;
          const delay = Math.min(5000 * reconnectAttempts, 30000);
          console.log('Reconnecting in ' + delay + 'ms... (attempt ' + reconnectAttempts + ')');
          setTimeout(() => connectBot(phoneNumber), delay);
        } else if (statusCode === DisconnectReason.loggedOut) {
          console.log('Logged out. Delete auth_info_baileys and restart.');
          process.exit(1);
        } else {
          console.log('Max reconnections reached.');
          process.exit(1);
        }
      } else if (connection === 'open') {
        reconnectAttempts = 0;
        qrCodeData = null; // Clear QR after connection
        console.log('');
        console.log('========================================');
        console.log('✅ SimFly Bot CONNECTED!');
        console.log('========================================');
        console.log('');
        console.log('Bot is live. Admin commands: /menu');
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
              text: 'Calls not supported. Send text message.' 
            });
          } catch (e) {}
        }
      }
    });

  } catch (err) {
    console.error('FATAL ERROR:', err.message);
    setTimeout(() => connectBot(phoneNumber), 10000);
  }
}

// ============================
// 6. STARTUP
// ============================
(async () => {
  try {
    // Start QR web server first
    startQRServer();

    // Check if already has session
    const authExists = fs.existsSync('./auth_info_baileys/creds.json');
    let phoneNumber = null;

    if (!authExists) {
      phoneNumber = await askPhoneNumber();
    } else {
      console.log('Session found. Connecting without phone number input...');
    }

    await connectBot(phoneNumber);
  } catch (err) {
    console.error('STARTUP ERROR:', err);
    process.exit(1);
  }
})();

process.on('SIGINT', () => {
  console.log('Shutting down...');
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED:', err);
});