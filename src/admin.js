const { ADMIN_JID, PRODUCTS, BUSINESS } = require('./config');
const { 
  getPendingOrders, getAllOrders, getOrder, updateOrder, 
  getStats, getRecentUsers, db, admin 
} = require('./firebase');
const { deliverProduct } = require('./delivery');

const isAdmin = (jid) => jid === ADMIN_JID;

const forwardToAdmin = async (content, sock, options = {}) => {
  try {
    const { type = 'notification', userJid, mediaBuffer, mimeType, caption } = options;
    const header = '\uD83D\uDCE2 *' + type.toUpperCase() + '*';
    const body = '\n\n👤 User: ' + (userJid || 'Unknown') + '\n📝 ' + content + '\n🕒 Time: ' + new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
    if (mediaBuffer && mimeType?.startsWith('image')) {
      await sock.sendMessage(ADMIN_JID, { image: mediaBuffer, caption: header + body });
    } else {
      await sock.sendMessage(ADMIN_JID, { text: header + body });
    }
  } catch (err) {
    console.error('[FORWARD ERROR]', err.message);
  }
};

const handleAdminCommand = async (text, jid, sock, msg) => {
  if (!isAdmin(jid)) return false;
  const args = text.slice(1).trim().split(/\s+/);
  const cmd = args[0].toLowerCase();
  const argRest = args.slice(1).join(' ');

  switch (cmd) {
    case 'menu':
    case 'start': {
      await sock.sendMessage(jid, {
        text: '🛡️ *SimFly Admin Panel*\n\n📦 */orders* — Pending orders\n📋 */allorders* — Last 50 orders\n✅ */approve [id]* — Approve & deliver\n❌ */reject [id]* — Reject order\n📢 */broadcast [text]* — Message all users\n📊 */stats* — Bot analytics\n👥 */users* — Recent users\n🏷️ */products* — Product catalog\n📱 */eskimo* — Eskimo accounts\n🔍 */order [id]* — View specific order\n\n*' + BUSINESS.brand + '* — Admin Mode'
      });
      return true;
    }

    case 'orders': {
      const orders = await getPendingOrders();
      if (!orders.length) {
        await sock.sendMessage(jid, { text: '✅ No pending orders at the moment.' });
        return true;
      }
      let msgText = '⏳ *Pending Orders (' + orders.length + ')*\n\n';
      orders.forEach((o, i) => {
        const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-PK') : 'Just now';
        msgText += (i+1) + '. *' + o.id + '*\n👤 `' + o.userJid + '`\n📦 ' + o.productName + ' (x' + (o.qty || 1) + ')\n💰 ₨' + o.amount + '\n🕒 ' + date + '\n\n';
      });
      await sock.sendMessage(jid, { text: msgText });
      return true;
    }

    case 'allorders': {
      const all = await getAllOrders(50);
      if (!all.length) {
        await sock.sendMessage(jid, { text: 'No orders found.' });
        return true;
      }
      let msgText = '📋 *Last 50 Orders*\n\n';
      all.slice(0, 20).forEach((o, i) => {
        msgText += (i+1) + '. *' + o.id + '* — ' + (o.status || 'pending').toUpperCase() + '\n👤 `' + o.userJid + '`\n📦 ' + o.productName + '\n💰 ₨' + o.amount + '\n\n';
      });
      if (all.length > 20) msgText += '_...and ' + (all.length - 20) + ' more. Use /order [id] for details._';
      await sock.sendMessage(jid, { text: msgText });
      return true;
    }

    case 'order': {
      const oid = args[1];
      if (!oid) {
        await sock.sendMessage(jid, { text: '❌ Usage: /order [orderId]' });
        return true;
      }
      const o = await getOrder(oid);
      if (!o) {
        await sock.sendMessage(jid, { text: '❌ Order not found.' });
        return true;
      }
      const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-PK') : 'N/A';
      await sock.sendMessage(jid, {
        text: '🔍 *Order Details*\n\n🆔 *' + o.id + '*\n👤 `' + o.userJid + '`\n📦 ' + o.productName + ' (x' + (o.qty || 1) + ')\n💰 ₨' + o.amount + '\n📌 Status: *' + (o.status || 'pending').toUpperCase() + '*\n💳 Payment: ' + (o.paymentStatus || 'unpaid') + '\n🕒 ' + date + '\n\nUse */approve ' + o.id + '* to deliver.'
      });
      return true;
    }

    case 'approve': {
      const orderId = args[1];
      if (!orderId) {
        await sock.sendMessage(jid, { text: '❌ Usage: /approve [orderId]' });
        return true;
      }
      const order = await getOrder(orderId);
      if (!order) {
        await sock.sendMessage(jid, { text: '❌ Order not found in database.' });
        return true;
      }
      if (order.status === 'delivered') {
        await sock.sendMessage(jid, { text: '⚠️ This order was already delivered.' });
        return true;
      }
      await updateOrder(orderId, { 
        status: 'approved', 
        approvedAt: new Date().toISOString(),
        approvedBy: 'admin_manual'
      });
      await sock.sendMessage(jid, { text: '✅ Order *' + orderId + '* approved. Initiating auto-delivery...' });
      await deliverProduct({ ...order, id: orderId }, sock);
      return true;
    }

    case 'reject': {
      const rid = args[1];
      if (!rid) {
        await sock.sendMessage(jid, { text: '❌ Usage: /reject [orderId]' });
        return true;
      }
      const rOrder = await getOrder(rid);
      await updateOrder(rid, { 
        status: 'rejected', 
        rejectedAt: new Date().toISOString(),
        reason: argRest || 'Rejected by admin'
      });
      await sock.sendMessage(jid, { text: '❌ Order *' + rid + '* has been rejected.' });
      if (rOrder) {
        await sock.sendMessage(rOrder.userJid, {
          text: '❌ Your order *' + rid + '* was not approved.\n\nReason: ' + (argRest || 'Payment or verification issue') + '\n\nPlease contact support or resend correct payment proof.\n\n*' + BUSINESS.brand + '*'
        });
      }
      return true;
    }

    case 'broadcast': {
      if (!argRest) {
        await sock.sendMessage(jid, { text: '❌ Usage: /broadcast [your message here]' });
        return true;
      }
      const usersSnap = await db.collection('users').limit(500).get();
      let sent = 0, failed = 0;
      await sock.sendMessage(jid, { text: '📢 Broadcasting to ' + usersSnap.size + ' users...' });
      for (const doc of usersSnap.docs) {
        try {
          await sock.sendMessage(doc.id, {
            text: '📢 *' + BUSINESS.brand + ' Broadcast*\n\n' + argRest + '\n\n_To stop messages, reply STOP_'
          });
          sent++;
          await new Promise(r => setTimeout(r, 800));
        } catch (e) { failed++; }
      }
      await sock.sendMessage(jid, { text: '✅ Broadcast complete!\n📤 Sent: ' + sent + '\n❌ Failed: ' + failed });
      return true;
    }

    case 'stats': {
      const stats = await getStats();
      await sock.sendMessage(jid, {
        text: '📊 *SimFly Bot Analytics*\n\n👥 Total Users: *' + stats.totalUsers + '*\n📦 Total Orders: *' + stats.totalOrders + '*\n✅ Approved Orders: *' + stats.approvedOrders + '*\n💰 Payment Verifications: *' + stats.approvedPayments + '*\n\n🤖 Bot Status: *ONLINE*\n📍 Server: ' + BUSINESS.location + '\n\n*' + BUSINESS.brand + '*'
      });
      return true;
    }

    case 'users': {
      const users = await getRecentUsers(25);
      if (!users.length) {
        await sock.sendMessage(jid, { text: 'No users found.' });
        return true;
      }
      let msgText = '👥 *Recent Users (' + users.length + ')*\n\n';
      users.forEach((u, i) => {
        const date = u.lastActive?.toDate ? u.lastActive.toDate().toLocaleString('en-PK') : 'N/A';
        msgText += (i+1) + '. ' + (u.name || 'Unknown') + '\n   `' + u.jid + '`\n   🕒 ' + date + '\n\n';
      });
      await sock.sendMessage(jid, { text: msgText });
      return true;
    }

    case 'products': {
      let msgText = '🏷️ *Product Catalog*\n\n';
      Object.entries(PRODUCTS).forEach(([key, p]) => {
        msgText += '*' + key + '*\n📦 ' + p.name + '\n💰 ₨' + p.price + '\n📂 ' + p.type.toUpperCase() + '\n\n';
      });
      await sock.sendMessage(jid, { text: msgText });
      return true;
    }

    case 'eskimo': {
      const eskimoSnap = await db.collection('eskimoAccounts').limit(30).get();
      if (!eskimoSnap.size) {
        await sock.sendMessage(jid, { text: 'No Eskimo accounts found.' });
        return true;
      }
      let msgText = '📱 *Eskimo Accounts (' + eskimoSnap.size + ')*\n\n';
      eskimoSnap.docs.forEach((d, i) => {
        const e = d.data();
        msgText += (i+1) + '. ' + (e.accountName || 'Unknown') + '\n   📱 ' + (e.phone || 'N/A') + '\n   👤 ' + (e.jid || d.id) + '\n   📌 ' + (e.status || 'pending') + '\n\n';
      });
      await sock.sendMessage(jid, { text: msgText });
      return true;
    }

    default:
      return false;
  }
};

module.exports = { isAdmin, handleAdminCommand, forwardToAdmin };