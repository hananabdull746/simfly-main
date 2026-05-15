const admin = require('firebase-admin');
const { FIREBASE_PROJECT_ID } = require('./config');

const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id || FIREBASE_PROJECT_ID}.firebaseio.com`
});

const db = admin.firestore();

// ==========================
// Users Collection
// ==========================
const getUser = async (jid) => {
  const doc = await db.collection('users').doc(jid).get();
  return doc.exists ? { jid: doc.id, ...doc.data() } : null;
};

const setUser = async (jid, data) => {
  const ref = db.collection('users').doc(jid);
  const existing = await ref.get();
  const payload = existing.exists
    ? { ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() }
    : { ...data, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  await ref.set(payload, { merge: true });
};

const getRecentUsers = async (limit = 20) => {
  const snap = await db.collection('users').orderBy('lastActive', 'desc').limit(limit).get();
  return snap.docs.map(d => ({ jid: d.id, ...d.data() }));
};

// ==========================
// Orders Collection
// ==========================
const createOrder = async (data) => {
  const ref = db.collection('orders').doc();
  const order = {
    ...data,
    id: ref.id,
    status: data.status || 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await ref.set(order);
  return { id: ref.id, ...order };
};

const getOrder = async (id) => {
  const doc = await db.collection('orders').doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
};

const updateOrder = async (id, data) => {
  await db.collection('orders').doc(id).update({
    ...data,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
};

const getPendingOrders = async () => {
  const snap = await db.collection('orders')
    .where('status', '==', 'pending')
    .orderBy('createdAt', 'desc')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

const getAllOrders = async (limit = 50) => {
  const snap = await db.collection('orders')
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// ==========================
// Payments Collection
// ==========================
const createPayment = async (data) => {
  const ref = db.collection('payments').doc();
  await ref.set({
    ...data,
    id: ref.id,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return ref.id;
};

const getPayment = async (id) => {
  const doc = await db.collection('payments').doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
};

// ==========================
// Eskimo Accounts Collection
// ==========================
const saveEskimoAccount = async (jid, data) => {
  const ref = db.collection('eskimoAccounts').doc(jid);
  await ref.set({
    ...data,
    jid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
};

const getEskimoAccount = async (jid) => {
  const doc = await db.collection('eskimoAccounts').doc(jid).get();
  return doc.exists ? { jid: doc.id, ...doc.data() } : null;
};

// ==========================
// Stats
// ==========================
const getStats = async () => {
  const [usersSnap, ordersSnap, approvedSnap, revenueSnap, eskimoSnap] = await Promise.all([
    db.collection('users').count().get(),
    db.collection('orders').count().get(),
    db.collection('orders').where('status', '==', 'approved').count().get(),
    db.collection('payments').where('status', '==', 'approved').count().get(),
    db.collection('eskimoAccounts').count().get()
  ]);

  return {
    totalUsers: usersSnap.data().count,
    totalOrders: ordersSnap.data().count,
    approvedOrders: approvedSnap.data().count,
    approvedPayments: revenueSnap.data().count,
    eskimoAccounts: eskimoSnap.data().count
  };
};

module.exports = {
  admin,
  db,
  getUser,
  setUser,
  getRecentUsers,
  createOrder,
  getOrder,
  updateOrder,
  getPendingOrders,
  getAllOrders,
  createPayment,
  getPayment,
  saveEskimoAccount,
  getEskimoAccount,
  getStats
};