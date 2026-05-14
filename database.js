// ============================================================
//  DATABASE SETUP — MongoDB (Cloud Persistent)
// ============================================================

const mongoose = require('mongoose');
const dayjs = require('dayjs');
const { Employee, Attendance, Leave, PendingConfirmation } = require('./models');

// Connect function to be called from index.js
async function connect(uri) {
  if (mongoose.connection.readyState >= 1) return;
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB Atlas');
}

// ─── Employee Queries ──────────────────────────────────────────
async function upsertEmployees(employees) {
  for (const emp of employees) {
    await Employee.findOneAndUpdate(
      { phone: emp.phone },
      { name: emp.name },
      { upsert: true, new: true }
    );
  }
}

async function getEmployeeByWAId(waId) {
  return await Employee.findOne({ whatsapp_id: waId });
}

async function getEmployeeByPhone(phone) {
  const clean = phone.replace('@c.us', '').replace(/\D/g, '');
  const last10 = clean.slice(-10);
  const all = await Employee.find({});
  return all.find(e => e.phone && e.phone.replace(/\D/g, '').slice(-10) === last10) || null;
}

async function linkWhatsappId(employeeId, waId) {
  return await Employee.findByIdAndUpdate(employeeId, { whatsapp_id: waId });
}

async function getEmployeeByName(name) {
  const all = await Employee.find({});
  return all.find(e => e.name.toLowerCase() === name.toLowerCase().trim()) || null;
}

async function getAllEmployees() {
  return await Employee.find({});
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
  const results = [];
  for (const emp of allEmps) {
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
  return records.map(r => ({
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
    name: leave.employee_id.name
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
  connect,
  upsertEmployees, getEmployeeByWAId, getEmployeeByPhone, getEmployeeByName,
  linkWhatsappId, getAllEmployees,
  getTodayRecord, checkIn, checkOut, markAbsent,
  getTodayAttendance, getMonthAttendance, getEmployeeAttendance,
  requestLeave, updateLeaveStatus, getLeaveByMsgId,
  setPending, getPending, clearPending,
};
