const NodeCache = require('node-cache');
const { RATE_LIMIT } = require('./config');

const spamCache = new NodeCache({ stdTTL: RATE_LIMIT.windowSeconds, checkperiod: 30 });

const extractText = (msg) => {
  if (!msg?.message) return '';
  const m = msg.message;
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  if (m.documentMessage?.caption) return m.documentMessage.caption;
  if (m.buttonsResponseMessage?.selectedButtonId) return m.buttonsResponseMessage.selectedButtonId;
  if (m.listResponseMessage?.title) return m.listResponseMessage.title;
  return '';
};

const isPaymentProof = (msg, text) => {
  const lower = text.toLowerCase();
  const hasImage = !!msg.message?.imageMessage;
  const hasDocument = !!msg.message?.documentMessage;
  const paymentKeywords = /(payment|paid|pay|send|sent|receipt|screenshot|jazzcash|easypaisa|transaction|trx|transfer|deposit|proof|rs|pkr|rupee)/;
  const amountPattern = /(\d{3,5})\s*(pkr|rs|rupees?|₨|\$)?/;
  if ((hasImage || hasDocument) && paymentKeywords.test(lower)) return true;
  if (amountPattern.test(lower) && paymentKeywords.test(lower)) return true;
  if (/(proof|receipt|screenshot)/.test(lower) && hasImage) return true;
  return false;
};

/**
 * Parse order request from natural language (English + Roman Urdu)
 */
const parseOrderRequest = (text) => {
  const lower = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

  // Eskimo / Account transfer
  if (/(eskimo|eskm|eskmo|eskmoo|eskmu|eskmu|esim transfer|account transfer|topup|top up|esim topup)/.test(lower)) {
    return { productKey: 'ESKIMO', qty: 1 };
  }

  // Courses / PDF
  if (/(course|pdf|digital|1000|learn|bundle|courses)/.test(lower)) {
    return { productKey: 'COURSES', qty: 1 };
  }

  // QR Packages
  if (/(qr|esim|package|pkg)/.test(lower)) {
    if (/(8\s*gb|8gb)/.test(lower)) return { productKey: 'QR_8GB', qty: 1 };
    if (/(4\s*gb|4gb)/.test(lower)) return { productKey: 'QR_4GB', qty: 1 };
    return { productKey: 'QR_4GB', qty: 1 };
  }

  // Internet / Data / GB custom
  const gbMatch = lower.match(/(\d+)\s*gb/);
  if (gbMatch || /(internet|data|mb|gb|net)/.test(lower)) {
    const gb = gbMatch ? parseInt(gbMatch[1]) : 1;
    if (gb >= 1 && gb <= 100) {
      return { productKey: 'INTERNET_1GB', qty: gb };
    }
  }

  // Explicit buy keyword
  if (/^(buy|order|purchase|i want|send me|mujhe chahiye|mujhy chahye|dena|de do|bhejo|bhej do)/.test(lower)) {
    return { productKey: 'QR_4GB', qty: 1 };
  }

  return null;
};

const isEskimoRequest = (text) => {
  const lower = text.toLowerCase();
  return /(eskimo|eskm|eskmo|eskmoo|eskmu|eskmu|esim transfer|account transfer|topup|top up)/.test(lower);
};

const antiSpamCheck = (jid) => {
  const key = `spam_${jid}`;
  const current = spamCache.get(key) || 0;
  if (current >= RATE_LIMIT.maxMessages) {
    return { blocked: true, retryAfter: RATE_LIMIT.blockMinutes * 60 };
  }
  spamCache.set(key, current + 1);
  return { blocked: false, remaining: RATE_LIMIT.maxMessages - current - 1 };
};

const resetSpam = (jid) => {
  spamCache.del(`spam_${jid}`);
};

const formatPKR = (amount) => {
  return '₨' + Number(amount).toLocaleString('en-PK');
};

/**
 * Extract phone number from text (for Eskimo account verification)
 */
const extractPhoneNumber = (text) => {
  // Pakistan format: 03xx-xxxxxxx, +923xx-xxxxxxx, 923xx-xxxxxxx
  const match = text.match(/(?:\+92|92|0)?(3\d{9})/);
  return match ? '92' + match[1] : null;
};

/**
 * Check if text looks like an account name (for Eskimo)
 */
const extractAccountName = (text) => {
  // Simple heuristic: if it contains letters and spaces, could be a name
  const clean = text.trim();
  if (/^[a-zA-Z\s]{3,40}$/.test(clean)) return clean;
  return null;
};

module.exports = {
  extractText, isPaymentProof, parseOrderRequest, isEskimoRequest,
  antiSpamCheck, resetSpam, formatPKR, extractPhoneNumber, extractAccountName
};