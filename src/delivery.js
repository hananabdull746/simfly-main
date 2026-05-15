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
    text: '✅ *Payment Verified Successfully*

📦 Preparing your SimFly package...
📲 Sending now...

_Please wait..._'
  });

  await new Promise(r => setTimeout(r, 2000));

  try {
    // ================= QR PACKAGES (MANUAL) =================
    if (product.type === 'qr') {
      await sock.sendMessage(userJid, {
        text: '✅ *Order Confirmed: ' + product.name + '*

💰 Paid: ₨' + product.price + '
📦 Package: ' + product.size + '
⏳ Validity: ' + product.validity + '

⚠️ *Admin will send your QR code shortly.*

🆔 Order ID: *' + id + '*

Please save this ID for reference.'
      });
    }

    // ================= DIGITAL COURSES =================
    else if (product.type === 'digital') {
      if (product.driveUrl) {
        await sock.sendMessage(userJid, {
          document: { url: product.driveUrl },
          mimetype: 'application/pdf',
          fileName: 'SimFly_1000+_Courses_Premium.pdf',
          caption: '🎓 *Your Digital Courses Package*

📚 1000+ Premium Courses Collection
💾 Tap above to download PDF
🖥️ Compatible with all devices

⭐ *Thank you for choosing ' + BUSINESS.brand + '!*

For more products, just send *BUY*.'
        });
      } else {
        await sock.sendMessage(userJid, {
          text: '🎓 *Digital Courses Package*

Your purchase is confirmed!

📥 Download Link: *Coming from admin shortly*
🆔 Order: *' + id + '*

Admin has been notified to send your PDF.'
        });
      }
    }

    // ================= INTERNET DATA =================
    else if (product.type === 'internet') {
      const totalPrice = product.price * qty;
      await sock.sendMessage(userJid, {
        text: '🌐 *Internet Package Activated*

📦 ' + product.name + '
🔢 Quantity: ' + qty + ' GB
💰 Total Paid: ₨' + totalPrice + '
⏳ Validity: As per selected plan

📱 *Setup Instructions:*
1. You will receive eSIM profile via QR shortly
2. Or use manual activation code sent by admin
3. Ensure your device supports eSIM

⚡ *Best for Non-PTA iPhones* - Works instantly!

*' + BUSINESS.brand + '* 🇵🇰'
      });
    }

    // ================= ESKIMO ACCOUNT TRANSFER =================
    else if (product.type === 'eskimo') {
      await sock.sendMessage(userJid, {
        text: '✅ *Eskimo Account Transfer Confirmed*

📱 Admin will process your Eskimo top-up/transfer shortly.

🆔 Order ID: *' + id + '*

⏳ Expected time: 10-30 minutes

Please keep your Eskimo app ready.'
      });
    }

    // Final confirmation
    await new Promise(r => setTimeout(r, 1500));
    await sock.sendMessage(userJid, {
      text: '⭐ *Delivery Status Updated!*

🆔 Order ID: *' + id + '*
📦 Product: ' + product.name + '

📌 *Save this message for your records.*

For renewals: Send *RENEW*
New order: Send *BUY*
Support: Reply here anytime

👨‍💼 ' + BUSINESS.owner + '
*' + BUSINESS.brand + '* 🇵🇰'
    });

    await updateOrder(id, { status: 'delivered' });

  } catch (deliveryErr) {
    console.error('[DELIVERY ERROR]', deliveryErr);
    await sock.sendMessage(userJid, {
      text: '⚠️ There was an issue delivering your product. Admin has been notified and will send it manually.

🆔 Order: *' + id + '*'
    });
    await updateOrder(id, { status: 'delivery_failed', error: deliveryErr.message });
  }
};

module.exports = { deliverProduct };