const { PRODUCTS, BUSINESS } = require('./config');
const { updateOrder } = require('./firebase');

const deliverProduct = async (order, sock) => {
  const { userJid, productKey, id, qty = 1 } = order;
  const product = PRODUCTS[productKey];

  if (!product) {
    await sock.sendMessage(userJid, {
      text: '❌ Product configuration missing. Please contact ' + BUSINESS.owner + ' immediately.'
    });
    return;
  }

  await updateOrder(id, {
    status: 'delivering',
    deliveredAt: new Date().toISOString()
  });

  await sock.sendMessage(userJid, {
    text: '✅ *Payment Verified Successfully*\n\n📦 Preparing your SimFly package...\n📲 Sending now...\n\n_Please wait..._'
  });

  await new Promise(r => setTimeout(r, 2000));

  try {
    if (product.type === 'qr') {
      await sock.sendMessage(userJid, {
        text: '✅ *Order Confirmed: ' + product.name + '*\n\n💰 Paid: ₨' + product.price + '\n📦 Package: ' + product.size + '\n⏳ Validity: ' + product.validity + '\n\n⚠️ *Admin will send your QR code shortly.*\n\n🆔 Order ID: *' + id + '*\n\nPlease save this ID for reference.'
      });
    } else if (product.type === 'digital') {
      if (product.driveUrl) {
        await sock.sendMessage(userJid, {
          document: { url: product.driveUrl },
          mimetype: 'application/pdf',
          fileName: 'SimFly_1000+_Courses_Premium.pdf',
          caption: '🎓 *Your Digital Courses Package*\n\n📚 1000+ Premium Courses Collection\n💾 Tap above to download PDF\n🖥️ Compatible with all devices\n\n⭐ *Thank you for choosing ' + BUSINESS.brand + '!*\n\nFor more products, just send *BUY*.'
        });
      } else {
        await sock.sendMessage(userJid, {
          text: '🎓 *Digital Courses Package*\n\nYour purchase is confirmed!\n\n📥 Download Link: *Coming from admin shortly*\n🆔 Order: *' + id + '*\n\nAdmin has been notified to send your PDF.'
        });
      }
    } else if (product.type === 'internet') {
      const totalPrice = product.price * qty;
      await sock.sendMessage(userJid, {
        text: '🌐 *Internet Package Activated*\n\n📦 ' + product.name + '\n🔢 Quantity: ' + qty + ' GB\n💰 Total Paid: ₨' + totalPrice + '\n⏳ Validity: As per selected plan\n\n📱 *Setup Instructions:*\n1. You will receive eSIM profile via QR shortly\n2. Or use manual activation code sent by admin\n3. Ensure your device supports eSIM\n\n⚡ *Best for Non-PTA iPhones* - Works instantly!\n\n*' + BUSINESS.brand + '* 🇵🇰'
      });
    } else if (product.type === 'eskimo') {
      await sock.sendMessage(userJid, {
        text: '✅ *Eskimo Account Transfer Confirmed*\n\n📱 Admin will process your Eskimo top-up/transfer shortly.\n\n🆔 Order ID: *' + id + '*\n\n⏳ Expected time: 10-30 minutes\n\nPlease keep your Eskimo app ready.'
      });
    }

    await new Promise(r => setTimeout(r, 1500));
    await sock.sendMessage(userJid, {
      text: '⭐ *Delivery Status Updated!*\n\n🆔 Order ID: *' + id + '*\n📦 Product: ' + product.name + '\n\n📌 *Save this message for your records.*\n\nFor renewals: Send *RENEW*\nNew order: Send *BUY*\nSupport: Reply here anytime\n\n👨‍💼 ' + BUSINESS.owner + '\n*' + BUSINESS.brand + '* 🇵🇰'
    });

    await updateOrder(id, { status: 'delivered' });

  } catch (deliveryErr) {
    console.error('[DELIVERY ERROR]', deliveryErr);
    await sock.sendMessage(userJid, {
      text: '⚠️ There was an issue delivering your product. Admin has been notified and will send it manually.\n\n🆔 Order: *' + id + '*'
    });
    await updateOrder(id, { status: 'delivery_failed', error: deliveryErr.message });
  }
};

module.exports = { deliverProduct };