#!/usr/bin/env node

/**
 * Smoke Test: Audit Logging API
 * 
 * Quick health check for audit logging endpoints.
 * Tests: GET /api/audit/stats, POST /api/audit/log, response validation
 */

const API_BASE = process.env.OPENUNUM_API_URL || 'http://localhost:3000';

async function smokeTest() {
  console.log('🔍 Audit API Smoke Test');
  console.log('=' .repeat(50));
  
  let passed = 0;
  let failed = 0;
  
  // Test 1: GET /api/audit/stats
  console.log('\n1. Testing GET /api/audit/stats...');
  try {
    const statsResponse = await fetch(`${API_BASE}/api/audit/stats`);
    const stats = await statsResponse.json();
    
    if (statsResponse.ok && 'totalLogs' in stats) {
      console.log('   ✅ Stats endpoint working');
      console.log(`   📊 Total logs: ${stats.totalLogs || 0}`);
      passed++;
    } else {
      console.log('   ❌ Stats response invalid');
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Stats request failed: ${error.message}`);
    failed++;
  }
  
  // Test 2: POST /api/audit/log
  console.log('\n2. Testing POST /api/audit/log...');
  let testLogId;
  try {
    const logResponse = await fetch(`${API_BASE}/api/audit/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'smoke_test',
        actor: 'smoke-test-runner',
        details: { test: true, timestamp: Date.now() }
      })
    });
    const logResult = await logResponse.json();
    
    if (logResponse.ok && logResult.logId) {
      console.log('   ✅ Log creation working');
      console.log(`   📝 Created log: ${logResult.logId}`);
      testLogId = logResult.logId;
      passed++;
      
      // Cleanup: Delete test log
      try {
        await fetch(`${API_BASE}/api/audit/log/${testLogId}`, {
          method: 'DELETE'
        });
        console.log('   🧹 Test log cleaned up');
      } catch (cleanupError) {
        console.log('   ⚠️  Cleanup failed (non-critical)');
      }
    } else {
      console.log('   ❌ Log creation failed');
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Log request failed: ${error.message}`);
    failed++;
  }
  
  // Test 3: Verify response structure
  console.log('\n3. Verifying response structure...');
  try {
    const statsResponse = await fetch(`${API_BASE}/api/audit/stats`);
    const stats = await statsResponse.json();
    
    const requiredFields = ['totalLogs', 'sessionsCount'];
    const missingFields = requiredFields.filter(f => !(f in stats));
    
    if (missingFields.length === 0) {
      console.log('   ✅ Response structure valid');
      passed++;
    } else {
      console.log(`   ❌ Missing fields: ${missingFields.join(', ')}`);
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Structure verification failed: ${error.message}`);
    failed++;
  }
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('✅ Audit API smoke test PASSED');
    process.exit(0);
  } else {
    console.log('❌ Audit API smoke test FAILED');
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
