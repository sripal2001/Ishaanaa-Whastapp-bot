// ============================================================
//  ISHAANAA DESIGNER STUDIO
//  WhatsApp Business Server v2.0 (Baileys — No Browser)
//  Handles: Employee Attendance + POS Invoice Delivery
// ============================================================

'use strict';

// Ensure all dates are processed in IST (Indian Standard Time)
process.env.TZ = 'Asia/Kolkata';

// ─── Global Error Handlers ───────────────────────────────────
process.on('uncaughtException',  (err) => console.error('❌ UNCAUGHT:', err.message, err.stack));
process.on('unhandledRejection', (r)   => console.error('❌ REJECTION:', r));

// ─── Imports ─────────────────────────────────────────────────
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  jidNormalizedUser,
  downloadContentFromMessage,
} = require('@whiskeysockets/baileys');
const pino        = require('pino');
const QRCode      = require('qrcode');
const express     = require('express');
const schedule    = require('node-schedule');
const dayjs       = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const utc         = require('dayjs/plugin/utc');
const timezone    = require('dayjs/plugin/timezone');

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Asia/Kolkata');

const mongoose    = require('mongoose');
const { Boom }    = require('@hapi/boom');

const db          = require('./database');
const reports     = require('./reports');
const config      = require('./config');
const { useMongoDBAuthState } = require('./baileys-auth-mongo');

// ─── Environment ─────────────────────────────────────────────
const PORT         = process.env.PORT || 10000;
const MONGODB_URI  = process.env.MONGODB_URI;
const BOT_API_KEY  = process.env.BOT_API_KEY || 'ish-bot-secret-2024';
const MANAGER_JID  = config.MANAGER_PHONE.replace(/\D/g, '') + '@s.whatsapp.net';

// ─── State ───────────────────────────────────────────────────
let sock         = null;
let latestQR     = null;
let isConnected  = false;

// ============================================================
//  HEARTBEAT + API SERVER (Express)
// ============================================================
const app = express();
app.use(express.json({ limit: '20mb' })); // Needed for PDF base64

// ── Health check ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: isConnected ? '✅ WhatsApp Connected' : '⏳ Waiting for QR scan',
    timestamp: new Date().toISOString(),
  });
});

// ── QR Image API (returns latest QR as base64 JSON) ──────────
app.get('/qr-image', async (req, res) => {
  if (isConnected) return res.json({ connected: true });
  if (!latestQR)   return res.json({ connected: false, qr: null });
  try {
    const qrImage = await QRCode.toDataURL(latestQR, { errorCorrectionLevel: 'H', width: 400 });
    res.json({ connected: false, qr: qrImage });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── QR Code page (Live — updates every 5s without page reload) ─
app.get('/qr', (req, res) => {
  if (isConnected) {
    return res.send('<h2 style="font-family:sans-serif;color:green">✅ WhatsApp is Connected! No QR needed.</h2>');
  }
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Ishaanaa Bot — Scan QR</title>
  <style>
    body { font-family:sans-serif; display:flex; flex-direction:column;
           align-items:center; justify-content:center; min-height:100vh;
           background:#111; color:#eee; margin:0; }
    h1   { color:#25D366; }
    p    { color:#aaa; margin-bottom:24px; }
    img  { border:4px solid #25D366; border-radius:12px; }
    #status { font-size:13px; color:#888; margin-top:12px; }
  </style>
</head>
<body>
  <h1>🌸 Ishaanaa Bot</h1>
  <p>WhatsApp Business → Settings → Linked Devices → Link a Device</p>
  <div id="qrContainer"><p style="color:orange">⏳ Loading QR Code...</p></div>
  <p id="status">Updating every 5 seconds...</p>
  <script>
    async function refreshQR() {
      try {
        const res  = await fetch('/qr-image');
        const data = await res.json();
        const box  = document.getElementById('qrContainer');
        const st   = document.getElementById('status');
        if (data.connected) {
          box.innerHTML = '<h2 style="color:#25D366">✅ WhatsApp Connected!</h2>';
          st.textContent = 'Bot is live! You can close this tab.';
          return;
        }
        if (data.qr) {
          box.innerHTML = '<img src="' + data.qr + '" width="350" />';
          st.textContent = '✅ Fresh QR — Updated at ' + new Date().toLocaleTimeString() + '. Scan now!';
        } else {
          box.innerHTML = '<p style="color:orange">⏳ Waiting for QR from WhatsApp...</p>';
        }
      } catch(e) { console.error(e); }
    }
    refreshQR();
    setInterval(refreshQR, 5000);
  </script>
</body>
</html>`);
});

// ── Logout API (Fixes "No sessions" / Stale keys) ────────────
app.get('/logout', async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
      sock = null;
    }
    // Delete session from DB
    await mongoose.connection.collection('baileys_auth_keys').deleteMany({});
    res.send('<h2 style="color:green">✅ WhatsApp Session Cleared!</h2><p>Please restart the server on Render, or wait 10 seconds and go to <a href="/qr">/qr</a> to scan again.</p>');
    
    // Force exit to restart container and start fresh
    setTimeout(() => { process.exit(0); }, 3000);
  } catch (err) {
    res.status(500).send('❌ Error clearing session: ' + err.message);
  }
});

// ── POS Invoice API ──────────────────────────────────────────
// Called by the Flutter POS app after every sale
app.post('/api/send-invoice', async (req, res) => {
  // Auth check
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== BOT_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!isConnected || !sock) {
    return res.status(503).json({ error: 'WhatsApp not connected. Scan QR first.' });
  }

  const { phone, message, pdfBase64, filename } = req.body;
  if (!phone || !message || !pdfBase64) {
    return res.status(400).json({ error: 'Missing required fields: phone, message, pdfBase64' });
  }

  try {
    // Format phone number to WhatsApp JID
    const cleanPhone = phone.replace(/\D/g, '');
    const jid = (cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone) + '@s.whatsapp.net';

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const invoiceFilename = filename || `Invoice_${Date.now()}.pdf`;

    // Send PDF document first
    await sock.sendMessage(jid, {
      document: pdfBuffer,
      mimetype: 'application/pdf',
      fileName: invoiceFilename,
    });

    // Send the text message
    await sock.sendMessage(jid, { text: message });

    console.log(`✅ Invoice sent to ${phone} (${invoiceFilename})`);
    res.json({ success: true, message: `Invoice sent to ${phone}` });

  } catch (err) {
    console.error('❌ Invoice send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
  console.log(`   QR: http://localhost:${PORT}/qr`);
});

// ============================================================
//  BAILEYS WHATSAPP CLIENT
// ============================================================
async function connectWhatsApp() {
  const { version } = await fetchLatestBaileysVersion();
  console.log(`📱 Using WhatsApp Web v${version.join('.')}`);

  const { state, saveCreds } = await useMongoDBAuthState();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }), // Suppress verbose logs
    printQRInTerminal: true,
    browser: ['Ishaanaa Bot', 'Chrome', '120.0.0'],
    syncFullHistory: false,        // ← Key: don't sync old messages (saves RAM)
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });

  // ── Save credentials whenever they update ─────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── Connection status ──────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
      isConnected = false;
      const renderUrl = process.env.RENDER_EXTERNAL_URL || 'YOUR_RENDER_URL';
      console.log('\n📸 NEW QR CODE GENERATED');
      console.log('─────────────────────────────────────────');
      if (renderUrl !== 'YOUR_RENDER_URL') {
        console.log(`👆 SCAN HERE → ${renderUrl}/qr`);
      } else {
        console.log('👆 OPEN YOUR BROWSER AND GO TO:');
        console.log('   https://ishaanaa-whastapp-bot-attendance.onrender.com/qr');
      }
      console.log('─────────────────────────────────────────\n');
    }

    if (connection === 'open') {
      isConnected = true;
      latestQR = null;
      console.log('\n✅ WhatsApp Business Connected!');
      console.log('┌─────────────────────────────────────────────┐');
      console.log('│  🌸 ISHAANAA DESIGNER STUDIO                │');
      console.log('│     WhatsApp Business Server v2.0 — LIVE    │');
      console.log('└─────────────────────────────────────────────┘\n');

      // Notify manager the bot is online
      try {
        await sock.sendMessage(MANAGER_JID, {
          text: '🟢 *Ishaanaa Bot is LIVE*\n\nWhatsApp Business Server connected and ready.\n• Attendance tracking: ✅\n• Invoice delivery: ✅'
        });
      } catch (_) {}
    }

    if (connection === 'close') {
      isConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason     = DisconnectReason[statusCode] || statusCode;
      console.log(`⚠️ Disconnected. Reason: ${reason}`);

      // If connection was replaced by another instance (Render deploy overlap), EXIT to kill duplicate!
      if (reason === 'connectionReplaced' || statusCode === 440) {
        console.log('🔄 Connection replaced by another instance. Exiting to prevent loop...');
        process.exit(1);
      }
      
      // Always reconnect unless logged out
      if (statusCode !== DisconnectReason.loggedOut) {
        console.log('🔄 Reconnecting in 5s...');
        setTimeout(connectWhatsApp, 5000);
      } else {
        console.log('🚪 Logged out. Clearing session from MongoDB...');
        await mongoose.connection.collection('baileys_auth_keys').deleteMany({});
        console.log('Session cleared. Please restart the server to get a new QR code.');
      }
    }
  });

  // ── Message handler ───────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;          // Ignore own messages
      if (!msg.message)   continue;          // Ignore empty
      await handleIncomingMessage(msg);
    }
  });
}

// ============================================================
//  MESSAGE HANDLER — Attendance Logic
// ============================================================
let targetGroupId = null; // Cache the target group ID

async function handleIncomingMessage(msg) {
  try {
    const jid      = msg.key.remoteJid;
    const senderJid = jidNormalizedUser(msg.key.participant || jid); // Normalize to remove device ID
    const phone    = senderJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
    const isFromManager = senderJid === jidNormalizedUser(MANAGER_JID);
    const isGroup  = jid.endsWith('@g.us');

    // Extract actual message content
    let msgContent = msg.message;
    if (msgContent?.ephemeralMessage) msgContent = msgContent.ephemeralMessage.message;
    if (msgContent?.viewOnceMessage) msgContent = msgContent.viewOnceMessage.message;
    if (msgContent?.viewOnceMessageV2) msgContent = msgContent.viewOnceMessageV2.message;
    if (msgContent?.documentWithCaptionMessage) msgContent = msgContent.documentWithCaptionMessage.message;

    const text = (msgContent?.conversation || msgContent?.extendedTextMessage?.text || '').trim();
    const lower = text.toLowerCase();
    const locationMsg = msgContent?.locationMessage || msgContent?.liveLocationMessage;

    // 1. SILENTLY ignore all DMs (except from the Manager). 
    // Do not auto-reply so we don't spam customers.
    if (!isGroup && !isFromManager) {
      return; 
    }

    // 2. ONLY allow the target group from config.js
    if (isGroup) {
      if (!targetGroupId) {
        try {
          const meta = await sock.groupMetadata(jid);
          const actualName = (meta.subject || '').trim();
          const configName = (config.GROUP_NAME || '').trim();
          console.log(`🔍 Group message from: "${actualName}" | Expected: "${configName}"`);
          if (actualName.toLowerCase() === configName.toLowerCase()) {
            targetGroupId = jid; // Cache the correct group ID
            console.log(`✅ Locked to group: ${actualName} (${jid})`);
          } else {
            console.log(`⛔ Ignoring non-target group: "${actualName}"`);
            return; // Ignore this group
          }
        } catch (e) {
          console.log(`⚠️ Could not fetch group metadata for ${jid}: ${e.message}`);
          return; // If fetch fails, ignore
        }
      } else if (jid !== targetGroupId) {
        return; // Ignore all other groups instantly
      }
    }

    // Debug: log only messages from the valid group or manager
    const msgKeys = msg.message ? Object.keys(msg.message) : [];
    console.log(`📩 Valid MSG from ${phone} | keys: [${msgKeys.join(', ')}]`);

    // 2. Resolve Employee (Handle @lid hidden numbers)
    let emp = await db.getEmployeeByPhone(phone);
    
    // If not found, and they sent a registration command:
    if (!emp && lower.startsWith('register ')) {
      const name = text.substring(9).trim();
      const existingEmp = await db.Employee.findOne({ name: new RegExp('^' + name + '$', 'i') });
      if (existingEmp) {
        existingEmp.phone = phone; // Update their phone to this @lid
        await existingEmp.save();
        await sendText(jid, `✅ Successfully linked your WhatsApp to *${existingEmp.name}*! You can now check-in/out.`);
      } else {
        await sendText(jid, `❌ Could not find employee "${name}". Ask the manager to add you to config.js.`);
      }
      return;
    }

    // If still not found, tell them to register
    if (!emp && (locationMsg || lower.includes('checkin') || lower.includes('checkout') || lower.includes('logout'))) {
      await sendText(jid, `❌ Unregistered ID. Because your phone number is hidden in this group, please reply with:\n*register YourName*\n(e.g., register Neha)`);
      return;
    }

    // ── Location message = Check-in / Check-out ───────────────
    if (locationMsg) {
      // Normalize lat/lng field names (liveLocationMessage uses different keys)
      const normalizedLocation = {
        latitude: locationMsg.degreesLatitude || locationMsg.latitude,
        longitude: locationMsg.degreesLongitude || locationMsg.longitude,
      };
      await handleLocation(phone, normalizedLocation, jid);
      return;
    }

    // ── Text commands ─────────────────────────────────────────
    if (!text) return;

    // Manager commands
    if (isFromManager) {
      await handleManagerCommand(lower, text, jid);
      return;
    }

    // Employee commands
    if (!emp) return; // Ignore unknown numbers

    if (lower.includes('hi') || lower.includes('hello') || lower.includes('start')) {
      await sendText(jid,
        `👋 Hello ${emp.name}!\n\nPlease *share your live location* to check in or check out.\n\nTap the 📎 icon → Location → Share Live Location.`
      );
      return;
    }

    if (lower.includes('check in') || lower.includes('checkin') || lower.includes('login')) {
      await sendText(jid, `To check in, please *share your location* 📍\n\n(Tap the 📎 icon → Location → Send your current location).`);
      return;
    }

    if (lower.includes('check out') || lower.includes('checkout') || lower.includes('logout') || lower.includes('log out')) {
      await sendText(jid, `To check out, please *share your location* 📍\n\n(Tap the 📎 icon → Location → Send your current location).`);
      return;
    }

    if (lower === 'status' || lower === 'my status') {
      const record = await db.getTodayRecord(emp._id);
      if (!record) {
        await sendText(jid, `📋 *${emp.name}* — No attendance recorded today yet.`);
      } else {
        await sendText(jid,
          `📋 *${emp.name}* — Today's Status\n\n` +
          `Status: *${record.status}*\n` +
          `Check-in:  ${record.check_in  || '—'}\n` +
          `Check-out: ${record.check_out || '—'}\n` +
          `Hours: ${record.hours_worked ? record.hours_worked.toFixed(1) + 'h' : '—'}`
        );
      }
      return;
    }

    if (lower.startsWith('leave')) {
      const datePart = text.split(' ').slice(1).join(' ').trim();
      const leaveDate = datePart || dayjs().format('YYYY-MM-DD');
      await db.requestLeave(emp._id, leaveDate, msg.key.id);
      await sendText(jid, `✅ Leave request for *${leaveDate}* has been sent to the manager.`);
      await sendText(MANAGER_JID,
        `🙋 *Leave Request*\n\n*${emp.name}* has requested leave on *${leaveDate}*.\n\nReply *approve ${emp.name}* or *reject ${emp.name}*`
      );
      return;
    }

  } catch (err) {
    console.error('❌ Message handler error:', err.message);
  }
}

// ─── Location Handler ─────────────────────────────────────────
async function handleLocation(phone, locationMsg, jid) {
  const emp = await db.getEmployeeByPhone(phone);
  if (!emp) return;

  const { latitude, longitude } = locationMsg;
  const now   = dayjs();
  const timeStr = now.format('hh:mm A');

  // Check distance from studio
  const distanceKm = getDistance(
    latitude, longitude,
    config.STUDIO.lat, config.STUDIO.lng
  );

  const isNearStudio = distanceKm <= (config.STUDIO.radius / 1000); // Convert meters to km

  if (!isNearStudio) {
    await sendText(jid,
      `📍 Location received, but you appear to be *${distanceKm.toFixed(2)} km* from the studio.\n\n` +
      `Please share your location from *within the studio* to mark attendance.`
    );
    return;
  }

  // Check if already checked in today
  const record = await db.getTodayRecord(emp._id);

  if (!record) {
    // ── Check IN ─────────────────────────────────────────────
    // ONE-TIME FIX FOR TODAY (May 18): Backdate to 11:00 AM
    const todayStr = dayjs().format('YYYY-MM-DD');
    let finalTimeStr = timeStr;
    let status = isLate(now) ? 'Late' : 'Present';

    if (todayStr === '2026-05-18') {
      finalTimeStr = '11:00 AM';
      status = 'Present';
    }

    await db.checkIn(emp._id, finalTimeStr, status);
    await sendText(jid,
      `✅ *Check-in Recorded!*\n\n` +
      `👤 ${emp.name}\n` +
      `🕐 ${finalTimeStr} (Adjusted for today)\n` +
      `📌 ${distanceKm.toFixed(0)}m from studio\n` +
      `Status: *${status}*\n\n` +
      `Share location again to check out.`
    );
  } else if (!record.check_out) {
    // ── Check OUT ────────────────────────────────────────────
    const checkInTime = dayjs(`${dayjs().format('YYYY-MM-DD')} ${record.check_in}`, 'YYYY-MM-DD hh:mm A');
    const hoursWorked = now.diff(checkInTime, 'minute') / 60;
    const finalStatus = hoursWorked >= config.SHIFT.minHours ? 'Full Day' : 'Half Day';

    await db.checkOut(emp._id, timeStr, hoursWorked, finalStatus);
    await sendText(jid,
      `👋 *Check-out Recorded!*\n\n` +
      `👤 ${emp.name}\n` +
      `🕐 ${timeStr}\n` +
      `⏱ Hours worked: *${hoursWorked.toFixed(1)}h*\n` +
      `Status: *${finalStatus}*\n\n` +
      `See you tomorrow! 🌸`
    );
  } else {
    await sendText(jid, `✅ You're already checked out for today. See you tomorrow!`);
  }
}

// ─── Manager Commands ─────────────────────────────────────────
async function handleManagerCommand(lower, text, jid) {
  if (lower === 'report' || lower === 'today') {
    const report = await reports.todayTextReport();
    await sendText(jid, report);
    return;
  }

  if (lower === 'status' || lower === 'live') {
    const statusReport = await reports.statusTextReport();
    await sendText(jid, statusReport);
    return;
  }

  if (lower === 'excel' || lower === 'sheet') {
    try {
      await sendText(jid, '📊 Generating Excel report for this month...');
      const now = dayjs();
      const filepath = await reports.generateMonthlyExcel(now.year(), now.month() + 1);
      const filename = path.basename(filepath);
      
      await sock.sendMessage(jid, {
        document: fs.readFileSync(filepath),
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: filename,
        caption: `📅 Attendance Report for ${now.format('MMMM YYYY')}`
      });
      
      // Cleanup
      setTimeout(() => fs.unlink(filepath, () => {}), 2000);
    } catch (e) {
      await sendText(jid, `❌ Error generating Excel: ${e.message}`);
    }
    return;
  }

  if (lower.startsWith('approve ')) {
    const name = text.slice(8).trim();
    const emp = await db.getEmployeeByName(name);
    if (!emp) {
      await sendText(jid, `❌ Employee "${name}" not found.`);
      return;
    }
    const today = dayjs().format('YYYY-MM-DD');
    await db.requestLeave(emp._id, today, 'manager-approved-' + Date.now());
    const empJid = '91' + emp.phone.replace(/\D/g, '').slice(-10) + '@s.whatsapp.net';
    await sendText(empJid, `✅ Your leave for *${today}* has been *approved* by the manager.`);
    await sendText(jid, `✅ Leave approved for *${emp.name}*.`);
    return;
  }

  if (lower.startsWith('reject ')) {
    const name = text.slice(7).trim();
    const emp = await db.getEmployeeByName(name);
    if (!emp) {
      await sendText(jid, `❌ Employee "${name}" not found.`);
      return;
    }
    const empJid = '91' + emp.phone.replace(/\D/g, '').slice(-10) + '@s.whatsapp.net';
    await sendText(empJid, `❌ Your leave request has been *rejected* by the manager.`);
    await sendText(jid, `✅ Leave rejected for *${emp.name}*.`);
    return;
  }

  if (lower === 'help') {
    await sendText(jid,
      `🤖 *Manager Commands*\n\n` +
      `*report* — Today's attendance summary\n` +
      `*status* — Real-time studio status\n` +
      `*excel* — Get monthly Excel report file\n` +
      `*approve [name]* — Approve leave\n` +
      `*reject [name]* — Reject leave\n` +
      `*help* — Show this menu`
    );
    return;
  }
}

// ============================================================
//  SCHEDULED REPORTS
// ============================================================
function setupSchedules() {
  // Daily check-in reminder at 9:00 AM
  schedule.scheduleJob('0 9 * * 1-6', async () => {
    const employees = await db.getAllEmployees();
    for (const emp of employees) {
      const jid = '91' + emp.phone.replace(/\D/g, '').slice(-10) + '@s.whatsapp.net';
      try {
        await sendText(jid, `🌅 Good morning ${emp.name}! Please share your location to mark attendance.`);
        await new Promise(r => setTimeout(r, 1000)); // 1s delay between messages
      } catch (_) {}
    }
  });

  // Evening report to manager at 9:30 PM
  schedule.scheduleJob('30 21 * * 1-6', async () => {
    try {
      const report = await reports.todayTextReport();
      await sendText(MANAGER_JID, `📊 *Daily Attendance Report*\n\n${report}`);
    } catch (e) {
      console.error('Report error:', e.message);
    }
  });

  // Auto-mark Absent at 1:00 PM if no check-in
  schedule.scheduleJob('0 13 * * 1-6', async () => {
    try {
      const employees = await db.getAllEmployees();
      let absentees = [];
      
      for (const emp of employees) {
        const record = await db.getTodayRecord(emp._id);
        if (!record) {
          await db.markAbsent(emp._id);
          absentees.push(emp.name);
          console.log(`📍 Marked ${emp.name} as Absent (No check-in by 1PM)`);
        }
      }

      if (absentees.length > 0) {
        await sendText(MANAGER_JID, `⚠️ *Absent Alert*\n\nThe following employees have not checked in by 1:00 PM and are marked as Absent:\n\n- ${absentees.join('\n- ')}`);
      }
    } catch (e) {
      console.error('Auto-absent error:', e.message);
    }
  });

  console.log('📅 Schedules set: 9:00 AM reminders, 1:00 PM auto-absent, 9:30 PM report');
}

// ============================================================
//  UTILITY FUNCTIONS
// ============================================================
async function sendText(jid, text) {
  if (!sock || !isConnected) return;
  try {
    await sock.sendMessage(jid, { text });
  } catch (err) {
    console.error(`❌ Failed to send to ${jid}:`, err.message);
  }
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) { return deg * Math.PI / 180; }

function isLate(time) {
  const cutoff = dayjs().hour(config.SHIFT.lateAfterHour).minute(config.SHIFT.lateAfterMin).second(0);
  return time.isAfter(cutoff);
}

// ============================================================
//  STARTUP
// ============================================================
async function start() {
  console.log('┌─────────────────────────────────────────────┐');
  console.log('│  🌸 ISHAANAA DESIGNER STUDIO                │');
  console.log('│     WhatsApp Business Server v2.0           │');
  console.log('└─────────────────────────────────────────────┘\n');

  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI is not set! Exiting.');
    process.exit(1);
  }

  // Connect to MongoDB
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB Atlas');

  // Sync employees
  await db.upsertEmployees(config.EMPLOYEES);

  // NOTE: Auto-mark on startup removed — employees must check in via location.

  // Setup daily schedules
  setupSchedules();

  // Start WhatsApp
  console.log('📱 Connecting to WhatsApp Business...');
  await connectWhatsApp();
}

start().catch((err) => {
  console.error('❌ Fatal startup error:', err.message);
  process.exit(1);
});
