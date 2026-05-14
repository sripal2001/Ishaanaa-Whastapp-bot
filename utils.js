// ============================================================
//  UTILS — GPS Distance (Haversine Formula)
// ============================================================

/**
 * Calculate distance between two GPS coordinates in meters
 */
function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const toRad = deg => deg * (Math.PI / 180);

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Check if coordinates are within radius of studio
 */
function isAtStudio(userLat, userLng, studioLat, studioLng, radiusMeters) {
  const dist = getDistance(userLat, userLng, studioLat, studioLng);
  return { isNear: dist <= radiusMeters, distance: Math.round(dist) };
}

/**
 * Format hours as "8h 30m"
 */
function formatHours(hours) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Calculate hours between two HH:mm strings
 */
function hoursBetween(timeIn, timeOut) {
  const [h1, m1] = timeIn.split(':').map(Number);
  const [h2, m2] = timeOut.split(':').map(Number);
  return ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60;
}

/**
 * Get current time as HH:mm string
 */
function nowTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * Parse a date string like "tomorrow", "13/05", "13-05-2026"
 */
function parseLeaveDate(input) {
  const dayjs = require('dayjs');
  const customParseFormat = require('dayjs/plugin/customParseFormat');
  dayjs.extend(customParseFormat);

  const lower = input.toLowerCase().trim();
  if (lower === 'tomorrow') return dayjs().add(1, 'day').format('YYYY-MM-DD');
  if (lower === 'today') return dayjs().format('YYYY-MM-DD');

  // Try DD/MM or DD-MM
  const match = lower.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const mon = match[2].padStart(2, '0');
    const yr  = dayjs().year();
    return `${yr}-${mon}-${day}`;
  }
  return null;
}

/**
 * Format date for display: "12 May 2026"
 */
function friendlyDate(dateStr) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

module.exports = { getDistance, isAtStudio, formatHours, hoursBetween, nowTime, parseLeaveDate, friendlyDate };
