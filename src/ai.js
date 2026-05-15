const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GROQ_API_KEY, GEMINI_API_KEY, BUSINESS } = require('./config');

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const callGroqAI = async (userMessage, context = '') => {
  try {
    const systemPrompt = 'You are the Official SimFly Pakistan Support Agent.\n\nBRAND IDENTITY:\n- Brand: ' + BUSINESS.brand + '\n- Owner: ' + BUSINESS.owner + '\n- Location: ' + BUSINESS.location + '\n- Founded: ' + BUSINESS.founded + '\n- Business: eSIM + Digital QR Data Reseller (200+ countries)\n- Payments: ' + BUSINESS.payments + '\n- Specialty: ' + BUSINESS.support + '\n- Eskimo App: ' + BUSINESS.eskimoAppStore + '\n- Eskimo Gift Code: ' + BUSINESS.eskimoGiftCode + '\n\nPRODUCTS & PRICING:\n• SimFly Internet: 220 PKR per GB (Formula: GB × 220)\n• 4GB QR Package: 800 PKR\n• 8GB QR Package: 1500 PKR\n• 1000+ Courses PDF: 999 PKR\n• Eskimo Account Transfer / Top-up: Available on request\n\nRULES:\n1. ALWAYS prioritize Pakistan users 🇵🇰\n2. Focus heavily on non-PTA iPhone users and compatibility\n3. Give SHORT, CLEAR answers (max 3-4 sentences)\n4. Always end with a NEXT STEP or call-to-action (conversion focus)\n5. Use simple English. FREQUENTLY use Roman Urdu for local Pakistani connection\n6. Be professional, friendly, and trustworthy\n7. Never mention you are an AI. You are SimFly Pakistan Support.\n8. If user asks about payment, guide them to JazzCash/Easypaisa and ask for screenshot\n9. If user asks about delivery, explain it is instant after payment verification\n10. If user asks about Eskimo, guide them to download app, use gift code FREE500MB, then send account details\n11. If user uses Roman Urdu (like "mujhe", "kya", "kaise", "dena", "bhejo"), reply in Roman Urdu mixed with English\n12. Keep tone warm, helpful, and sales-oriented';

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: context ? '[Context: ' + context + ']\n\nUser: ' + userMessage : userMessage }
    ];

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        messages,
        temperature: 0.7,
        max_tokens: 600,
        stream: false
      },
      {
        headers: {
          'Authorization': 'Bearer ' + GROQ_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    );

    return response.data.choices?.[0]?.message?.content || 'Sorry, I could not process that. Please try again.';
  } catch (err) {
    console.error('[GROQ ERROR]', err.response?.data || err.message);
    return '⚠️ *SimFly Pakistan Support*\n\nI am currently unable to process your request. Please contact ' + BUSINESS.owner + ' directly or try again shortly.';
  }
};

const verifyPaymentGemini = async (imageBuffer, mimeType = 'image/jpeg', caption = '') => {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = 'You are a strict payment verification AI for SimFly Pakistan. \n\nAnalyze this payment screenshot carefully and determine:\n1. Is this a valid JazzCash or Easypaisa receipt/screenshot?\n2. What is the EXACT amount shown?\n3. Does it show SUCCESS/COMPLETED/PAID status?\n4. Is the screenshot clear and authentic?\n\nReturn ONLY a JSON object. No markdown, no explanation. Just raw JSON:\n{\"status\": "approved" or "rejected", "amount": number (0 if unclear), "reason": "brief explanation", "gateway": "JazzCash" or "Easypaisa" or "unknown"}\n\nRejection reasons can be: "invalid_screenshot", "amount_unclear", "incomplete_transaction", "wrong_gateway", "blurry_image", "suspicious_edit".\n\nIf approved, amount MUST be numeric PKR value.';

    const imagePart = {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType
      }
    };

    const result = await model.generateContent([prompt, imagePart]);
    const text = result.response.text();

    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      throw new Error('No JSON block found in Gemini response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      status: parsed.status === 'approved' ? 'approved' : 'rejected',
      amount: Number(parsed.amount) || 0,
      reason: parsed.reason || 'Unable to verify payment details',
      gateway: parsed.gateway || 'unknown'
    };
  } catch (err) {
    console.error('[GEMINI ERROR]', err.message);
    return {
      status: 'rejected',
      amount: 0,
      reason: 'AI verification failed: ' + err.message,
      gateway: 'unknown'
    };
  }
};

module.exports = { callGroqAI, verifyPaymentGemini };