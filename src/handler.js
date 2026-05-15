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

const WELCOME_TEXT = '👋 *Welcome to SimFly Pakistan!*\n\n🌍 International eSIM Packages\n📱 Non-PTA iPhone Specialists\n💰 JazzCash & Easypaisa Accepted\n\n*Quick Commands:*\n• *BUY 4GB QR* — 4GB eSIM (₨800)\n• *BUY 8GB QR* — 8GB eSIM (₨1500)\n• *COURSES* — 1000+ PDF (₨999)\n• *ESKIMO* — Account Transfer / Top-up\n• *PRICE* — View all pricing\n• Send payment screenshot after transfer\n\n*' + BUSINESS.brand + '* 🇵🇰 | ' + BUSINESS.location;

const WELCOME_URDU = '👋 *SimFly Pakistan mein khush amdeed!*\n\n🌍 International eSIM Packages\n📱 Non-PTA iPhone ke liye best\n💰 JazzCash & Easypaisa\n\n*Jaldi Commands:*\n• *BUY 4GB QR* — 4GB eSIM (₨800)\n• *BUY 8GB QR* — 8GB eSIM (₨1500)\n• *COURSES* — 1000+ PDF (₨999)\n• *ESKIMO* — Account Transfer / Top-up\n• *PRICE* — Sab prices dekho\n• Payment screenshot bhejo transfer ke baad\n\n*' + BUSINESS.brand + '* 🇵🇰 | ' + BUSINESS.location;

const PRICE_TEXT = '💰 *SimFly Pakistan Pricing*\n\n🌐 *Internet Data:*\n220 PKR per GB\nFormula: GB × 220\n\n📲 *QR Packages:*\n• 4GB = 800 PKR\n• 8GB = 1500 PKR\n\n📘 *Digital Product:*\n1000+ Courses PDF = 999 PKR\n\n📱 *Eskimo Account Transfer:*\nTop-up / GB transfer service\n(Admin will guide you)\n\n💳 *Payments:* JazzCash & Easypaisa\n⚡ *Delivery:* Instant after verification\n\nTo order, just send *BUY* or the package name!';

const PRICE_URDU = '💰 *SimFly Pakistan Prices*\n\n🌐 *Internet Data:*\n220 PKR per GB\nFormula: GB × 220\n\n📲 *QR Packages:*\n• 4GB = 800 PKR\n• 8GB = 1500 PKR\n\n📘 *Digital Product:*\n1000+ Courses PDF = 999 PKR\n\n📱 *Eskimo Account Transfer:*\nTop-up / GB transfer\n(Admin guide karega)\n\n💳 *Payments:* JazzCash & Easypaisa\n⚡ *Delivery:* Payment verify hone ke baad foran\n\nOrder karna hai? *BUY* likho ya package ka naam!';

const ESKIMO_NO_ACCOUNT_TEXT = '📱 *Aapke paas Eskimo account nahi hai?*\n\nNo problem! Pehle free trial le lo:\n\n1️⃣ *App Download karo:*\n' + BUSINESS.eskimoAppStore + '\n\n2️⃣ *Gift Code lagao:*\n' + BUSINESS.eskimoGiftCode + '\n\n3️⃣ *Account bana lo* apne phone number se\n\n4️⃣ *Phir yahan aao* aur apna:\n   • Phone Number\n   • Account Name\n   bhejo. Admin transfer kar dega!';

const ESKIMO_COLLECT_PHONE = '📱 *Eskimo Account Transfer*\n\nAapka Eskimo account number (phone number) batao:\n\nFormat: *03XXXXXXXXX* ya *923XXXXXXXXX*\n\nExample: 03001234567';

const ESKIMO_COLLECT_NAME = '👤 *Account Name batao*\n\nAapka Eskimo account pe kya naam likha hai?\n\nExample: Ali Khan';

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
          text: '⏳ *Slow down!* Bohat zyada messages bhej rahe ho. Please wait *' + RATE_LIMIT.blockMinutes + ' minutes* before messaging again.\n\nYe spam rokne ke liye hai.'
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

      await saveEskimoAccount(jid, {
        phone: phone,
        accountName: name,
        verified: false,
        status: 'pending_transfer'
      });

      delete eskimoState[jid];

      await sock.sendMessage(jid, {
        text: '✅ *Eskimo Account Details Saved!*\n\n📱 Phone: ' + phone + '\n👤 Name: ' + name + '\n\n⏳ Admin will verify and process your transfer shortly.\n\nAapko confirmation message aa jayega.'
      });

      await forwardToAdmin(
        'ESKIMO ACCOUNT DETAILS\n👤 ' + jid + '\n📱 Phone: ' + phone + '\n👤 Name: ' + name + '\n\nVerify and process transfer.',
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
        text: '⏳ *Payment verify ho rahi hai...*\n\n🤖 AI aapka screenshot scan kar raha hai. Please wait 5-10 seconds.'
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
            text: '✅ *Payment Verified: ' + formatPKR(verification.amount) + '*\n\n🤖 AI matched to *' + product.name + '*\n🆔 Order: *' + order.id + '*\n\n📦 Auto-delivering now...'
          });

          await deliverProduct(order, sock);

          await forwardToAdmin(
            'AUTO-DELIVERED\n🆔 ' + order.id + '\n📦 ' + product.name + '\n💰 ' + formatPKR(verification.amount) + '\n🤖 Gemini verified',
            sock,
            { type: 'auto_delivery', userJid: jid }
          );
        } else {
          await sock.sendMessage(jid, {
            text: '✅ *Payment of ' + formatPKR(verification.amount) + ' verified!*\n\n⚠️ Lekin amount kisi standard package se match nahi kar raha. Admin review karega aur 15 minutes mein deliver karega.\n\n🆔 Payment ID: *' + paymentId + '*'
          });
          await forwardToAdmin(
            'Payment verified but NO AUTO-MATCH\n💰 ' + formatPKR(verification.amount) + '\n🆔 Payment: ' + paymentId + '\n📝 ' + text,
            sock,
            { type: 'manual_review', userJid: jid }
          );
        }
      } else {
        await sock.sendMessage(jid, {
          text: '❌ *Payment Verification Failed*\n\n*Reason:* ' + verification.reason + '\n\nPlease ensure your screenshot shows:\n✅ JazzCash ya Easypaisa receipt\n✅ Paid amount clearly\n✅ SUCCESS / COMPLETED status\n✅ Transaction ID\n\nPhir se screenshot bhejo. Ya admin se contact karo.'
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
          text: '📱 *Eskimo Transfer Request*\n\nAapka saved account:\n📱 ' + existingEskimo.phone + '\n👤 ' + existingEskimo.accountName + '\n\n🆔 Order ID: *' + order.id + '*\n\n💰 *Payment bhejo:*\nJazzCash ya Easypaisa se payment karo, aur screenshot yahan bhejo.\n\nAdmin verify karke transfer kar dega.'
        });

        await forwardToAdmin(
          'ESKIMO TRANSFER REQUEST (Returning Customer)\n👤 ' + jid + '\n📱 ' + existingEskimo.phone + '\n👤 ' + existingEskimo.accountName + '\n🆔 ' + order.id,
          sock,
          { type: 'eskimo_transfer', userJid: jid }
        );
      } else {
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

      let orderMsg = '🛒 *Order Created Successfully!*\n\n📦 *' + product.name + '*\n';
      if (product.unit) orderMsg += '🔢 Quantity: ' + orderReq.qty + ' ' + product.unit + '\n';
      else orderMsg += '🔢 Quantity: ' + orderReq.qty + '\n';
      orderMsg += '💰 *Total: ' + formatPKR(total) + '*\n🆔 Order ID: *' + order.id + '*\n\n📲 *Next Step:*\nSend *' + formatPKR(total) + '* via JazzCash or Easypaisa to our account, then send the payment screenshot here.\n\n⚡ Delivery is instant after verification!\n\n*' + BUSINESS.brand + '* 🇵🇰';

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
        text: '📡 *GB Transfer / Migration Request Received*\n\nAapki request admin ko forward kar di gayi hai. Ye manual process hai.\n\n⏳ Expected response: 10-30 minutes'
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