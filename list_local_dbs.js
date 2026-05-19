const mongoose = require('mongoose');

async function run() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/admin');
    console.log('✅ Connected to local MongoDB!');
    
    const db = mongoose.connection.db;
    const adminDb = db.admin();
    const dbs = await adminDb.listDatabases();
    console.log('Databases:', dbs.databases);

    for (const dbInfo of dbs.databases) {
      const dbInstance = mongoose.connection.useDb(dbInfo.name);
      const collections = await dbInstance.db.listCollections().toArray();
      console.log(`Collections in ${dbInfo.name}:`, collections.map(c => c.name));
    }
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error listing databases:', err);
    process.exit(1);
  }
}

run();
