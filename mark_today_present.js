const mongoose = require('mongoose');
const dayjs = require('dayjs');
const { Employee, Attendance } = require('./models');
const config = require('./config');

const MONGODB_URI = "mongodb+srv://sripalsripal2001:Sripal7032@cluster0.p7d5s.mongodb.net/ishaanaa-pos?retryWrites=true&w=majority";

async function run() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const employees = await Employee.find({});
    const today = dayjs().format('YYYY-MM-DD');

    for (const emp of employees) {
      // Check if record exists
      const existing = await Attendance.findOne({ employee_id: emp._id, date: today });
      if (!existing) {
        const record = new Attendance({
          employee_id: emp._id,
          date: today,
          check_in: '10:00 AM',
          status: 'Present'
        });
        await record.save();
        console.log(`✅ Marked ${emp.name} as Present (10:00 AM)`);
      } else {
        console.log(`ℹ️ ${emp.name} already has a record for today.`);
      }
    }

    console.log('Done!');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
