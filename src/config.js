require('dotenv').config();

module.exports = {
  ADMIN_JID: process.env.ADMIN_JID || '923001234567@s.whatsapp.net',
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || '',

  BUSINESS: {
    brand: 'SimFly Pakistan',
    owner: 'Abdull Hanan',
    location: 'Gujranwala, Punjab, Pakistan',
    founded: 2024,
    payments: 'JazzCash & Easypaisa',
    support: 'Non-PTA iPhone Specialists 🇵🇰',
    eskimoAppStore: 'https://apps.apple.com/cy/app/eskimo-esim-travel-internet/id1590276868',
    eskimoGiftCode: 'FREE500MB'
  },

  PRODUCTS: {
    INTERNET_1GB: {
      key: 'INTERNET_1GB',
      name: 'SimFly Internet',
      price: 220,
      type: 'internet',
      unit: 'GB',
      rate: 220,
      description: 'International eSIM Data'
    },
    QR_4GB: {
      key: 'QR_4GB',
      name: '4GB QR Package',
      price: 800,
      type: 'qr',
      size: '4GB',
      validity: '30 Days',
      manualDelivery: true
    },
    QR_8GB: {
      key: 'QR_8GB',
      name: '8GB QR Package',
      price: 1500,
      type: 'qr',
      size: '8GB',
      validity: '30 Days',
      manualDelivery: true
    },
    COURSES: {
      key: 'COURSES',
      name: '1000+ Courses PDF',
      price: 999,
      type: 'digital',
      driveUrl: process.env.COURSES_DRIVE_URL || ''
    },
    ESKIMO: {
      key: 'ESKIMO',
      name: 'Eskimo Account Transfer',
      price: 0,
      type: 'eskimo',
      description: 'Eskimo eSIM account top-up / transfer service',
      manualDelivery: true,
      requiresAccount: true
    }
  },

  RATE_LIMIT: {
    maxMessages: 12,
    windowSeconds: 60,
    blockMinutes: 3
  },

  AUTO_REPLY: true,
  FORWARD_TO_ADMIN: true
};