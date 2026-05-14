// ============================================================
//  BAILEYS MONGODB AUTH ADAPTER
//  Saves WhatsApp session keys to MongoDB so the bot stays
//  logged in across Render restarts — no re-scanning needed.
// ============================================================

const mongoose = require('mongoose');
const { BufferJSON, initAuthCreds } = require('@whiskeysockets/baileys');

// ─── Schema ──────────────────────────────────────────────────
const AuthKeySchema = new mongoose.Schema({
  _id: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
}, { collection: 'baileys_auth_keys', versionKey: false });

const AuthKey = mongoose.models.AuthKey || mongoose.model('AuthKey', AuthKeySchema);

// ─── Core helpers ────────────────────────────────────────────
// Use Baileys native replacer and reviver to correctly handle Uint8Array
const toJSON = (data) => JSON.parse(JSON.stringify(data, BufferJSON.replacer));
const fromJSON = (data) => JSON.parse(JSON.stringify(data), BufferJSON.reviver);

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
  let creds = await readData('creds');
  
  // Auto-recovery: If creds exist but are corrupted (e.g. from previous bad JSON serialization),
  // clear the database to force a fresh start.
  if (creds && creds.noiseKey && !(creds.noiseKey.private instanceof Uint8Array)) {
    console.log('🧹 Corrupted auth credentials detected. Clearing old session data...');
    await AuthKey.deleteMany({});
    creds = initAuthCreds();
  } else if (!creds) {
    creds = initAuthCreds();
  }

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

module.exports = { useMongoDBAuthState };
