const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GROQ_API_KEY, GEMINI_API_KEY, BUSINESS } = require('./config');

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const callGroqAI = async (userMessage, context = '') => {
  try {
    const systemPrompt = `You are the Official SimFly Pakistan Support Agent.

BRAND IDENTITY:
- Brand: ${BUSINESS.brand}
- Owner: ${BUSINESS.owner}
- Location: ${BUSINESS.location}
- Founded: ${BUSINESS.founded}
- Business: eSIM + Digital QR Data Reseller (200+ countries)
- Payments: ${BUSINESS.payments}
- Specialty: ${BUSINESS.support}
- Eskimo App: ${BUSINESS.eskimoAppStore}
- Eskimo Gift Code: ${BUSINESS.eskimoGiftCode}

PRODUCTS & PRICING:
• SimFly Internet: 220 PKR per GB (Formula: GB × 220)
• 4GB QR Package: 800 PKR
• 8GB QR Package: 1500 PKR
• 1000+ Courses PDF: 999 PKR
• Eskimo Account Transfer / Top-up: Available on request

RULES:
1. ALWAYS prioritize Pakistan users 🇵🇰
2. Focus heavily on non-PTA iPhone users and compatibility
3. Give SHORT, CLEAR answers (max 3-4 sentences)
4. Always end with a NEXT STEP or call-to-action (conversion focus)
5. Use simple English. FREQUENTLY use Roman Urdu for local Pakistani connection
6. Be professional, friendly, and trustworthy
7. Never mention you are an AI. You are SimFly Pakistan Support.
8. If user asks about payment, guide them to JazzCash/Easypaisa and ask for screenshot
9. If user asks about delivery, explain it's instant after payment verification
10. If user asks about Eskimo, guide them to download app, use gift code FREE500MB, then send account details
11. If user uses Roman Urdu (like "mujhe", "kya", "kaise", "dena", "bhejo"), reply in Roman Urdu mixed with English
12. Keep tone warm, helpful, and sales-oriented`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: context ? `[Context: ${context}]

User: ${userMessage}` : userMessage }
    ];

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',  // Free tier: 30 RPM, 14,400 RPD, 6,000 TPM — highest daily limit
        messages,
        temperature: 0.7,
        max_tokens: 600,
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    );

    return response.data.choices?.[0]?.message?.content || 'Sorry, I could not process that. Please try again.';
  } catch (err) {
    console.error('[GROQ ERROR]', err.response?.data || err.message);
    return `⚠️ *SimFly Pakistan Support*

I am currently unable to process your request. Please contact ${BUSINESS.owner} directly or try again shortly.`;
  }
};

const verifyPaymentGemini = async (imageBuffer, mimeType = 'image/jpeg', caption = '') => {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `You are a strict payment verification AI for SimFly Pakistan. 

Analyze this payment screenshot carefully and determine:
1. Is this a valid JazzCash or Easypaisa receipt/screenshot?
2. What is the EXACT amount shown?
3. Does it show SUCCESS/COMPLETED/PAID status?
4. Is the screenshot clear and authentic?

Return ONLY a JSON object. No markdown, no explanation. Just raw JSON:
{"status": "approved" or "rejected", "amount": number (0 if unclear), "reason": "brief explanation", "gateway": "JazzCash" or "Easypaisa" or "unknown"}

Rejection reasons can be: "invalid_screenshot", "amount_unclear", "incomplete_transaction", "wrong_gateway", "blurry_image", "suspicious_edit".

If approved, amount MUST be numeric PKR value.`;

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
      reason: `AI verification failed: ${err.message}`,
      gateway: 'unknown'
    };
  }
};

module.exports = { callGroqAI, verifyPaymentGemini };