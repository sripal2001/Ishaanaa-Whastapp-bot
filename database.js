// ============================================================
//  DATABASE SETUP — MongoDB (Cloud Persistent)
// ============================================================

const mongoose = require('mongoose');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Asia/Kolkata');

const { Employee, Attendance, Leave, PendingConfirmation } = require('./models');

// Connect function to be called from index.js
async function connect(uri) {
  if (mongoose.connection.readyState >= 1) return;
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB Atlas');
}

// ─── Employee Queries ──────────────────────────────────────────
async function upsertEmployees(employees) {
  const currentNames = employees.map(e => e.name.trim().toLowerCase());
  
  // ── STEP 1: Raw MongoDB cleanup (bypass Mongoose to avoid index conflicts) ──
  try {
    const collection = mongoose.connection.db.collection('employees');
    
    // Drop the old (non-unique) name index if it exists, so we can create the unique one
    try { await collection.dropIndex('name_1'); } catch (_) {}
    
    // Get ALL raw documents
    const rawDocs = await collection.find({}).toArray();
    const nameGroups = {};
    
    for (const doc of rawDocs) {
      const norm = (doc.name || '').trim().toLowerCase();
      
      // Delete employees not in config.js
      if (!currentNames.includes(norm)) {
        await collection.deleteOne({ _id: doc._id });
        console.log(`🗑️ Deleted unknown employee: ${doc.name}`);
        continue;
      }
      
      if (!nameGroups[norm]) nameGroups[norm] = [];
      nameGroups[norm].push(doc);
    }
    
    // For each name group, keep only the best one (prefer one with whatsapp_id)
    for (const norm in nameGroups) {
      const group = nameGroups[norm];
      if (group.length > 1) {
        const toKeep = group.find(d => d.whatsapp_id) || group[0];
        for (const doc of group) {
          if (doc._id.toString() !== toKeep._id.toString()) {
            await collection.deleteOne({ _id: doc._id });
            console.log(`🗑️ Deleted duplicate: ${doc.name} (kept ID ${toKeep._id})`);
          }
        }
      }
    }
  } catch (err) {
    console.error('⚠️ Raw cleanup error (non-fatal):', err.message);
  }
  
  // ── STEP 2: Ensure exactly the config.js employees exist ──
  for (const emp of employees) {
    const norm = emp.name.trim().toLowerCase();
    const allCurrent = await Employee.find({});
    const existing = allCurrent.find(e => e.name.trim().toLowerCase() === norm);

    if (existing) {
      if (existing.name !== emp.name) {
        existing.name = emp.name;
        await existing.save();
      }
    } else {
      await Employee.create({ name: emp.name, phone: emp.phone });
      console.log(`✅ Created employee: ${emp.name}`);
    }
  }
  
  // ── STEP 3: Rebuild unique index ──
  try {
    await Employee.syncIndexes();
    console.log(`✅ Employee count: ${await Employee.countDocuments()} (expected: ${employees.length})`);
  } catch (err) {
    console.error('⚠️ Index sync error:', err.message);
  }
}

async function getEmployeeByWAId(waId) {
  return await Employee.findOne({ whatsapp_id: waId });
}

async function getEmployeeByPhone(phone) {
  // If phone is an @lid or exactly matches the string, search exactly
  if (phone.includes('@lid')) {
    return await Employee.findOne({ phone: phone });
  }
  const clean = phone.replace('@c.us', '').replace(/\D/g, '');
  const last10 = clean.slice(-10);
  // Match either exact string, or ending with last 10 digits
  return await Employee.findOne({ 
    $or: [
      { phone: phone },
      { phone: { $regex: last10 + '$' } }
    ]
  });
}

async function linkWhatsappId(employeeId, waId) {
  return await Employee.findByIdAndUpdate(employeeId, { whatsapp_id: waId });
}

async function getEmployeeByName(name) {
  const all = await Employee.find({});
  return all.find(e => e.name.toLowerCase() === name.toLowerCase().trim()) || null;
}

async function getAllEmployees() {
  const all = await Employee.find({});
  // Deduplicate by normalized name as safety net
  const seen = new Set();
  return all.filter(e => {
    const norm = e.name.trim().toLowerCase();
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
}

// ─── Attendance Queries ───────────────────────────────────────
async function getTodayRecord(employeeId) {
  const today = dayjs().format('YYYY-MM-DD');
  return await Attendance.findOne({ employee_id: employeeId, date: today });
}

async function checkIn(employeeId, time, status = 'Present') {
  const today = dayjs().format('YYYY-MM-DD');
  try {
    const doc = new Attendance({ employee_id: employeeId, date: today, check_in: time, status: status });
    await doc.save();
    return doc;
  } catch (err) {
    // If unique constraint fails, do nothing
    return null;
  }
}

async function checkOut(employeeId, time, hoursWorked, status) {
  const today = dayjs().format('YYYY-MM-DD');
  return await Attendance.findOneAndUpdate(
    { employee_id: employeeId, date: today },
    { check_out: time, hours_worked: hoursWorked, status: status },
    { new: true }
  );
}

async function markAbsent(employeeId) {
  const today = dayjs().format('YYYY-MM-DD');
  try {
    const doc = new Attendance({ employee_id: employeeId, date: today, status: 'Absent' });
    await doc.save();
    return doc;
  } catch (err) {
    return null;
  }
}

async function getTodayAttendance() {
  const today = dayjs().format('YYYY-MM-DD');
  const allEmps = await Employee.find({}).sort('name');
  
  // Deduplicate by normalized name — safety net against ghost duplicates
  const seen = new Set();
  const uniqueEmps = allEmps.filter(e => {
    const norm = e.name.trim().toLowerCase();
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
  
  const results = [];
  for (const emp of uniqueEmps) {
    const att = await Attendance.findOne({ employee_id: emp._id, date: today });
    results.push({
      name: emp.name,
      check_in: att ? att.check_in : null,
      check_out: att ? att.check_out : null,
      hours_worked: att ? att.hours_worked : 0,
      status: att ? att.status : null
    });
  }
  return results;
}

async function getMonthAttendance(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = `${year}-${String(month).padStart(2, '0')}-31`;
  const records = await Attendance.find({ date: { $gte: from, $lte: to } }).populate('employee_id');
  return records
    .filter(r => r.employee_id) // Filter out orphaned records
    .map(r => ({
      name: r.employee_id.name,
      date: r.date,
      check_in: r.check_in,
    check_out: r.check_out,
    hours_worked: r.hours_worked,
    status: r.status
  })).sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date));
}

async function getEmployeeAttendance(employeeId, days = 30) {
  return await Attendance.find({ employee_id: employeeId })
    .sort({ date: -1 })
    .limit(days);
}

// ─── Leave Queries ────────────────────────────────────────────
async function requestLeave(employeeId, date, msgId) {
  const doc = new Leave({ employee_id: employeeId, date: date, msg_id: msgId });
  return await doc.save();
}

async function updateLeaveStatus(msgId, status) {
  return await Leave.findOneAndUpdate({ msg_id: msgId }, { status: status });
}

async function getLeaveByMsgId(msgId) {
  const leave = await Leave.findOne({ msg_id: msgId }).populate('employee_id');
  if (!leave) return null;
  return {
    ...leave._doc,
    name: leave.employee_id ? leave.employee_id.name : 'Unknown (Deleted Employee)'
  };
}

// ─── Pending Confirmations ────────────────────────────────────
async function setPending(phone, type, data) {
  await PendingConfirmation.findOneAndDelete({ phone: phone });
  const doc = new PendingConfirmation({ phone, type, data });
  return await doc.save();
}

async function getPending(phone) {
  return await PendingConfirmation.findOne({ phone: phone });
}

async function clearPending(phone) {
  return await PendingConfirmation.findOneAndDelete({ phone: phone });
}

module.exports = {
  Employee, Attendance,
  connect,
  upsertEmployees, getEmployeeByWAId, getEmployeeByPhone, getEmployeeByName,
  linkWhatsappId, getAllEmployees,
  getTodayRecord, checkIn, checkOut, markAbsent,
  getTodayAttendance, getMonthAttendance, getEmployeeAttendance,
  requestLeave, updateLeaveStatus, getLeaveByMsgId,
  setPending, getPending, clearPending,
};
