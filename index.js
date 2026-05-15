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
  'ngrok'
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
    logger.info('Dependencies installed. Please restart.');
    process.exit(0);
  }
}
ensureDependencies();

const ngrok = require('ngrok');

// ============================
// 2. VERIFY ENV FILES
// ============================
if (!fs.existsSync('./.env')) {
  logger.error('.env file not found! Create it from .env.example');
  process.exit(1);
}
if (!fs.existsSync('./serviceAccountKey.json')) {
  logger.error('serviceAccountKey.json not found!');
  process.exit(1);
}

// ============================
// 3. GLOBAL STATE
// ============================
let globalState = {
  pairingCode: null,
  connectionStatus: 'connecting',
  botPhone: null,
  ngrokUrl: null,
  logs: []
};

function addLog(msg) {
  const line = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  globalState.logs.push(line);
  if (globalState.logs.length > 50) globalState.logs.shift();
  console.log(line);
}

// ============================
// 4. PHONE NUMBER INPUT
// ============================
function askPhoneNumber() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('');
    console.log('========================================');
    console.log('   SimFly Pakistan WhatsApp Bot');
    console.log('========================================');
    console.log('');
    console.log('Enter your WhatsApp bot number');
    console.log('Format: 923001234567 (country code, no +)');
    console.log('Examples: 923001234567 | 14155552671 | 447911123456');
    console.log('');
    rl.question('Phone number: ', (input) => {
      rl.close();
      const clean = input.replace(/\D/g, '');
      if (clean.length < 10 || clean.length > 15) {
        console.log('❌ Invalid number. Must be 10-15 digits.');
        process.exit(1);
      }
      console.log('✅ Number accepted: ' + clean);
      resolve(clean);
    });
  });
}

// ============================
// 5. WEB SERVER
// ============================
let webPort = 0;

function startWebServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          pairingCode: globalState.pairingCode,
          status: globalState.connectionStatus,
          botPhone: globalState.botPhone,
          ngrokUrl: globalState.ngrokUrl,
          timestamp: Date.now()
        }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SimFly Pakistan - Bot Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      box-shadow: 0 25px 50px rgba(0,0,0,0.3);
      max-width: 500px;
      width: 100%;
      padding: 40px;
      text-align: center;
    }
    .logo { font-size: 60px; margin-bottom: 10px; }
    h1 { color: #25d366; font-size: 28px; margin-bottom: 5px; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 30px; }
    .ngrok-box {
      background: #e7f3ff;
      border-radius: 12px;
      padding: 15px;
      margin: 15px 0;
      word-break: break-all;
    }
    .ngrok-box a { color: #004085; font-weight: 600; text-decoration: none; }
    .ngrok-box a:hover { text-decoration: underline; }
    .status-box {
      background: #f8f9fa;
      border-radius: 15px;
      padding: 25px;
      margin: 20px 0;
      border: 2px solid #e9ecef;
    }
    .status-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
    .status-value { font-size: 18px; font-weight: 600; color: #333; }
    .status-value.connected { color: #25d366; }
    .status-value.connecting { color: #f0ad4e; }
    .pairing-box {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 15px;
      padding: 30px;
      margin: 20px 0;
      color: white;
    }
    .pairing-box h2 { font-size: 16px; margin-bottom: 15px; opacity: 0.9; }
    .pairing-code {
      font-size: 42px;
      font-weight: bold;
      letter-spacing: 8px;
      font-family: 'Courier New', monospace;
      text-shadow: 0 2px 4px rgba(0,0,0,0.2);
      margin: 15px 0;
    }
    .steps {
      text-align: left;
      background: #fff3cd;
      border-radius: 12px;
      padding: 20px;
      margin: 20px 0;
      border-left: 4px solid #ffc107;
    }
    .steps h3 { color: #856404; margin-bottom: 12px; font-size: 14px; }
    .steps ol { margin: 0; padding-left: 20px; }
    .steps li { margin: 8px 0; color: #856404; font-size: 14px; line-height: 1.5; }
    .phone-display {
      background: #e7f3ff;
      border-radius: 10px;
      padding: 12px;
      margin: 15px 0;
      font-size: 16px;
      color: #004085;
      font-weight: 600;
    }
    .loader {
      border: 3px solid #f3f3f3;
      border-top: 3px solid #667eea;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      color: #aaa;
      font-size: 12px;
    }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">📱</div>
    <h1>SimFly Pakistan</h1>
    <div class="subtitle">WhatsApp Bot Dashboard</div>

    <div id="ngrokBox" class="ngrok-box hidden">
      <div style="font-size:12px;color:#666;margin-bottom:8px;">🌐 Public URL (Open anywhere)</div>
      <a id="ngrokUrl" href="#" target="_blank">-</a>
    </div>

    <div class="status-box">
      <div class="status-label">Connection Status</div>
      <div class="status-value connecting" id="statusText">Connecting...</div>
    </div>

    <div id="phoneBox" class="phone-display hidden">
      Bot Number: <span id="phoneNumber">-</span>
    </div>

    <div id="pairingSection">
      <div class="loader" id="loader"></div>
      <div id="pairingBox" class="pairing-box hidden">
        <h2>🔑 Your Pairing Code</h2>
        <div class="pairing-code" id="pairingCode">----</div>
        <div style="opacity:0.8;font-size:12px;margin-top:10px;">Code refreshes every 60 seconds</div>
      </div>

      <div class="steps" id="stepsBox">
        <h3>📲 How to Link Your Device</h3>
        <ol>
          <li>Open <b>WhatsApp</b> on your phone</li>
          <li>Tap <b>Settings</b> (bottom right)</li>
          <li>Go to <b>Linked Devices</b></li>
          <li>Tap <b>Link with phone number</b></li>
          <li>Enter the code above</li>
        </ol>
      </div>
    </div>

    <div id="connectedSection" class="hidden">
      <div class="status-box">
        <div class="status-label">Bot Status</div>
        <div class="status-value connected">🟢 ONLINE</div>
      </div>
      <p style="color: #666; margin-top: 15px; font-size: 14px;">
        Bot is live and handling messages.<br>
        Admin commands: <code>/menu</code>
      </p>
    </div>

    <div class="footer">
      SimFly Pakistan | Gujranwala, Punjab 🇵🇰<br>
      Non-PTA iPhone Specialists
    </div>
  </div>

  <script>
    const statusText = document.getElementById('statusText');
    const pairingCode = document.getElementById('pairingCode');
    const pairingBox = document.getElementById('pairingBox');
    const loader = document.getElementById('loader');
    const phoneBox = document.getElementById('phoneBox');
    const phoneNumber = document.getElementById('phoneNumber');
    const pairingSection = document.getElementById('pairingSection');
    const connectedSection = document.getElementById('connectedSection');
    const ngrokBox = document.getElementById('ngrokBox');
    const ngrokUrl = document.getElementById('ngrokUrl');

    async function checkStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        if (data.ngrokUrl) {
          ngrokUrl.href = data.ngrokUrl;
          ngrokUrl.textContent = data.ngrokUrl;
          ngrokBox.classList.remove('hidden');
        }

        if (data.status === 'connected') {
          statusText.textContent = 'Connected';
          statusText.className = 'status-value connected';
          pairingSection.classList.add('hidden');
          connectedSection.classList.remove('hidden');
          if (data.botPhone) {
            phoneNumber.textContent = '+' + data.botPhone;
            phoneBox.classList.remove('hidden');
          }
        } else if (data.status === 'connecting') {
          statusText.textContent = 'Waiting for pairing code...';
          statusText.className = 'status-value connecting';

          if (data.pairingCode) {
            loader.classList.add('hidden');
            pairingBox.classList.remove('hidden');
            if (pairingCode.textContent !== data.pairingCode) {
              pairingCode.textContent = data.pairingCode;
            }
          }

          if (data.botPhone) {
            phoneNumber.textContent = '+' + data.botPhone;
            phoneBox.classList.remove('hidden');
          }
        }
      } catch (e) {
        statusText.textContent = 'Server unreachable';
        statusText.className = 'status-value error';
      }
    }

    checkStatus();
    setInterval(checkStatus, 2000);
  </script>
</body>
</html>`);
    });

    server.listen(0, '127.0.0.1', async () => {
      webPort = server.address().port;
      console.log('');
      console.log('🌐 Local web server started on port ' + webPort);

      // Start ngrok tunnel
      try {
        const url = await ngrok.connect({
          addr: webPort,
          authtoken: process.env.NGROK_AUTHTOKEN || undefined
        });
        globalState.ngrokUrl = url;
        console.log('');
        console.log('🌍 NGROK PUBLIC URL:');
        console.log('   ' + url);
        console.log('');
        console.log('📱 Open this URL on your PHONE or COMPUTER');
        console.log('   (No firewall config needed!)');
        console.log('');
      } catch (err) {
        console.log('⚠️  Ngrok failed: ' + err.message);
        console.log('   Public URL not available. Using localhost only.');
      }

      resolve();
    });
  });
}

// ============================
// 6. BOT CONNECTION
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
      globalState.botPhone = phoneNumber;
    }

    sock = makeWASocket(sockConfig);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (update.pairingCode) {
        globalState.pairingCode = update.pairingCode;
        globalState.connectionStatus = 'connecting';
        addLog('Pairing code: ' + update.pairingCode);
      }

      if (connection === 'close') {
        globalState.connectionStatus = 'error';
        globalState.pairingCode = null;
        const statusCode = (lastDisconnect && lastDisconnect.error instanceof Boom) 
          ? lastDisconnect.error.output.statusCode 
          : null;

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect && reconnectAttempts < 10) {
          reconnectAttempts++;
          const delay = Math.min(5000 * reconnectAttempts, 30000);
          addLog('Reconnecting in ' + delay + 'ms (attempt ' + reconnectAttempts + ')');
          setTimeout(() => connectBot(phoneNumber), delay);
        } else if (statusCode === DisconnectReason.loggedOut) {
          addLog('Logged out. Delete auth_info_baileys and restart.');
          process.exit(1);
        } else {
          addLog('Max reconnection attempts reached.');
          process.exit(1);
        }
      } else if (connection === 'open') {
        reconnectAttempts = 0;
        globalState.connectionStatus = 'connected';
        globalState.pairingCode = null;
        addLog('✅ Bot connected!');
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
    addLog('FATAL ERROR: ' + err.message);
    setTimeout(() => connectBot(phoneNumber), 10000);
  }
}

// ============================
// 7. STARTUP
// ============================
(async () => {
  try {
    await startWebServer();

    const authExists = fs.existsSync('./auth_info_baileys/creds.json');
    let phoneNumber = null;

    if (!authExists) {
      phoneNumber = await askPhoneNumber();
    } else {
      console.log('');
      console.log('✅ Existing session found. Connecting...');
      console.log('');
    }

    await connectBot(phoneNumber);
  } catch (err) {
    console.error('STARTUP ERROR:', err);
    process.exit(1);
  }
})();

process.on('SIGINT', () => {
  console.log('Shutting down...');
  ngrok.kill().catch(() => {});
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED:', err);
});