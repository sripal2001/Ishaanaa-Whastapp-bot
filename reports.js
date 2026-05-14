// ============================================================
//  REPORTS — Excel & Text Report Generation
// ============================================================

const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const dayjs   = require('dayjs');
const db      = require('./database');
const { formatHours, friendlyDate } = require('./utils');

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

// ─── Text Report: Today ───────────────────────────────────────
async function todayTextReport() {
  const rows = await db.getTodayAttendance();
  const date = friendlyDate(dayjs().format('YYYY-MM-DD'));

  let lines = [`📋 *Attendance — ${date}*\n`];

  for (const r of rows) {
    const icon = r.status === 'Absent' ? '❌' :
                 r.status === 'Late'   ? '⚠️' :
                 r.check_out           ? '✅' : '🟡';

    const inTime  = r.check_in  ? `IN ${r.check_in}` : 'No check-in';
    const outTime = r.check_out ? `| OUT ${r.check_out}` : '| Still IN';
    const hrs     = r.hours_worked > 0 ? `(${formatHours(r.hours_worked)})` : '';

    lines.push(`${icon} *${r.name}*: ${inTime} ${outTime} ${hrs}`);
  }

  const present = rows.filter(r => r.check_in).length;
  lines.push(`\n👥 ${present}/${rows.length} present today`);

  return lines.join('\n');
}

// ─── Text Report: Live Status ─────────────────────────────────
async function statusTextReport() {
  const rows = await db.getTodayAttendance();
  const inNow = rows.filter(r => r.check_in && !r.check_out);
  const out   = rows.filter(r => r.check_out);
  const none  = rows.filter(r => !r.check_in);

  let lines = [`🏪 *Studio Status — Right Now*\n`];

  if (inNow.length) {
    lines.push('🟢 *Currently IN:*');
    inNow.forEach(r => lines.push(`  • ${r.name} (since ${r.check_in})`));
  }

  if (out.length) {
    lines.push('\n🔵 *Checked OUT:*');
    out.forEach(r => lines.push(`  • ${r.name} (${formatHours(r.hours_worked)})`));
  }

  if (none.length) {
    lines.push('\n⚫ *Not yet in:*');
    none.forEach(r => lines.push(`  • ${r.name}`));
  }

  return lines.join('\n');
}

// ─── Excel Report: Monthly ────────────────────────────────────
async function generateMonthlyExcel(year, month) {
  const rows    = await db.getMonthAttendance(year, month);
  const emps    = await db.getAllEmployees();
  const monthNm = MONTHS[month - 1];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ishaanaa Attendance Bot';
  const ws = wb.addWorksheet(`${monthNm} ${year}`);

  // ── Header styling
  const PINK   = 'FFE91E8C';
  const DPINK  = 'FFC2185B';
  const WHITE  = 'FFFFFFFF';
  const LGREY  = 'FFF5F5F5';
  const YELLOW = 'FFFFF9C4';
  const RED    = 'FFFFCDD2';
  const GREEN  = 'FFC8E6C9';

  // Title row
  ws.mergeCells('A1:H1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `Ishaanaa Designer Studio — Attendance Report`;
  titleCell.font  = { name: 'Calibri', size: 16, bold: true, color: { argb: WHITE } };
  titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DPINK } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  // Month row
  ws.mergeCells('A2:H2');
  const monthCell = ws.getCell('A2');
  monthCell.value = `${monthNm} ${year}`;
  monthCell.font  = { name: 'Calibri', size: 12, bold: true, color: { argb: DPINK } };
  monthCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4EC' } };
  monthCell.alignment = { horizontal: 'center' };
  ws.getRow(2).height = 20;

  // Column headers
  const headers = ['Name', 'Date', 'Check In', 'Check Out', 'Hours Worked', 'Status', 'Late?', 'Notes'];
  const headerRow = ws.getRow(3);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font  = { bold: true, color: { argb: WHITE }, name: 'Calibri', size: 11 };
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: PINK } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' }
    };
  });
  ws.getRow(3).height = 22;

  // Column widths
  ws.columns = [
    { width: 14 }, { width: 14 }, { width: 12 }, { width: 12 },
    { width: 14 }, { width: 12 }, { width: 8 }, { width: 20 }
  ];

  // Data rows
  let rowIdx = 4;
  let totals = {};
  emps.forEach(e => { totals[e.name] = { present: 0, absent: 0, late: 0, totalHrs: 0 }; });

  const grouped = {};
  rows.forEach(r => {
    if (!grouped[r.name]) grouped[r.name] = [];
    grouped[r.name].push(r);
  });

  for (const [name, records] of Object.entries(grouped)) {
    for (const r of records) {
      const row = ws.getRow(rowIdx++);
      const isLate    = r.status === 'Late';
      const isAbsent  = r.status === 'Absent';
      const isShort   = r.status === 'Short Day';

      const bgColor = isAbsent ? RED : isLate ? YELLOW : rowIdx % 2 === 0 ? LGREY : WHITE;

      const vals = [
        r.name,
        friendlyDate(r.date),
        r.check_in  || '—',
        r.check_out || '—',
        r.hours_worked > 0 ? formatHours(r.hours_worked) : '—',
        r.status || '—',
        isLate ? 'Yes' : 'No',
        isShort ? `Short by ${formatHours(8 - r.hours_worked)}` : '',
      ];

      vals.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v;
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.font  = { name: 'Calibri', size: 10 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        };
      });

      if (totals[name]) {
        if (isAbsent) totals[name].absent++;
        else { totals[name].present++; totals[name].totalHrs += (r.hours_worked || 0); }
        if (isLate) totals[name].late++;
      }
    }
  }

  // Summary sheet
  const summWs = wb.addWorksheet('Summary');
  summWs.mergeCells('A1:F1');
  const st = summWs.getCell('A1');
  st.value = `Summary — ${monthNm} ${year}`;
  st.font  = { bold: true, size: 14, color: { argb: WHITE } };
  st.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DPINK } };
  st.alignment = { horizontal: 'center', vertical: 'middle' };
  summWs.getRow(1).height = 28;

  const sHeaders = ['Employee', 'Days Present', 'Days Absent', 'Late Days', 'Total Hours', 'Avg Hours/Day'];
  summWs.getRow(2).values = sHeaders;
  summWs.getRow(2).eachCell(cell => {
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PINK } };
    cell.alignment = { horizontal: 'center' };
  });
  summWs.columns = [{ width: 16 },{ width: 14 },{ width: 14 },{ width: 12 },{ width: 14 },{ width: 16 }];

  let si = 3;
  for (const [name, t] of Object.entries(totals)) {
    const avg = t.present > 0 ? (t.totalHrs / t.present).toFixed(1) : '0';
    summWs.getRow(si++).values = [
      name, t.present, t.absent, t.late,
      formatHours(t.totalHrs), `${avg}h`
    ];
  }

  const filename = `Ishaanaa_Attendance_${monthNm}_${year}.xlsx`;
  const filepath = path.join(__dirname, filename);
  await wb.xlsx.writeFile(filepath);
  return filepath;
}

// ─── Monthly summary text for WhatsApp ────────────────────────
async function monthSummaryText(year, month) {
  const rows    = await db.getMonthAttendance(year, month);
  const emps    = await db.getAllEmployees();
  const monthNm = MONTHS[month - 1];

  const totals = {};
  emps.forEach(e => { totals[e.name] = { present: 0, absent: 0, late: 0, hrs: 0 }; });

  rows.forEach(r => {
    if (!totals[r.name]) return;
    if (r.status === 'Absent') totals[r.name].absent++;
    else { totals[r.name].present++; totals[r.name].hrs += (r.hours_worked || 0); }
    if (r.status === 'Late') totals[r.name].late++;
  });

  let lines = [`📊 *${monthNm} ${year} Summary*\n`];
  for (const [name, t] of Object.entries(totals)) {
    const avg = t.present > 0 ? (t.hrs / t.present).toFixed(1) : '0';
    lines.push(
      `👤 *${name}*\n` +
      `  ✅ Present: ${t.present} days | ❌ Absent: ${t.absent}\n` +
      `  ⚠️ Late: ${t.late} | ⏱ Avg: ${avg}h/day`
    );
  }
  return lines.join('\n\n');
}

// ─── Sync Live Excel to Desktop ───────────────────────────────
async function syncExcelToDesktop() {
  // Only run if on Windows (Local PC)
  if (process.platform !== 'win32') return;

  try {
    const now = dayjs();
    const year = now.year();
    const month = now.month() + 1;
    
    // Generate the file locally
    const filepath = await generateMonthlyExcel(year, month);
    
    // Copy to Desktop
    const desktopPath = path.join(os.homedir(), 'Desktop');
    const destName = `Ishaanaa_Attendance_${MONTHS[month-1]}_${year}.xlsx`;
    const destPath = path.join(desktopPath, destName);
    
    if (fs.existsSync(desktopPath)) {
      fs.copyFileSync(filepath, destPath);
      console.log(`✅ Synced Live Excel to Desktop: ${destName}`);
    }
    
    setTimeout(() => fs.unlink(filepath, () => {}), 2000);
  } catch (err) {
    console.error('Failed to sync Excel to Desktop:', err);
  }
}

module.exports = { todayTextReport, statusTextReport, generateMonthlyExcel, monthSummaryText, syncExcelToDesktop };
