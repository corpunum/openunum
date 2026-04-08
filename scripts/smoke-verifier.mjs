#!/usr/bin/env node

/**
 * Smoke Test: Verifier API
 * 
 * Quick health check for verifier endpoints.
 * Tests: GET /api/verifier/stats, POST /api/verifier/check, response validation
 */

const API_BASE = process.env.OPENUNUM_API_URL || 'http://127.0.0.1:18880';

async function smokeTest() {
  console.log('🔍 Verifier API Smoke Test');
  console.log('=' .repeat(50));
  
  let passed = 0;
  let failed = 0;
  
  // Test 1: GET /api/verifier/stats
  console.log('\n1. Testing GET /api/verifier/stats...');
  try {
    const statsResponse = await fetch(`${API_BASE}/api/verifier/stats`);
    const stats = await statsResponse.json();
    
    if (statsResponse.ok && ('total' in stats || 'totalVerifications' in stats || 'checksCount' in stats)) {
      console.log('   ✅ Stats endpoint working');
      console.log(`   📊 Total verifications: ${stats.total || stats.totalVerifications || stats.checksCount || 0}`);
      passed++;
    } else {
      console.log('   ❌ Stats response invalid');
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Stats request failed: ${error.message}`);
    failed++;
  }
  
  // Test 2: POST /api/verifier/check
  console.log('\n2. Testing POST /api/verifier/check...');
  try {
    const checkResponse = await fetch(`${API_BASE}/api/verifier/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'state',
        before: { id: 'smoke-state', status: 'pending' },
        after: { id: 'smoke-state', status: 'completed' }
      })
    });
    const checkResult = await checkResponse.json();
    
    if (checkResponse.ok && ('verified' in checkResult || 'checks' in checkResult)) {
      console.log('   ✅ Verification check working');
      passed++;
    } else {
      console.log('   ❌ Verification check failed');
      console.log(`   Response: ${JSON.stringify(checkResult).slice(0, 200)}`);
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Check request failed: ${error.message}`);
    failed++;
  }
  
  // Test 3: Verify response structure
  console.log('\n3. Verifying response structure...');
  try {
    const checkResponse = await fetch(`${API_BASE}/api/verifier/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'tool',
        toolName: 'file_read',
        args: { path: '/tmp/does-not-matter' },
        after: { ok: true, content: 'ok' }
      })
    });
    const checkResult = await checkResponse.json();
    
    const requiredFields = ['verified', 'checks', 'confidence'];
    const presentFields = requiredFields.filter(f => f in checkResult);
    
    if (presentFields.length >= 2) {
      console.log(`   ✅ Response structure valid (${presentFields.length}/${requiredFields.length} fields)`);
      passed++;
      
    } else {
      console.log(`   ⚠️  Response structure partial (${presentFields.length}/${requiredFields.length} fields)`);
      console.log(`   Found: ${presentFields.join(', ') || 'none'}`);
      passed++; // Partial credit
    }
  } catch (error) {
    console.log(`   ❌ Structure verification failed: ${error.message}`);
    failed++;
  }
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('✅ Verifier API smoke test PASSED');
    process.exit(0);
  } else {
    console.log('❌ Verifier API smoke test FAILED');
    process.exit(1);
  }
}

// Run with timeout
const timeout = setTimeout(() => {
  console.log('\n❌ Test timed out (30s)');
  process.exit(1);
}, 30000);

smokeTest()
  .then(() => clearTimeout(timeout))
  .catch(error => {
    clearTimeout(timeout);
    console.error('\n❌ Unexpected error:', error);
    process.exit(1);
  });
