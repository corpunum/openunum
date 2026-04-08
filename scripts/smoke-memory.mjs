#!/usr/bin/env node

/**
 * Smoke Test: Memory API
 *
 * Quick health check for memory freshness endpoints.
 * Tests: GET /api/memory/freshness, GET /api/memory/stale
 */

const API_BASE = process.env.OPENUNUM_API_URL || 'http://127.0.0.1:18880';

async function smokeTest() {
  console.log('🔍 Memory API Smoke Test');
  console.log('='.repeat(50));

  let passed = 0;
  let failed = 0;

  // Test 1: GET /api/memory/freshness
  console.log('\n1. Testing GET /api/memory/freshness...');
  try {
    const statsResponse = await fetch(`${API_BASE}/api/memory/freshness`);
    const stats = await statsResponse.json();

    if (statsResponse.ok && (stats.ok === true || 'halfLifeConfig' in stats)) {
      console.log('   ✅ Freshness endpoint working');
      console.log(`   📊 Half-life categories: ${Object.keys(stats.halfLifeConfig || {}).length}`);
      passed++;
    } else {
      console.log('   ❌ Freshness response invalid');
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Freshness request failed: ${error.message}`);
    failed++;
  }

  // Test 2: GET /api/memory/stale
  console.log('\n2. Testing GET /api/memory/stale...');
  try {
    const staleResponse = await fetch(`${API_BASE}/api/memory/stale?limit=20`);
    const staleResult = await staleResponse.json();

    if (staleResponse.ok && Array.isArray(staleResult.staleMemories || [])) {
      console.log('   ✅ Stale endpoint working');
      console.log(`   📊 Stale memories: ${(staleResult.staleMemories || []).length}`);
      passed++;
    } else {
      console.log('   ❌ Stale response invalid');
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Stale request failed: ${error.message}`);
    failed++;
  }

  // Test 3: stale payload structure
  console.log('\n3. Verifying stale payload structure...');
  try {
    const staleResponse = await fetch(`${API_BASE}/api/memory/stale?limit=5`);
    const staleResult = await staleResponse.json();

    if (staleResponse.ok && ('count' in staleResult) && Array.isArray(staleResult.staleMemories || [])) {
      console.log('   ✅ Stale payload structure valid');
      passed++;
    } else {
      console.log('   ❌ Stale payload structure invalid');
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Stale payload verification failed: ${error.message}`);
    failed++;
  }

  console.log('\n' + '='.repeat(50));
  console.log(`📊 Results: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('✅ Memory API smoke test PASSED');
    process.exit(0);
  } else {
    console.log('❌ Memory API smoke test FAILED');
    process.exit(1);
  }
}

const timeout = setTimeout(() => {
  console.log('\n❌ Test timed out (30s)');
  process.exit(1);
}, 30000);

smokeTest()
  .then(() => clearTimeout(timeout))
  .catch((error) => {
    clearTimeout(timeout);
    console.error('\n❌ Unexpected error:', error);
    process.exit(1);
  });
