// ============================================================
//  ISHAANAA DESIGNER STUDIO
//  WhatsApp Business Server v3.0 (whatsapp-web.js)
//  Handles: Employee Attendance + POS Invoice Delivery
// ============================================================

'use strict';

// ─── Early Environment & Diagnostics Setup ──────────────────
const path = require('path');
const fs = require('fs');

// Ensure all dates are processed in IST (Indian Standard Time)
process.env.TZ = 'Asia/Kolkata';

// Configure Puppeteer Cache Dir BEFORE requiring wwebjs or puppeteer
process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || path.join(__dirname, '.cache', 'puppeteer');

// Global Diagnostic Logging
const startupLogs = [];
let startupError = null;

const originalLog = console.log;
const originalError = console.error;

console.log = (...args) => {
  const formatted = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  startupLogs.push(`[LOG] ${formatted}`);
  originalLog(...args);
};

console.error = (...args) => {
  const formatted = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  startupLogs.push(`[ERR] ${formatted}`);
  originalError(...args);
};

// ─── Global Error Handlers ────────────────────────────────────────
process.on('uncaughtException',  (err) => {
  startupError = err;
  console.error('❌ UNCAUGHT:', err.message, err.stack);
});
process.on('unhandledRejection', (r)   => {
  startupError = r instanceof Error ? r : new Error(String(r));
  console.error('❌ REJECTION:', r);
});

// ─── Imports ───────────────────────────────────────────────────────────
const { Client, RemoteAuth, MessageTypes, MessageMedia } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
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

const db          = require('./database');
const reports     = require('./reports');
const config      = require('./config');

// ─── Environment ─────────────────────────────────────────────────────────
const PORT         = process.env.PORT || 10000;
const MONGODB_URI  = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ishaanaa-pos';
const BOT_API_KEY  = process.env.BOT_API_KEY || 'ish-bot-secret-2024';
// wwebjs uses @c.us (not @s.whatsapp.net like Baileys)
const MANAGER_JID  = config.MANAGER_PHONE.replace(/\D/g, '') + '@c.us';

// ─── State ─────────────────────────────────────────────────────────────
let client       = null;
let latestQR     = null;
let isConnected  = false;
let targetGroupId = null;

// ============================================================
//  HEARTBEAT + API SERVER (Express)
// ============================================================
const app = express();
app.use(express.json({ limit: '20mb' })); // Needed for PDF base64

// ── Health check & Diagnostics Dashboard ────────────────────
app.get('/', (req, res) => {
  let cacheStatus = '❌ Missing';
  try {
    const cachePath = path.join(__dirname, '.cache', 'puppeteer');
    if (fs.existsSync(cachePath)) {
      const files = fs.readdirSync(cachePath);
      cacheStatus = `✅ Available (${files.length} items)`;
    }
  } catch (e) {
    cacheStatus = `⚠️ Error: ${e.message}`;
  }

  let statusClass = 'warning';
  let statusText = 'Initializing...';
  let actionHtml = '<div style="color:#aaa;font-size:0.85rem;margin-top:10px;">Connecting to WhatsApp Business...</div>';

  if (isConnected) {
    statusClass = 'success';
    statusText = 'Connected';
    actionHtml = '<div style="color:#2ecc71;font-size:0.85rem;margin-top:10px;">Bot is active and running!</div>';
  } else if (startupError) {
    statusClass = 'error';
    statusText = 'Initialization Failed';
    actionHtml = `<div style="color:#ff5f56;font-size:0.85rem;margin-top:10px;font-family:monospace;white-space:pre-wrap;word-break:break-all;">Error: ${startupError.message}</div>`;
  } else if (latestQR) {
    statusClass = 'warning';
    statusText = 'Scan Required';
    actionHtml = '<a href="/qr" class="action-btn">Scan QR Code</a>';
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const logLines = startupLogs
    .slice(-150)
    .map(line => {
      const isErr = line.startsWith('[ERR]');
      return `<div class="log-line ${isErr ? 'log-err' : 'log-log'}">${escapeHtml(line)}</div>`;
    })
    .join('\n');

  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Ishaanaa Attendance Bot Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0c10;
      --surface: #1f2833;
      --primary: #66fcf1;
      --secondary: #45f3ff;
      --text: #c5c6c7;
      --text-bright: #ffffff;
      --success: #2ecc71;
      --error: #e74c3c;
      --warning: #f1c40f;
    }
    body {
      font-family: 'Outfit', sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 40px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
    }
    .container {
      max-width: 1000px;
      width: 100%;
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
    }
    .header h1 {
      font-size: 2.8rem;
      font-weight: 800;
      background: linear-gradient(45deg, var(--primary), var(--secondary));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin: 0 0 10px 0;
      letter-spacing: -1px;
    }
    .header p {
      font-size: 1.1rem;
      color: #8892b0;
      margin: 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .card {
      background: var(--surface);
      border-radius: 16px;
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
    }
    .card:hover {
      transform: translateY(-5px);
      box-shadow: 0 10px 30px rgba(71, 243, 255, 0.1);
      border-color: rgba(71, 243, 255, 0.2);
    }
    .card-title {
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #8892b0;
      margin-bottom: 12px;
      font-weight: 600;
    }
    .card-value {
      font-size: 1.6rem;
      font-weight: 700;
      color: var(--text-bright);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .status-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      display: inline-block;
    }
    .status-dot.success { background: var(--success); box-shadow: 0 0 12px var(--success); }
    .status-dot.error { background: var(--error); box-shadow: 0 0 12px var(--error); }
    .status-dot.warning { background: var(--warning); box-shadow: 0 0 12px var(--warning); }
    
    .console-container {
      background: #050608;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      padding: 24px;
      margin-top: 30px;
      box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.8);
    }
    .console-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 12px;
    }
    .console-title {
      font-family: 'Outfit', sans-serif;
      font-size: 1rem;
      font-weight: 600;
      color: #8892b0;
    }
    .console-actions {
      display: flex;
      gap: 8px;
    }
    .dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }
    .dot-red { background: #ff5f56; }
    .dot-yellow { background: #ffbd2e; }
    .dot-green { background: #27c93f; }
    
    .console-body {
      font-family: 'Fira Code', monospace;
      font-size: 0.9rem;
      line-height: 1.6;
      color: #a8b2d1;
      max-height: 400px;
      overflow-y: auto;
      white-space: pre-wrap;
    }
    .log-line {
      margin-bottom: 6px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.02);
      padding-bottom: 4px;
    }
    .log-line.log-err { color: #ff5f56; }
    .log-line.log-log { color: #a8b2d1; }
    
    .action-btn {
      display: inline-block;
      background: linear-gradient(45deg, #1f2833, #2c3540);
      color: var(--primary);
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      border: 1px solid rgba(71, 243, 255, 0.2);
      transition: all 0.2s ease;
      cursor: pointer;
      text-align: center;
      margin-top: 15px;
    }
    .action-btn:hover {
      background: var(--primary);
      color: var(--bg);
      box-shadow: 0 0 15px rgba(71, 243, 255, 0.4);
      transform: translateY(-2px);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🌸 Ishaanaa Attendance System</h1>
      <p>Diagnostic & Live Status Dashboard</p>
    </div>
    
    <div class="grid">
      <!-- Database Card -->
      <div class="card">
        <div class="card-title">Database Integration</div>
        <div class="card-value">
          <span class="status-dot success"></span>
          Atlas Connected
        </div>
      </div>
      
      <!-- WhatsApp Engine Card -->
      <div class="card">
        <div class="card-title">WhatsApp Client</div>
        <div class="card-value">
          <span class="status-dot ${statusClass}"></span>
          ${statusText}
        </div>
        ${actionHtml}
      </div>
      
      <!-- Environment Card -->
      <div class="card">
        <div class="card-title">Puppeteer Cache</div>
        <div class="card-value">
          ${cacheStatus}
        </div>
      </div>
    </div>
    
    <!-- Console Logs -->
    <div class="console-container">
      <div class="console-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div class="dot dot-red"></div>
          <div class="dot dot-yellow"></div>
          <div class="dot dot-green"></div>
          <span class="console-title">Startup stdout / stderr logs</span>
        </div>
        <div style="color: #66fcf1; font-size: 0.8rem; font-family: monospace;">UTC: ${new Date().toISOString()}</div>
      </div>
      <div class="console-body">${logLines}</div>
    </div>
  </div>
</body>
</html>`);
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

// ── Debug endpoint ────────────────────────────────────────────
app.get('/debug', async (req, res) => {
  let groups = [];
  try {
    if (client && isConnected) {
      const chats = await client.getChats();
      groups = chats
        .filter(c => c.isGroup)
        .map(c => ({ id: c.id._serialized, name: c.name }));
    }
  } catch (e) {}
  res.json({
    connected: isConnected,
    targetGroupId,
    configGroupName: config.GROUP_NAME,
    groups: groups.slice(0, 50),
  });
});

// ── Logout API (Fixes "No sessions" / Stale keys) ────────────
app.get('/logout', async (req, res) => {
  try {
    if (client) {
      await client.logout();
      client = null;
    }
    // Delete session from DB
    await mongoose.connection.collection('remote_auth_sessions').deleteMany({});
    res.send('<h2 style="color:green">✅ WhatsApp Session Cleared!</h2><p>Please restart the server on Render, or wait 10 seconds and go to <a href="/qr">/qr</a> to scan again.</p>');
    
    // Force exit to restart container and start fresh
    setTimeout(() => { process.exit(0); }, 3000);
  } catch (err) {
    res.status(500).send('❌ Error clearing session: ' + err.message);
  }
});

// ── Pairing Code API ─────────────────────────────────────────
app.get('/pair', async (req, res) => {
  return res.send('<h2>Feature Not Supported</h2><p>wwebjs only supports QR code scanning.</p>');
});

// ── POS Invoice API ───────────────────────────────────────────
app.post('/api/send-invoice', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== BOT_API_KEY)
    return res.status(401).json({ error: 'Unauthorized' });

  if (!isConnected || !client)
    return res.status(503).json({ error: 'WhatsApp not connected. Scan QR first.' });

  const { phone, message, pdfBase64, filename } = req.body;
  if (!phone || !message || !pdfBase64)
    return res.status(400).json({ error: 'Missing: phone, message, pdfBase64' });

  try {
    const cleanPhone = phone.replace(/\D/g, '');
    const jid = (cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone) + '@c.us';

    const invoiceFilename = filename || `Invoice_${Date.now()}.pdf`;

    // Send PDF document first using MessageMedia (base64 string)
    const media = new MessageMedia('application/pdf', pdfBase64, invoiceFilename);
    await client.sendMessage(jid, media);

    // Send the text message
    await client.sendMessage(jid, message);

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
//  WHATSAPP CLIENT (whatsapp-web.js + Chromium)
// ============================================================
async function initWhatsApp() {
  // Ensure MongoDB is connected before creating MongoStore
  await mongoose.connection.asPromise();

  const store = new MongoStore({ mongoose });

  // Resolve executable path with fallback validation
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (executablePath && !fs.existsSync(executablePath)) {
    console.log(`⚠️ Specified PUPPETEER_EXECUTABLE_PATH (${executablePath}) not found. Falling back to cached Chrome.`);
    executablePath = undefined;
  }

  client = new Client({
    authStrategy: new RemoteAuth({
      store,
      backupSyncIntervalMs: 300000, // Save session every 5 min
    }),
    puppeteer: {
      headless: true,
      executablePath,
      // Args tuned for Render free tier (low RAM, Linux container)
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // Reduces RAM significantly
        '--disable-gpu',
      ],
    },
  });

  client.on('qr', qr => {
    latestQR = qr;
    isConnected = false;
    const renderUrl = process.env.RENDER_EXTERNAL_URL || '';
    console.log('\n📸 QR CODE GENERATED');
    if (renderUrl) console.log(`👆 Scan at: ${renderUrl}/qr`);
  });

  client.on('ready', async () => {
    isConnected = true;
    latestQR = null;
    targetGroupId = null; // Reset so group is re-detected
    console.log('\n✅ WhatsApp Business Connected!');
    console.log('┌────────────────────────────────────────────┐');
    console.log('│  🌸 ISHAANAA DESIGNER STUDIO                │');
    console.log('│     WhatsApp Business Server v3.0 — LIVE  │');
    console.log('└────────────────────────────────────────────┘\n');
  });

  client.on('disconnected', reason => {
    isConnected = false;
    console.log('⚠️ Disconnected:', reason);
    // Re-initialize after 10s
    setTimeout(() => initWhatsApp(), 10000);
  });

  // Main message handler
  client.on('message', async msg => {
    if (msg.fromMe) return;
    await handleIncomingMessage(msg);
  });

  await client.initialize();
}

// ============================================================
//  MESSAGE HANDLER — Attendance Logic (wwebjs)
// ============================================================

async function handleIncomingMessage(msg) {
  try {
    const chat      = await msg.getChat();
    const isGroup   = chat.isGroup;
    const jid       = msg.from;                           // Group or personal JID
    const senderJid = isGroup ? msg.author : msg.from;    // Real sender
    const phone     = (senderJid || '').replace('@c.us', '').replace('@s.whatsapp.net', '');
    const isFromManager = senderJid === MANAGER_JID;

    const text  = (msg.body || '').trim();
    const lower = text.toLowerCase();
    const isLocation = msg.type === MessageTypes.LOCATION;

    // In wwebjs, sending to group JID works perfectly — no LID session issues!
    // replyJid is simply the chat JID (group or DM)
    const replyJid = jid;

    // Allow manager DMs; allow employee DMs; ignore unknown DMs
    if (!isGroup && !isFromManager) {
      const empCheck = await db.getEmployeeByPhone(phone);
      if (!empCheck) return;
    }

    // Filter to target group only
    if (isGroup) {
      if (!targetGroupId) {
        const groupName = chat.name.trim();
        const configName = (config.GROUP_NAME || '').trim();
        console.log(`🔍 GROUP: "${groupName}" | config: "${configName}"`);
        if (groupName.toLowerCase() === configName.toLowerCase()) {
          targetGroupId = jid;
          console.log(`✅ Locked to group: ${groupName} (${jid})`);
        } else {
          console.log(`⛔ Skipped group "${groupName}"`);
          return;
        }
      } else if (jid !== targetGroupId) {
        return;
      }
    }

    const msgType = msg.type;
    console.log(`📩 MSG from ${phone} | type: ${msgType} | ${isGroup ? 'GROUP' : 'DM'}`);

    let emp = await db.getEmployeeByPhone(phone);

    // Register command (LID users link their name)
    if (!emp && lower.startsWith('register ')) {
      const name = text.substring(9).trim();
      const existingEmp = await db.Employee.findOne({ name: new RegExp('^' + name + '$', 'i') });
      if (existingEmp) {
        existingEmp.phone = phone;
        await existingEmp.save();
        const cfgEmp = config.EMPLOYEES.find(e => e.name.toLowerCase() === name.toLowerCase());
        const regJid = cfgEmp ? `${cfgEmp.phone}@c.us` : null;
        if (regJid) await sendText(regJid, `✅ Linked to *${existingEmp.name}*! Share your location to check in.`);
        console.log(`✅ Registered LID ${phone} as ${existingEmp.name}`);
      } else {
        console.log(`⚠️ Register failed: "${name}" not found in employee list`);
      }
      return;
    }

    // Unregistered LID — can't reply, just log
    if (!emp && (isLocation || lower.includes('checkin') || lower.includes('checkout'))) {
      console.log(`⚠️ Unregistered user ${phone}. They should send: register <Name>`);
      return;
    }

    // Location = Check-in / Check-out
    if (isLocation) {
      const location = {
        latitude:  msg.location.latitude,
        longitude: msg.location.longitude,
      };
      await handleLocation(phone, location, replyJid);
      return;
    }

    if (!text) return;

    if (isFromManager) {
      await handleManagerCommand(lower, text, replyJid);
      return;
    }

    if (!emp) return;

    if (lower.includes('hi') || lower.includes('hello') || lower.includes('start')) {
      await sendText(replyJid, `👋 Hello ${emp.name}!\n\nShare your *live location* to check in or out.\n\nTap 📎 → Location → Share Live Location.`);
      return;
    }
    if (lower.includes('check in') || lower.includes('checkin') || lower.includes('login')) {
      await sendText(replyJid, `To check in, share your location 📍\n\nTap 📎 → Location → Send current location.`);
      return;
    }
    if (lower.includes('check out') || lower.includes('checkout') || lower.includes('logout') || lower.includes('log out')) {
      await sendText(replyJid, `To check out, share your location 📍\n\nTap 📎 → Location → Send current location.`);
      return;
    }
    if (lower === 'status' || lower === 'my status') {
      const record = await db.getTodayRecord(emp._id);
      if (!record) {
        await sendText(replyJid, `📋 *${emp.name}* — No attendance recorded today yet.`);
      } else {
        await sendText(replyJid,
          `📋 *${emp.name}* — Today\n\nStatus: *${record.status}*\nCheck-in:  ${record.check_in || '—'}\nCheck-out: ${record.check_out || '—'}\nHours: ${record.hours_worked ? record.hours_worked.toFixed(1) + 'h' : '—'}`
        );
      }
      return;
    }
    if (lower.startsWith('leave')) {
      const leaveDate = text.split(' ').slice(1).join(' ').trim() || dayjs().format('YYYY-MM-DD');
      await db.requestLeave(emp._id, leaveDate, msg.id._serialized || msg.id);
      await sendText(replyJid, `✅ Leave request for *${leaveDate}* sent to manager.`);
      await sendText(MANAGER_JID, `🙋 *Leave Request*\n\n*${emp.name}* → *${leaveDate}*\n\nReply: *approve ${emp.name}* or *reject ${emp.name}*`);
      return;
    }

  } catch (err) {
    console.error('❌ Message handler error:', err.message);
  }
}

// ─── Location Handler ─────────────────────────────────────────
async function handleLocation(phone, locationMsg, replyJid) {
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
    await sendText(replyJid,
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
    await sendText(replyJid,
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
    await sendText(replyJid,
      `👋 *Check-out Recorded!*\n\n` +
      `👤 ${emp.name}\n` +
      `🕐 ${timeStr}\n` +
      `⏱ Hours worked: *${hoursWorked.toFixed(1)}h*\n` +
      `Status: *${finalStatus}*\n\n` +
      `See you tomorrow! 🌸`
    );
  } else {
    await sendText(replyJid, `✅ You're already checked out for today. See you tomorrow!`);
  }
}

// ─── Manager Commands ─────────────────────────────────────────
async function handleManagerCommand(lower, text, replyJid) {
  if (lower === 'report' || lower === 'today') {
    const report = await reports.todayTextReport();
    await sendText(replyJid, report);
    return;
  }

  if (lower === 'status' || lower === 'live') {
    const statusReport = await reports.statusTextReport();
    await sendText(replyJid, statusReport);
    return;
  }

  if (lower === 'excel' || lower === 'sheet') {
    try {
      await sendText(replyJid, '📊 Generating Excel report for this month...');
      const now = dayjs();
      const filepath = await reports.generateMonthlyExcel(now.year(), now.month() + 1);
      const filename = path.basename(filepath);
      
      const base64Data = fs.readFileSync(filepath).toString('base64');
      const media = new MessageMedia(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64Data,
        filename
      );
      await client.sendMessage(replyJid, media, { caption: `📅 Attendance Report for ${now.format('MMMM YYYY')}` });
      
      // Cleanup
      setTimeout(() => fs.unlink(filepath, () => {}), 2000);
    } catch (e) {
      await sendText(replyJid, `❌ Error generating Excel: ${e.message}`);
    }
    return;
  }

  if (lower.startsWith('approve ')) {
    const name = text.slice(8).trim();
    const emp = await db.getEmployeeByName(name);
    if (!emp) {
      await sendText(replyJid, `❌ Employee "${name}" not found.`);
      return;
    }
    const today = dayjs().format('YYYY-MM-DD');
    await db.requestLeave(emp._id, today, 'manager-approved-' + Date.now());
    const cleanPhone = emp.phone.replace(/\D/g, '');
    const empJid = (cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone) + '@c.us';
    await sendText(empJid, `✅ Your leave for *${today}* has been *approved* by the manager.`);
    await sendText(replyJid, `✅ Leave approved for *${emp.name}*.`);
    return;
  }

  if (lower.startsWith('reject ')) {
    const name = text.slice(7).trim();
    const emp = await db.getEmployeeByName(name);
    if (!emp) {
      await sendText(replyJid, `❌ Employee "${name}" not found.`);
      return;
    }
    const cleanPhone = emp.phone.replace(/\D/g, '');
    const empJid = (cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone) + '@c.us';
    await sendText(empJid, `❌ Your leave request has been *rejected* by the manager.`);
    await sendText(replyJid, `✅ Leave rejected for *${emp.name}*.`);
    return;
  }

  if (lower === 'help') {
    await sendText(replyJid,
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
      const jid = '91' + emp.phone.replace(/\D/g, '').slice(-10) + '@c.us';
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
  if (!client || !isConnected) {
    console.log('⚠️ Cannot send — WhatsApp not ready');
    return;
  }
  try {
    await client.sendMessage(jid, text);
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
  console.log('│     WhatsApp Business Server v3.0           │');
  console.log('└─────────────────────────────────────────────┘\n');

  try {
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI is not set!');
    }

    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB Atlas');

    // Sync employees
    await db.upsertEmployees(config.EMPLOYEES);

    // Setup daily schedules
    setupSchedules();

    // Start WhatsApp
    console.log('📱 Starting WhatsApp Business (wwebjs + Chromium)...');
    await initWhatsApp();
  } catch (err) {
    startupError = err;
    console.error('❌ Diagnostic Startup Catch:', err.message, err.stack);
    console.log('⚠️ Server running in Diagnostic Only Mode so Render does not crash.');
  }
}

start().catch((err) => {
  startupError = err;
  console.error('❌ Unhandled top-level start error:', err.message, err.stack);
});
