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

const logger = P({ level: 'info', timestamp: () => `,"time":"${new Date().toISOString()}"` });

let sock = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Connect to WhatsApp with Baileys
 */
async function connectBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      logger: P({ level: 'silent' }),
      printQRInTerminal: true,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' }))
      },
      browser: ['SimFlyBot', 'Chrome', '1.0'],
      markOnlineOnConnect: true,
      syncFullHistory: false,
      shouldIgnoreJid: (jid) => {
        // Ignore group chats and status to save resources
        return jid?.endsWith('@g.us') || jid === 'status@broadcast';
      },
      getMessage: async () => undefined // Required for retrying messages
    });

    // Save credentials on update
    sock.ev.on('creds.update', saveCreds);

    // Connection state handler
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('📱 Scan the QR code above with WhatsApp');
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error instanceof Boom) 
          ? lastDisconnect.error.output.statusCode 
          : null;

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const delay = Math.min(5000 * reconnectAttempts, 30000);
          logger.info(`🔌 Connection closed (reason: ${statusCode}). Reconnecting in ${delay}ms... (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
          setTimeout(connectBot, delay);
        } else if (statusCode === DisconnectReason.loggedOut) {
          logger.error('🚫 Logged out. Delete ./auth_info_baileys folder and scan QR again.');
          process.exit(1);
        } else {
          logger.error('❌ Max reconnection attempts reached. Exiting.');
          process.exit(1);
        }
      } else if (connection === 'open') {
        reconnectAttempts = 0;
        logger.info('✅ SimFly Bot connected to WhatsApp!');
        logger.info(`🤖 Admin commands: /menu`);
      }
    });

    // Message handler
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        try {
          // Skip status and group messages (double check)
          const jid = msg.key.remoteJid;
          if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

          await handleMessage(msg, sock);
        } catch (err) {
          logger.error('[MESSAGE ERROR]', err);
        }
      }
    });

    // Auto-reject calls (prevents disruption)
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

    // Log errors
    sock.ev.on('error', (err) => {
      logger.error('[SOCKET ERROR]', err);
    });

  } catch (err) {
    logger.error('[FATAL CONNECT ERROR]', err);
    setTimeout(connectBot, 10000);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('🛑 Shutting down SimFly Bot...');
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  logger.error('[UNHANDLED REJECTION]', err);
});

// Start bot
connectBot();