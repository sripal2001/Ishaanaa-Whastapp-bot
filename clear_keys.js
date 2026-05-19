require('dns').setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://sripalsripal2001:Sripal7032@cluster0.p7d5s.mongodb.net/ishaanaa-pos?retryWrites=true&w=majority";

async function run() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const result = await mongoose.connection.collection('baileys_auth_keys').deleteMany({});
    console.log(`🧹 Deleted ${result.deletedCount} documents from baileys_auth_keys.`);

    process.exit(0);
  } catch (err) {
    console.error('❌ Error clearing collection:', err);
    process.exit(1);
  }
}

run();
