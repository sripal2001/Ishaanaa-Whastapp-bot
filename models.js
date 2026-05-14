const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String },
  whatsapp_id: { type: String, unique: true, sparse: true }
});

const attendanceSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  check_in: { type: String },  // HH:mm
  check_out: { type: String }, // HH:mm
  hours_worked: { type: Number, default: 0 },
  status: { type: String, default: 'Present' }, // Present | Late | Short Day | Absent
  notes: { type: String }
});
attendanceSchema.index({ employee_id: 1, date: 1 }, { unique: true });

const leaveSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: String, required: true },
  status: { type: String, default: 'Pending' }, // Pending | Approved | Rejected
  msg_id: { type: String } // WhatsApp message ID
});

const pendingConfirmationSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  data: { type: Object },
  created_at: { type: Date, default: Date.now }
});

const Employee = mongoose.model('Employee', employeeSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);
const Leave = mongoose.model('Leave', leaveSchema);
const PendingConfirmation = mongoose.model('PendingConfirmation', pendingConfirmationSchema);

module.exports = { Employee, Attendance, Leave, PendingConfirmation };
