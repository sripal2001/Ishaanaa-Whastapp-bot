// ============================================================
//  ISHAANAA DESIGNER STUDIO — Attendance Bot Configuration
// ============================================================

module.exports = {
  STUDIO: {
    name: 'Ishaanaa Designer Studio',
    address: 'Opp Income Tax Colony, Road No.10, Noor Nagar, Banjara Hills, Hyderabad',
    lat: 17.4165144,
    lng: 78.4333278,
    radius: 150, // meters — how close they must be to mark attendance
  },

  SHIFT: {
    windowStart: 10,      // Studio opens at 10 AM
    windowEnd: 22,        // Studio closes at 10 PM
    minHours: 8,          // Minimum hours required per day
    lateAfterHour: 12,    // After 12 PM = late
    lateAfterMin: 0,      // After 12:00 PM = late
    absentAfterHour: 13,  // After 1 PM with no check-in = absent alert
    absentAfterMin: 0,
  },

  // Employee WhatsApp numbers (include country code, no + or spaces)
  EMPLOYEES: [
    { name: 'Neha',       phone: '919121306498' },
    { name: 'Sharma',     phone: '919866986319' },
    { name: 'Tanusree',   phone: '919059915549' },
  ],

  // Manager (you) — receives alerts and can run admin commands
  MANAGER_PHONE: '919398285972',

  // WhatsApp Group name — set this EXACTLY as it appears in WhatsApp
  GROUP_NAME: 'Ishaanaa Designer Studio✨',

  // Daily summary time (24h format)
  DAILY_SUMMARY_HOUR: 21,   // 9 PM
  DAILY_SUMMARY_MIN: 30,    // 9:30 PM

  // Morning check — who hasn't checked in yet
  ABSENT_ALERT_HOUR: 12,
  ABSENT_ALERT_MIN: 0,
};
