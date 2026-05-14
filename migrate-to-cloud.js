const initSqlite = require('better-sqlite3');
const mongoose = require('mongoose');
const { Employee, Attendance, Leave, PendingConfirmation } = require('./models');
const dayjs = require('dayjs');

// CONFIG
const SQLITE_DB = 'attendance.db';
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is missing!');
  process.exit(1);
}

async function migrate() {
  console.log('🚀 Starting Migration: SQLite → MongoDB Atlas...');
  
  const sqlite = initSqlite(SQLITE_DB);
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB Atlas');

  // 1. Migrate Employees
  console.log('👥 Migrating Employees...');
  const emps = sqlite.prepare('SELECT * FROM employees').all();
  for (const e of emps) {
    await Employee.findOneAndUpdate(
      { phone: e.phone },
      { name: e.name, whatsapp_id: e.whatsapp_id },
      { upsert: true }
    );
  }
  console.log(`  ✅ Migrated ${emps.length} employees`);

  // 2. Migrate Attendance
  console.log('📅 Migrating Attendance Records...');
  const att = sqlite.prepare('SELECT * FROM attendance').all();
  let attCount = 0;
  for (const a of att) {
    // Need to map SQLite ID to MongoDB ID based on phone/name
    const emp = emps.find(e => e.id === a.employee_id);
    if (!emp) continue;
    const mongoEmp = await Employee.findOne({ name: emp.name });
    if (!mongoEmp) continue;

    await Attendance.findOneAndUpdate(
      { employee_id: mongoEmp._id, date: a.date },
      { 
        check_in: a.check_in, 
        check_out: a.check_out, 
        hours_worked: a.hours_worked, 
        status: a.status 
      },
      { upsert: true }
    );
    attCount++;
  }
  console.log(`  ✅ Migrated ${attCount} attendance records`);

  // 3. Migrate Leaves
  console.log('🗓️ Migrating Leaves...');
  const leaves = sqlite.prepare('SELECT * FROM leaves').all();
  for (const l of leaves) {
    const emp = emps.find(e => e.id === l.employee_id);
    if (!emp) continue;
    const mongoEmp = await Employee.findOne({ name: emp.name });
    if (!mongoEmp) continue;

    await Leave.findOneAndUpdate(
      { msg_id: l.msg_id },
      { 
        employee_id: mongoEmp._id, 
        date: l.date, 
        status: l.status 
      },
      { upsert: true }
    );
  }
  console.log(`  ✅ Migrated ${leaves.length} leave requests`);

  console.log('\n✨ MIGRATION COMPLETE! You can now safely deploy to Render.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
