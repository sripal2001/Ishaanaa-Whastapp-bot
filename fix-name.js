const db = require('better-sqlite3')('attendance.db');
const r = db.prepare("UPDATE employees SET name = 'Tanusree' WHERE name = 'ThanuShree'").run();
console.log('Updated rows:', r.changes);
const all = db.prepare('SELECT * FROM employees').all();
console.log('Current employees:', all.map(e => e.name).join(', '));
db.close();
