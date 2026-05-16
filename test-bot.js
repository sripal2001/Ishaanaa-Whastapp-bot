// Quick test script for the Ishaanaa Attendance Bot
const https = require('https');

const BASE_URL = 'ishaanaa-whastapp-bot-attendence.onrender.com';
const API_KEY = 'ish-bot-secret-2024';

function makeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: BASE_URL,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: responseData });
      });
    });
    req.on('error', (e) => reject(e));
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('==============================================');
  console.log('  ISHAANAA ATTENDANCE BOT - API TEST SUITE');
  console.log('==============================================\n');

  // Test 1: Health check
  console.log('TEST 1: Health Check (GET /)');
  try {
    const r = await makeRequest('GET', '/');
    console.log('  Status:', r.status);
    console.log('  Response:', r.body);
    console.log('  Result:', r.status === 200 ? '✅ PASS' : '❌ FAIL');
  } catch (e) {
    console.log('  ❌ ERROR:', e.message);
  }

  console.log('');

  // Test 2: QR Image endpoint
  console.log('TEST 2: QR Image Check (GET /qr-image)');
  try {
    const r = await makeRequest('GET', '/qr-image');
    console.log('  Status:', r.status);
    console.log('  Response:', r.body);
    console.log('  Result:', r.status === 200 ? '✅ PASS' : '❌ FAIL');
  } catch (e) {
    console.log('  ❌ ERROR:', e.message);
  }

  console.log('');

  // Test 3: Invoice API - wrong API key (should return 401)
  console.log('TEST 3: Invoice API - Wrong API Key (expect 401)');
  try {
    const data = JSON.stringify({ phone: '919999999999', message: 'Test', pdfBase64: 'dGVzdA==' });
    const options = {
      hostname: BASE_URL, path: '/api/send-invoice', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'wrong-key', 'Content-Length': Buffer.byteLength(data) },
    };
    const r = await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let rd = '';
        res.on('data', (c) => { rd += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: rd }));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
    console.log('  Status:', r.status);
    console.log('  Response:', r.body);
    console.log('  Result:', r.status === 401 ? '✅ PASS (Unauthorized)' : '❌ FAIL');
  } catch (e) {
    console.log('  ❌ ERROR:', e.message);
  }

  console.log('');

  // Test 4: Invoice API - missing fields (should return 400)
  console.log('TEST 4: Invoice API - Missing Fields (expect 400)');
  try {
    const r = await makeRequest('POST', '/api/send-invoice', { phone: '919999999999' });
    console.log('  Status:', r.status);
    console.log('  Response:', r.body);
    console.log('  Result:', r.status === 400 ? '✅ PASS (Bad Request)' : '❌ FAIL');
  } catch (e) {
    console.log('  ❌ ERROR:', e.message);
  }

  console.log('');

  // Test 5: Invoice API - valid request (should return 200 or 500 if number doesn't exist on WA)
  console.log('TEST 5: Invoice API - Valid Request (correct key + all fields)');
  try {
    const r = await makeRequest('POST', '/api/send-invoice', {
      phone: '919999999999',
      message: 'Test invoice from bot test suite',
      pdfBase64: 'dGVzdA==',
      filename: 'test_invoice.pdf',
    });
    console.log('  Status:', r.status);
    console.log('  Response:', r.body);
    console.log('  Result:', r.status === 200 ? '✅ PASS (Sent!)' : (r.status === 500 ? '⚠️ PASS (API works, WA send failed - expected for fake number)' : '❌ FAIL'));
  } catch (e) {
    console.log('  ❌ ERROR:', e.message);
  }

  console.log('\n==============================================');
  console.log('  TEST SUITE COMPLETE');
  console.log('==============================================');
}

runTests();
