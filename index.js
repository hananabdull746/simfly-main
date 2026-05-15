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

const logger = P({ level: 'info', timestamp: () => `,"time":"${new Date().toISOString()}"` });

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
      logger.info(`✓ ${pkg} installed`);
    } catch (e) {
      logger.info(`⏳ Installing ${pkg}...`);
      try {
        execSync(`npm install ${pkg}`, { stdio: 'inherit', cwd: __dirname });
        installed++;
        logger.info(`✅ ${pkg} installed successfully`);
      } catch (installErr) {
        logger.error(`❌ Failed to install ${pkg}:`, installErr.message);
        failed++;
      }
    }
  }

  if (failed > 0) {
    logger.error(`❌ ${failed} package(s) failed to install. Please run: npm install`);
    process.exit(1);
  }

  if (installed > 0) {
    logger.info(`🔄 Restarting to load newly installed packages...`);
    process.exit(0); // PM2 will auto-restart if configured, otherwise user re-runs
  }

  logger.info('✅ All dependencies verified');
}

ensureDependencies();

// ============================
// 2. VERIFY ENV FILES
// ============================
if (!fs.existsSync('./.env')) {
  logger.error('❌ .env file not found! Please create it from .env.example');
  logger.info('   cp .env.example .env && nano .env');
  process.exit(1);
}

if (!fs.existsSync('./serviceAccountKey.json')) {
  logger.error('❌ serviceAccountKey.json not found! Please add your Firebase credentials.');
  process.exit(1);
}

// ============================
// 3. PHONE NUMBER INPUT
// ============================
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askPhoneNumber() {
  return new Promise((resolve) => {
    logger.info('');
    logger.info('========================================');
    logger.info('   SimFly Pakistan WhatsApp Bot');
    logger.info('========================================');
    logger.info('');
    logger.info('📱 Enter your WhatsApp bot number');
    logger.info('   Format: 923001234567 (with country code, no +)');
    logger.info('   Supports all 200+ countries');
    logger.info('');

    rl.question('Enter number: ', (input) => {
      const clean = input.replace(/\D/g, ''); // Remove all non-digits

      if (clean.length < 10 || clean.length > 15) {
        logger.error('❌ Invalid number. Must be 10-15 digits with country code.');
        logger.info('   Example: 923001234567 (Pakistan)');
        logger.info('   Example: 14155552671 (USA)');
        rl.close();
        process.exit(1);
      }

      logger.info(`✅ Number accepted: ${clean}`);
      resolve(clean);
    });
  });
}

// ============================
// 4. BOT CONNECTION
// ============================
let sock = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

async function connectBot(phoneNumber) {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
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
      getMessage: async () => undefined,
      // Pairing code enabled
      pairingCode: true,
      phoneNumber: phoneNumber
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      // Show pairing code instantly when available
      if (update.pairingCode) {
        logger.info('');
        logger.info('========================================');
        logger.info('🔑 YOUR PAIRING CODE');
        logger.info('========================================');
        logger.info('');
        logger.info(`   ${update.pairingCode}`);
        logger.info('');
        logger.info('📲 How to link:');
        logger.info('   1. Open WhatsApp on your phone');
        logger.info('   2. Go to: Settings → Linked Devices');
        logger.info('   3. Tap: Link with phone number');
        logger.info('   4. Enter the code above ↑');
        logger.info('');
        logger.info('========================================');
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect && lastDisconnect.error instanceof Boom) 
          ? lastDisconnect.error.output.statusCode 
          : null;

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const delay = Math.min(5000 * reconnectAttempts, 30000);
          logger.info(`🔌 Connection closed. Reconnecting in ${delay}ms... (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
          setTimeout(() => connectBot(phoneNumber), delay);
        } else if (statusCode === DisconnectReason.loggedOut) {
          logger.error('🚫 Logged out. Delete ./auth_info_baileys folder and restart.');
          process.exit(1);
        } else {
          logger.error('❌ Max reconnection attempts reached.');
          process.exit(1);
        }
      } else if (connection === 'open') {
        reconnectAttempts = 0;
        logger.info('');
        logger.info('✅✅✅ SimFly Bot CONNECTED! ✅✅✅');
        logger.info('');
        logger.info('🤖 Bot is now live and handling messages');
        logger.info('👨‍💼 Admin commands: /menu');
        logger.info('');
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
          logger.error('[MESSAGE ERROR]', err);
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
      logger.error('[SOCKET ERROR]', err);
    });

  } catch (err) {
    logger.error('[FATAL CONNECT ERROR]', err);
    setTimeout(() => connectBot(phoneNumber), 10000);
  }
}

// ============================
// 5. STARTUP
// ============================
(async () => {
  try {
    const phoneNumber = await askPhoneNumber();
    rl.close();
    await connectBot(phoneNumber);
  } catch (err) {
    logger.error('[STARTUP ERROR]', err);
    process.exit(1);
  }
})();

process.on('SIGINT', () => {
  logger.info('🛑 Shutting down SimFly Bot...');
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  logger.error('[UNHANDLED REJECTION]', err);
});