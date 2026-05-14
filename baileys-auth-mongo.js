// ============================================================
//  BAILEYS MONGODB AUTH ADAPTER
//  Saves WhatsApp session keys to MongoDB so the bot stays
//  logged in across Render restarts — no re-scanning needed.
// ============================================================

const mongoose = require('mongoose');

// ─── Schema ──────────────────────────────────────────────────
const AuthKeySchema = new mongoose.Schema({
  _id: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
}, { collection: 'baileys_auth_keys', versionKey: false });

const AuthKey = mongoose.models.AuthKey || mongoose.model('AuthKey', AuthKeySchema);

// ─── Core helpers ────────────────────────────────────────────
const toJSON = (data) => JSON.parse(JSON.stringify(data, (_, v) =>
  v?.type === 'Buffer' ? { type: 'Buffer', data: Array.from(v.data ?? []) } : v
));

const fromJSON = (data) => JSON.parse(JSON.stringify(data), (_, v) =>
  v && typeof v === 'object' && v.type === 'Buffer' ? Buffer.from(v.data) : v
);

// ─── Main factory ────────────────────────────────────────────
async function useMongoDBAuthState() {
  const writeData = async (key, data) => {
    await AuthKey.findOneAndUpdate(
      { _id: key },
      { data: toJSON(data) },
      { upsert: true, new: true }
    );
  };

  const readData = async (key) => {
    const doc = await AuthKey.findById(key).lean();
    return doc ? fromJSON(doc.data) : null;
  };

  const removeData = async (key) => {
    await AuthKey.deleteOne({ _id: key });
  };

  // Load or create creds
  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              const value = await readData(`${type}-${id}`);
              if (value) data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const [type, ids] of Object.entries(data)) {
            for (const [id, value] of Object.entries(ids)) {
              if (value) {
                tasks.push(writeData(`${type}-${id}`, value));
              } else {
                tasks.push(removeData(`${type}-${id}`));
              }
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await writeData('creds', creds);
    },
  };
}

// ─── Baileys initAuthCreds (inline to avoid deep import issues)
function initAuthCreds() {
  // Baileys will populate this on first connection
  return {
    noiseKey: generateKeyPair(),
    signedIdentityKey: generateKeyPair(),
    signedPreKey: { keyPair: generateKeyPair(), signature: Buffer.alloc(64), keyId: 1 },
    registrationId: Math.floor(Math.random() * 16383) + 1,
    advSecretKey: randomBytes(32).toString('base64'),
    nextPreKeyId: 1,
    firstUnuploadedPreKeyId: 1,
    accountSyncCounter: 0,
    accountSettings: { unarchiveChats: false },
  };
}

// Simple crypto helpers (fallback if Baileys helpers not importable)
const crypto = require('crypto');
const { Curve } = require('@whiskeysockets/baileys');

function generateKeyPair() {
  return Curve.generateKeyPair();
}

function randomBytes(n) {
  return crypto.randomBytes(n);
}

module.exports = { useMongoDBAuthState };
