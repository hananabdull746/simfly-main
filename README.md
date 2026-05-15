# SimFly Pakistan — WhatsApp Bot

**Production-ready WhatsApp automation for SimFly Pakistan**  
Built with Node.js + Baileys + Firebase + Groq AI + Gemini Vision.

---

## 🚀 Features

| Feature | Tech |
|---------|------|
| WhatsApp Connection | Baileys (Multi-device) |
| Database | Firebase Firestore (via firebase-admin) |
| AI Support & Sales | Groq API — `llama-3.1-8b-instant` (free tier: 30 RPM / 14,400 RPD) |
| Payment Verification | Google Gemini Vision API |
| Auto Delivery | QR Images + Google Drive PDFs |
| Admin Panel | Slash commands (`/menu`) |
| Anti-Spam | In-memory rate limiter |
| Session Persistence | Multi-file auth state |
| Auto Reconnect | Exponential backoff |

---

## 📁 Project Structure

```
simfly-bot/
├── index.js                 # Entry point (Baileys connection)
├── src/
│   ├── config.js            # Env & business config
│   ├── firebase.js          # Firestore helpers
│   ├── ai.js                # Groq + Gemini APIs
│   ├── delivery.js          # Auto-delivery engine
│   ├── admin.js             # Admin commands & forwarding
│   ├── utils.js             # Spam guard, parsers
│   └── handler.js           # Message router
├── package.json
├── .env.example
└── serviceAccountKey.json   # Firebase credentials (you add this)
```

---

## ⚙️ Setup

### 1. Prerequisites
- Node.js 18+ LTS
- Firebase Project with Firestore enabled
- Groq API — `llama-3.1-8b-instant` (free tier: 30 RPM / 14,400 RPD) key
- Google Gemini API key
- WhatsApp number (dedicated)

### 2. Install
```bash
cd simfly-bot
npm install
```

### 3. Firebase Credentials
1. Go to Firebase Console → Project Settings → Service Accounts
2. Click **Generate new private key**
3. Save as `serviceAccountKey.json` in the project root

### 4. Environment Variables
```bash
cp .env.example .env
# Edit .env with your keys
```

### 5. Run
```bash
node index.js
```
Scan the QR code in terminal with WhatsApp → Linked Devices.

---

## 🤖 Bot Flow

1. **User sends message** → Anti-spam check
2. **Payment screenshot?** → Gemini verifies → Auto-deliver if approved
3. **Order keyword?** → Create order → Forward admin → Await payment
4. **GB transfer?** → Forward admin for manual processing
5. **Normal chat / FAQ** → Grok AI replies as SimFly Support Agent
6. **Admin commands** → `/menu`, `/orders`, `/approve`, `/broadcast`, `/stats`

---

## 🏷️ Products Configured

- **Internet Data**: ₨220 / GB (custom quantity)
- **4GB QR Package**: ₨800
- **8GB QR Package**: ₨1500
- **1000+ Courses PDF**: ₨999 (Google Drive delivery)

---

## 🛡️ Admin Commands

| Command | Action |
|---------|--------|
| `/menu` | Show admin panel |
| `/orders` | List pending orders |
| `/allorders` | Last 50 orders |
| `/order [id]` | View order details |
| `/approve [id]` | Approve & auto-deliver |
| `/reject [id]` | Reject order |
| `/broadcast [text]` | Message all users |
| `/stats` | Bot analytics |
| `/users` | Recent users |
| `/products` | Product catalog |

---

## 🔒 Anti-Spam
- Max 12 messages per 60 seconds per user
- 3-minute block if exceeded
- Resets on successful order creation

---

## 📞 Support
**SimFly Pakistan**  
Owner: Abdull Hanan  
Location: Gujranwala, Punjab, Pakistan

---

## ⚠️ Disclaimer
This bot uses Baileys, an unofficial WhatsApp Web API. Use responsibly. For large-scale operations, migrate to the official WhatsApp Business API.
