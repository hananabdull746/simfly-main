const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { PRODUCTS, BUSINESS, RATE_LIMIT } = require('./config');
const { getUser, setUser, createOrder, getOrder, updateOrder, createPayment, saveEskimoAccount, getEskimoAccount } = require('./firebase');
const { callGroqAI, verifyPaymentGemini } = require('./ai');
const { deliverProduct } = require('./delivery');
const { isAdmin, handleAdminCommand, forwardToAdmin } = require('./admin');
const { extractText, isPaymentProof, parseOrderRequest, isEskimoRequest, antiSpamCheck, resetSpam, formatPKR, extractPhoneNumber, extractAccountName } = require('./utils');
const logger = require('pino')({ level: 'info' });

// In-memory state for Eskimo account collection flow
const eskimoState = {};

const WELCOME_TEXT = `👋 *Welcome to SimFly Pakistan!*

🌍 International eSIM Packages
📱 Non-PTA iPhone Specialists
💰 JazzCash & Easypaisa Accepted

*Quick Commands:*
• *BUY 4GB QR* — 4GB eSIM (₨800)
• *BUY 8GB QR* — 8GB eSIM (₨1500)
• *COURSES* — 1000+ PDF (₨999)
• *ESKIMO* — Account Transfer / Top-up
• *PRICE* — View all pricing
• Send payment screenshot after transfer

*${BUSINESS.brand}* 🇵🇰 | ${BUSINESS.location}`;

const WELCOME_URDU = `👋 *SimFly Pakistan mein khush amdeed!*

🌍 International eSIM Packages
📱 Non-PTA iPhone ke liye best
💰 JazzCash & Easypaisa

*Jaldi Commands:*
• *BUY 4GB QR* — 4GB eSIM (₨800)
• *BUY 8GB QR* — 8GB eSIM (₨1500)
• *COURSES* — 1000+ PDF (₨999)
• *ESKIMO* — Account Transfer / Top-up
• *PRICE* — Sab prices dekho
• Payment screenshot bhejo transfer ke baad

*${BUSINESS.brand}* 🇵🇰 | ${BUSINESS.location}`;

const PRICE_TEXT = `💰 *SimFly Pakistan Pricing*

🌐 *Internet Data:*
220 PKR per GB
Formula: GB × 220

📲 *QR Packages:*
• 4GB = 800 PKR
• 8GB = 1500 PKR

📘 *Digital Product:*
1000+ Courses PDF = 999 PKR

📱 *Eskimo Account Transfer:*
Top-up / GB transfer service
(Admin will guide you)

💳 *Payments:* JazzCash & Easypaisa
⚡ *Delivery:* Instant after verification

To order, just send *BUY* or the package name!`;

const PRICE_URDU = `💰 *SimFly Pakistan Prices*

🌐 *Internet Data:*
220 PKR per GB
Formula: GB × 220

📲 *QR Packages:*
• 4GB = 800 PKR
• 8GB = 1500 PKR

📘 *Digital Product:*
1000+ Courses PDF = 999 PKR

📱 *Eskimo Account Transfer:*
Top-up / GB transfer
(Admin guide karega)

💳 *Payments:* JazzCash & Easypaisa
⚡ *Delivery:* Payment verify hone ke baad foran

Order karna hai? *BUY* likho ya package ka naam!`;

const ESKIMO_NO_ACCOUNT_TEXT = `📱 *Aapke paas Eskimo account nahi hai?*

No problem! Pehle free trial le lo:

1️⃣ *App Download karo:*
${BUSINESS.eskimoAppStore}

2️⃣ *Gift Code lagao:*
\u0060FREE500MB\u0060

3️⃣ *Account bana lo* apne phone number se

4️⃣ *Phir yahan aao* aur apna:
   • Phone Number
   • Account Name
   bhejo. Admin transfer kar dega!`;

const ESKIMO_COLLECT_PHONE = `📱 *Eskimo Account Transfer*

Aapka Eskimo account number (phone number) batao:

Format: *03XXXXXXXXX* ya *923XXXXXXXXX*

Example: 03001234567`;

const ESKIMO_COLLECT_NAME = `👤 *Account Name batao*

Aapka Eskimo account pe kya naam likha hai?

Example: Ali Khan`;

const handleMessage = async (msg, sock) => {
  try {
    if (msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return;

    const text = extractText(msg).trim();
    const hasMedia = !!msg.message?.imageMessage || !!msg.message?.documentMessage || !!msg.message?.videoMessage;
    const lower = text.toLowerCase();

    const existingUser = await getUser(jid);
    const nowISO = new Date().toISOString();
    const isNewUser = !existingUser;

    await setUser(jid, {
      jid,
      name: msg.pushName || existingUser?.name || 'User',
      lastActive: nowISO,
      messageCount: (existingUser?.messageCount || 0) + 1,
      banned: existingUser?.banned || false
    });

    if (existingUser?.banned) {
      await sock.sendMessage(jid, { text: '⛔ Your account is restricted. Contact admin.' });
      return;
    }

    // Welcome new users (send both English + Roman Urdu)
    if (isNewUser) {
      await sock.sendMessage(jid, { text: WELCOME_TEXT });
      await sock.sendMessage(jid, { text: WELCOME_URDU });
    }

    // Admin commands
    if (text.startsWith('/') && isAdmin(jid)) {
      const handled = await handleAdminCommand(text, jid, sock, msg);
      if (handled) return;
    }

    // Anti-spam
    if (!isAdmin(jid)) {
      const spamCheck = antiSpamCheck(jid);
      if (spamCheck.blocked) {
        await sock.sendMessage(jid, {
          text: '⏳ *Slow down!* Bohat zyada messages bhej rahe ho. Please wait *' + RATE_LIMIT.blockMinutes + ' minutes* before messaging again.

Ye spam rokne ke liye hai.'
        });
        return;
      }
    }

    // ============================
    // ESKIMO ACCOUNT COLLECTION FLOW
    // ============================
    if (eskimoState[jid] === 'awaiting_phone') {
      const phone = extractPhoneNumber(text);
      if (phone) {
        eskimoState[jid] = { step: 'awaiting_name', phone: phone };
        await sock.sendMessage(jid, { text: ESKIMO_COLLECT_NAME });
        return;
      } else {
        await sock.sendMessage(jid, { text: '❌ Invalid phone number. Please send in format: *03XXXXXXXXX*' });
        return;
      }
    }

    if (eskimoState[jid]?.step === 'awaiting_name') {
      const name = extractAccountName(text) || text.trim();
      const phone = eskimoState[jid].phone;

      // Save to Firebase
      await saveEskimoAccount(jid, {
        phone: phone,
        accountName: name,
        verified: false,
        status: 'pending_transfer'
      });

      delete eskimoState[jid];

      await sock.sendMessage(jid, {
        text: '✅ *Eskimo Account Details Saved!*

📱 Phone: ' + phone + '
👤 Name: ' + name + '

⏳ Admin will verify and process your transfer shortly.

Aapko confirmation message aa jayega.'
      });

      await forwardToAdmin(
        'ESKIMO ACCOUNT DETAILS
👤 ' + jid + '
📱 Phone: ' + phone + '
👤 Name: ' + name + '

Verify and process transfer.',
        sock,
        { type: 'eskimo_account', userJid: jid }
      );
      return;
    }

    // ============================
    // 1. PAYMENT PROOF
    // ============================
    if (isPaymentProof(msg, text)) {
      await sock.sendMessage(jid, {
        text: '⏳ *Payment verify ho rahi hai...*

🤖 AI aapka screenshot scan kar raha hai. Please wait 5-10 seconds.'
      });

      let verification = { status: 'rejected', amount: 0, reason: 'No image attached', gateway: 'unknown' };

      if (msg.message?.imageMessage) {
        try {
          const buffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger: require('pino')({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
          );
          const mimeType = msg.message.imageMessage.mimetype || 'image/jpeg';
          verification = await verifyPaymentGemini(buffer, mimeType, text);

          await forwardToAdmin(
            'Payment proof received\n🤖 Gemini Status: ' + verification.status + '\n💰 Amount: ' + formatPKR(verification.amount) + '\n📝 ' + text,
            sock,
            { type: 'payment_proof', userJid: jid, mediaBuffer: buffer, mimeType }
          );
        } catch (dlErr) {
          logger.error('[DOWNLOAD ERROR]', dlErr);
          verification.reason = 'Failed to download image: ' + dlErr.message;
          await forwardToAdmin('Payment proof download failed\n📝 ' + text, sock, { type: 'payment_error', userJid: jid });
        }
      } else {
        await forwardToAdmin('Text-only payment claim\n📝 ' + text, sock, { type: 'payment_text', userJid: jid });
      }

      const paymentId = await createPayment({
        userJid: jid,
        amount: verification.amount,
        status: verification.status,
        reason: verification.reason,
        gateway: verification.gateway,
        text,
        verifiedBy: 'gemini',
        hasMedia: !!msg.message?.imageMessage
      });

      if (verification.status === 'approved') {
        let productKey = null;
        const amt = verification.amount;

        if (amt >= 900 && amt < 1100) productKey = 'COURSES';
        else if (amt >= 700 && amt < 1100) productKey = 'QR_4GB';
        else if (amt >= 1200 && amt < 1800) productKey = 'QR_8GB';
        else if (amt >= 200 && amt < 700) productKey = 'INTERNET_1GB';

        if (productKey && PRODUCTS[productKey]) {
          const product = PRODUCTS[productKey];
          const qty = product.type === 'internet' ? Math.max(1, Math.round(amt / product.price)) : 1;

          const order = await createOrder({
            userJid: jid,
            productKey,
            productName: product.name,
            qty,
            amount: verification.amount,
            status: 'approved',
            paymentId,
            paymentStatus: 'verified_auto',
            verifiedBy: 'gemini'
          });

          await sock.sendMessage(jid, {
            text: '✅ *Payment Verified: ' + formatPKR(verification.amount) + '*

🤖 AI matched to *' + product.name + '*
🆔 Order: *' + order.id + '*

📦 Auto-delivering now...'
          });

          await deliverProduct(order, sock);

          await forwardToAdmin(
            'AUTO-DELIVERED\n🆔 ' + order.id + '\n📦 ' + product.name + '\n💰 ' + formatPKR(verification.amount) + '\n🤖 Gemini verified',
            sock,
            { type: 'auto_delivery', userJid: jid }
          );
        } else {
          await sock.sendMessage(jid, {
            text: '✅ *Payment of ' + formatPKR(verification.amount) + ' verified!*

⚠️ Lekin amount kisi standard package se match nahi kar raha. Admin review karega aur 15 minutes mein deliver karega.

🆔 Payment ID: *' + paymentId + '*'
          });
          await forwardToAdmin(
            'Payment verified but NO AUTO-MATCH\n💰 ' + formatPKR(verification.amount) + '\n🆔 Payment: ' + paymentId + '\n📝 ' + text,
            sock,
            { type: 'manual_review', userJid: jid }
          );
        }
      } else {
        await sock.sendMessage(jid, {
          text: '❌ *Payment Verification Failed*

*Reason:* ' + verification.reason + '

Please ensure your screenshot shows:
✅ JazzCash ya Easypaisa receipt
✅ Paid amount clearly
✅ SUCCESS / COMPLETED status
✅ Transaction ID

Phir se screenshot bhejo. Ya admin se contact karo.'
        });

        await forwardToAdmin(
          'Payment REJECTED by Gemini\n💰 Claimed: ' + text + '\n❌ Reason: ' + verification.reason + '\n🆔 Payment: ' + paymentId,
          sock,
          { type: 'payment_rejected', userJid: jid }
        );
      }
      return;
    }

    // ============================
    // 2. ESKIMO REQUEST
    // ============================
    if (isEskimoRequest(text)) {
      const existingEskimo = await getEskimoAccount(jid);

      if (existingEskimo && existingEskimo.phone && existingEskimo.accountName) {
        // Already has account on file
        const order = await createOrder({
          userJid: jid,
          productKey: 'ESKIMO',
          productName: 'Eskimo Account Transfer',
          qty: 1,
          amount: 0,
          status: 'pending',
          paymentStatus: 'unpaid',
          eskimoPhone: existingEskimo.phone,
          eskimoName: existingEskimo.accountName
        });

        resetSpam(jid);

        await sock.sendMessage(jid, {
          text: '📱 *Eskimo Transfer Request*

Aapka saved account:
📱 ' + existingEskimo.phone + '
👤 ' + existingEskimo.accountName + '

🆔 Order ID: *' + order.id + '*

💰 *Payment bhejo:*
JazzCash ya Easypaisa se payment karo, aur screenshot yahan bhejo.

Admin verify karke transfer kar dega.'
        });

        await forwardToAdmin(
          'ESKIMO TRANSFER REQUEST (Returning Customer)\n👤 ' + jid + '\n📱 ' + existingEskimo.phone + '\n👤 ' + existingEskimo.accountName + '\n🆔 ' + order.id,
          sock,
          { type: 'eskimo_transfer', userJid: jid }
        );
      } else {
        // New Eskimo user — start collection flow
        eskimoState[jid] = 'awaiting_phone';

        await sock.sendMessage(jid, { text: ESKIMO_NO_ACCOUNT_TEXT });
        await new Promise(r => setTimeout(r, 1500));
        await sock.sendMessage(jid, { text: ESKIMO_COLLECT_PHONE });
      }
      return;
    }

    // ============================
    // 3. ORDER REQUESTS
    // ============================
    const orderReq = parseOrderRequest(text);
    if (orderReq) {
      const product = PRODUCTS[orderReq.productKey];
      const total = product.type === 'internet' ? product.price * orderReq.qty : product.price;

      const order = await createOrder({
        userJid: jid,
        productKey: orderReq.productKey,
        productName: product.name,
        qty: orderReq.qty,
        amount: total,
        status: 'pending',
        paymentStatus: 'unpaid'
      });

      resetSpam(jid);

      let orderMsg = '🛒 *Order Created Successfully!*

📦 *' + product.name + '*
';
      if (product.unit) orderMsg += '🔢 Quantity: ' + orderReq.qty + ' ' + product.unit + '
';
      else orderMsg += '🔢 Quantity: ' + orderReq.qty + '
';
      orderMsg += '💰 *Total: ' + formatPKR(total) + '*
🆔 Order ID: *' + order.id + '*

📲 *Next Step:*
Send *' + formatPKR(total) + '* via JazzCash or Easypaisa to our account, then send the payment screenshot here.

⚡ Delivery is instant after verification!

*' + BUSINESS.brand + '* 🇵🇰';

      await sock.sendMessage(jid, { text: orderMsg });

      await forwardToAdmin(
        'NEW ORDER\n👤 ' + jid + '\n📦 ' + product.name + ' x' + orderReq.qty + '\n💰 ' + formatPKR(total) + '\n🆔 ' + order.id,
        sock,
        { type: 'new_order', userJid: jid }
      );
      return;
    }

    // ============================
    // 4. GB TRANSFER / SPECIAL
    // ============================
    if (/(transfer|migrate|move|shift|port)/.test(lower) && /(gb|data|esim|qr)/.test(lower)) {
      await sock.sendMessage(jid, {
        text: '📡 *GB Transfer / Migration Request Received*

Aapki request admin ko forward kar di gayi hai. Ye manual process hai.

⏳ Expected response: 10-30 minutes'
      });
      await forwardToAdmin(
        'GB TRANSFER REQUEST\n👤 ' + jid + '\n📝 ' + text,
        sock,
        { type: 'gb_transfer', userJid: jid }
      );
      return;
    }

    // ============================
    // 5. PRICE INQUIRY
    // ============================
    if (/(price|pricing|rate|cost|kitne|price list|kitna|rate)/.test(lower)) {
      await sock.sendMessage(jid, { text: PRICE_TEXT });
      await sock.sendMessage(jid, { text: PRICE_URDU });
      return;
    }

    // ============================
    // 6. NORMAL CHAT → GROQ AI
    // ============================
    const context = isNewUser ? 'New user' : 'Returning user (msgs: ' + (existingUser?.messageCount || 1) + ')';
    const aiReply = await callGroqAI(text, context);

    await sock.sendMessage(jid, { text: aiReply });

  } catch (err) {
    logger.error('[HANDLER ERROR]', err);
    try {
      if (msg.key.remoteJid) {
        await sock.sendMessage(msg.key.remoteJid, {
          text: '⚠️ Koi unexpected error aaya hai. Team ko notify kar diya gaya hai. Please try again ya admin se contact karo.'
        });
      }
    } catch (e) {}
  }
};

module.exports = { handleMessage };