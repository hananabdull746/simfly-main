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
// 3. PHONE NUMBER INPUT
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
    console.log('  India:     919876543210');
    console.log('  Turkey:    905551234567');
    console.log('');

    rl.question('Phone number: ', (input) => {
      rl.close();
      const clean = input.replace(/\D/g, '');

      if (clean.length < 10 || clean.length > 15) {
        console.log('');
        console.log('❌ Invalid number. Must be 10-15 digits with country code.');
        console.log('   Example: 923001234567');
        process.exit(1);
      }

      console.log('');
      console.log('✅ Number accepted: ' + clean);
      resolve(clean);
    });
  });
}

// ============================
// 4. BOT CONNECTION
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
      const { connection, lastDisconnect } = update;

      // Show pairing code INSTANTLY when available
      if (update.pairingCode) {
        console.log('');
        console.log('╔════════════════════════════════════════╗');
        console.log('║         🔑 YOUR PAIRING CODE           ║');
        console.log('╠════════════════════════════════════════╣');
        console.log('║                                        ║');
        console.log('║           ' + update.pairingCode + '             ║');
        console.log('║                                        ║');
        console.log('╚════════════════════════════════════════╝');
        console.log('');
        console.log('📲 How to link your device:');
        console.log('   1. Open WhatsApp on your phone');
        console.log('   2. Tap Settings (bottom right)');
        console.log('   3. Go to Linked Devices');
        console.log('   4. Tap "Link with phone number"');
        console.log('   5. Enter the code above ☝️');
        console.log('');
        console.log('⏳ Waiting for you to enter the code...');
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
          console.log('');
          console.log('🔌 Connection lost. Reconnecting in ' + delay + 'ms...');
          console.log('   (attempt ' + reconnectAttempts + '/10)');
          setTimeout(() => connectBot(phoneNumber), delay);
        } else if (statusCode === DisconnectReason.loggedOut) {
          console.log('');
          console.log('🚫 Logged out.');
          console.log('   Delete auth_info_baileys folder and restart.');
          process.exit(1);
        } else {
          console.log('');
          console.log('❌ Max reconnection attempts reached.');
          process.exit(1);
        }
      } else if (connection === 'open') {
        reconnectAttempts = 0;
        console.log('');
        console.log('╔════════════════════════════════════════╗');
        console.log('║     ✅ SimFly Bot CONNECTED! ✅        ║');
        console.log('╚════════════════════════════════════════╝');
        console.log('');
        console.log('🤖 Bot is live and handling messages');
        console.log('👨‍💼 Admin commands: /menu');
        console.log('📍 Business: SimFly Pakistan | Gujranwala');
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
    console.error('');
    console.error('❌ FATAL ERROR:', err.message);
    setTimeout(() => connectBot(phoneNumber), 10000);
  }
}

// ============================
// 5. STARTUP
// ============================
(async () => {
  try {
    const authExists = fs.existsSync('./auth_info_baileys/creds.json');
    let phoneNumber = null;

    if (!authExists) {
      phoneNumber = await askPhoneNumber();
    } else {
      console.log('');
      console.log('✅ Existing session found. Connecting...');
      console.log('   (To re-link, delete auth_info_baileys folder)');
      console.log('');
    }

    await connectBot(phoneNumber);
  } catch (err) {
    console.error('');
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