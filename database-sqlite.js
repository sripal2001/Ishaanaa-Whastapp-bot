// ============================================================
//  DATABASE SETUP — SQLite (local, free, no server needed)
// ============================================================

const Database = require('better-sqlite3');
const path = require('path');
const dayjs = require('dayjs');

const DB_PATH = path.join(__dirname, 'attendance.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// ─── Create Tables ────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    phone       TEXT,
    whatsapp_id TEXT UNIQUE
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id   INTEGER NOT NULL,
    date          TEXT    NOT NULL,   -- YYYY-MM-DD
    check_in      TEXT,               -- HH:mm
    check_out     TEXT,               -- HH:mm
    hours_worked  REAL    DEFAULT 0,
    status        TEXT    DEFAULT 'Present', -- Present | Late | Short Day | Absent
    notes         TEXT,
    FOREIGN KEY (employee_id) REFERENCES employees(id),
    UNIQUE(employee_id, date)
  );

  CREATE TABLE IF NOT EXISTS leaves (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    date        TEXT    NOT NULL,
    status      TEXT    DEFAULT 'Pending', -- Pending | Approved | Rejected
    msg_id      TEXT,   -- WhatsApp message ID for reaction tracking
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );

  CREATE TABLE IF NOT EXISTS pending_confirmations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT NOT NULL,
    type        TEXT NOT NULL,  -- 'early_checkout'
    data        TEXT,           -- JSON string
    created_at  TEXT DEFAULT (datetime('now'))
  );
`);

// Add whatsapp_id column to existing DBs that don't have it yet
try { db.exec('ALTER TABLE employees ADD COLUMN whatsapp_id TEXT'); } catch(_) {}
try { db.exec('ALTER TABLE employees ADD COLUMN phone TEXT'); } catch(_) {}
function upsertEmployees(employees) {
  const stmt = db.prepare(`
    INSERT INTO employees (name, phone)
    VALUES (@name, @phone)
    ON CONFLICT(phone) DO UPDATE SET name = @name
  `);
  for (const emp of employees) {
    stmt.run(emp);
  }
}

function getEmployeeByWAId(waId) {
  // waId is the raw WhatsApp author ID (could be a number or internal ID)
  return db.prepare('SELECT * FROM employees WHERE whatsapp_id = ?').get(waId) || null;
}

function getEmployeeByPhone(phone) {
  // Kept for backward compat — matches last 10 digits
  const clean  = phone.replace('@c.us', '').replace(/\D/g, '');
  const last10 = clean.slice(-10);
  const all    = db.prepare('SELECT * FROM employees').all();
  return all.find(e => e.phone && e.phone.replace(/\D/g, '').slice(-10) === last10) || null;
}

function linkWhatsappId(employeeId, waId) {
  return db.prepare('UPDATE employees SET whatsapp_id = ? WHERE id = ?').run(waId, employeeId);
}

// Find employee by name (for self-registration matching)
function getEmployeeByName(name) {
  const all = db.prepare('SELECT * FROM employees').all();
  return all.find(e =>
    e.name.toLowerCase() === name.toLowerCase().trim()
  ) || null;
}

function getAllEmployees() {
  return db.prepare('SELECT * FROM employees').all();
}

// ─── Attendance Queries ───────────────────────────────────────
function getTodayRecord(employeeId) {
  const today = dayjs().format('YYYY-MM-DD');
  return db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?')
    .get(employeeId, today);
}

function checkIn(employeeId, time, status = 'Present') {
  const today = dayjs().format('YYYY-MM-DD');
  return db.prepare(`
    INSERT INTO attendance (employee_id, date, check_in, status)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(employee_id, date) DO NOTHING
  `).run(employeeId, today, time, status);
}

function checkOut(employeeId, time, hoursWorked, status) {
  const today = dayjs().format('YYYY-MM-DD');
  return db.prepare(`
    UPDATE attendance
    SET check_out = ?, hours_worked = ?, status = ?
    WHERE employee_id = ? AND date = ?
  `).run(time, hoursWorked, status, employeeId, today);
}

function markAbsent(employeeId) {
  const today = dayjs().format('YYYY-MM-DD');
  return db.prepare(`
    INSERT INTO attendance (employee_id, date, status)
    VALUES (?, ?, 'Absent')
    ON CONFLICT(employee_id, date) DO NOTHING
  `).run(employeeId, today);
}

function getTodayAttendance() {
  const today = dayjs().format('YYYY-MM-DD');
  return db.prepare(`
    SELECT e.name, a.check_in, a.check_out, a.hours_worked, a.status
    FROM employees e
    LEFT JOIN attendance a ON e.id = a.employee_id AND a.date = ?
    ORDER BY e.name
  `).all(today);
}

function getMonthAttendance(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to   = `${year}-${String(month).padStart(2, '0')}-31`;
  return db.prepare(`
    SELECT e.name, a.date, a.check_in, a.check_out, a.hours_worked, a.status
    FROM employees e
    LEFT JOIN attendance a ON e.id = a.employee_id
    WHERE a.date BETWEEN ? AND ?
    ORDER BY e.name, a.date
  `).all(from, to);
}

function getEmployeeAttendance(employeeId, days = 30) {
  return db.prepare(`
    SELECT date, check_in, check_out, hours_worked, status
    FROM attendance
    WHERE employee_id = ?
    ORDER BY date DESC
    LIMIT ?
  `).all(employeeId, days);
}

// ─── Leave Queries ────────────────────────────────────────────
function requestLeave(employeeId, date, msgId) {
  return db.prepare(`
    INSERT INTO leaves (employee_id, date, msg_id)
    VALUES (?, ?, ?)
  `).run(employeeId, date, msgId);
}

function updateLeaveStatus(msgId, status) {
  return db.prepare(`
    UPDATE leaves SET status = ? WHERE msg_id = ?
  `).run(status, msgId);
}

function getLeaveByMsgId(msgId) {
  return db.prepare(`
    SELECT l.*, e.name FROM leaves l
    JOIN employees e ON l.employee_id = e.id
    WHERE l.msg_id = ?
  `).get(msgId);
}

// ─── Pending Confirmations ────────────────────────────────────
function setPending(phone, type, data) {
  db.prepare('DELETE FROM pending_confirmations WHERE phone = ?').run(phone);
  db.prepare(`
    INSERT INTO pending_confirmations (phone, type, data)
    VALUES (?, ?, ?)
  `).run(phone, type, JSON.stringify(data));
}

function getPending(phone) {
  return db.prepare('SELECT * FROM pending_confirmations WHERE phone = ?').get(phone);
}

function clearPending(phone) {
  db.prepare('DELETE FROM pending_confirmations WHERE phone = ?').run(phone);
}

module.exports = {
  upsertEmployees, getEmployeeByWAId, getEmployeeByPhone, getEmployeeByName,
  linkWhatsappId, getAllEmployees,
  getTodayRecord, checkIn, checkOut, markAbsent,
  getTodayAttendance, getMonthAttendance, getEmployeeAttendance,
  requestLeave, updateLeaveStatus, getLeaveByMsgId,
  setPending, getPending, clearPending,
};
