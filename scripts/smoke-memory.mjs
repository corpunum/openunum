#!/usr/bin/env node

/**
 * Smoke Test: Memory API
 * 
 * Quick health check for memory endpoints.
 * Tests: GET /api/memory/stats, GET /api/memory/stale, POST /api/memory/refresh
 */

const API_BASE = process.env.OPENUNUM_API_URL || 'http://localhost:3000';

async function smokeTest() {
  console.log('🔍 Memory API Smoke Test');
  console.log('=' .repeat(50));
  
  let passed = 0;
  let failed = 0;
  let testMemoryId;
  
  // Test 1: GET /api/memory/stats
  console.log('\n1. Testing GET /api/memory/stats...');
  try {
    const statsResponse = await fetch(`${API_BASE}/api/memory/stats`);
    const stats = await statsResponse.json();
    
    if (statsResponse.ok && ('totalMemories' in stats || 'count' in stats)) {
      console.log('   ✅ Stats endpoint working');
      console.log(`   📊 Total memories: ${stats.totalMemories || stats.count || 0}`);
      if (stats.byCategory) {
        console.log(`   📁 Categories: ${Object.keys(stats.byCategory).join(', ') || 'none'}`);
      }
      passed++;
    } else {
      console.log('   ❌ Stats response invalid');
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Stats request failed: ${error.message}`);
    failed++;
  }
  
  // Test 2: GET /api/memory/stale
  console.log('\n2. Testing GET /api/memory/stale...');
  try {
    const staleResponse = await fetch(`${API_BASE}/api/memory/stale`);
    const staleResult = await staleResponse.json();
    
    if (staleResponse.ok && Array.isArray(staleResult.staleMemories || staleResult.memories)) {
      console.log('   ✅ Stale endpoint working');
      const staleList = staleResult.staleMemories || staleResult.memories;
      console.log(`   📊 Stale memories: ${staleList.length}`);
      passed++;
    } else {
      console.log('   ❌ Stale response invalid');
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Stale request failed: ${error.message}`);
    failed++;
  }
  
  // Test 3: POST /api/memory (create test memory)
  console.log('\n3. Testing POST /api/memory (create)...');
  try {
    const createResponse = await fetch(`${API_BASE}/api/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Smoke test memory for verification',
        category: 'fact',
        importance: 0.5,
        metadata: { smokeTest: true }
      })
    });
    const createResult = await createResponse.json();
    
    if (createResponse.ok && createResult.id) {
      console.log('   ✅ Memory creation working');
      testMemoryId = createResult.id;
      console.log(`   📝 Created memory: ${testMemoryId}`);
      passed++;
    } else {
      console.log('   ❌ Memory creation failed');
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Create request failed: ${error.message}`);
    failed++;
  }
  
  // Test 4: POST /api/memory/refresh
  console.log('\n4. Testing POST /api/memory/:id/refresh...');
  if (testMemoryId) {
    try {
      const refreshResponse = await fetch(`${API_BASE}/api/memory/${testMemoryId}/refresh`, {
        method: 'POST'
      });
      const refreshResult = await refreshResponse.json();
      
      if (refreshResponse.ok && (refreshResult.success || refreshResult.freshnessScore)) {
        console.log('   ✅ Refresh endpoint working');
        if (refreshResult.freshnessScore) {
          console.log(`   📊 Freshness score: ${refreshResult.freshnessScore.toFixed(2)}`);
        }
        passed++;
      } else {
        console.log('   ❌ Refresh response invalid');
        failed++;
      }
    } catch (error) {
      console.log(`   ❌ Refresh request failed: ${error.message}`);
      failed++;
    }
  } else {
    console.log('   ⏭️  Skipped (no test memory)');
  }
  
  // Test 5: Verify memory retrieval
  console.log('\n5. Testing GET /api/memory/:id (retrieval)...');
  if (testMemoryId) {
    try {
      const getResponse = await fetch(`${API_BASE}/api/memory/${testMemoryId}`);
      const memory = await getResponse.json();
      
      if (getResponse.ok && memory.text) {
        console.log('   ✅ Memory retrieval working');
        console.log(`   📝 Text: "${memory.text.slice(0, 50)}..."`);
        passed++;
        
        // Cleanup: Delete test memory
        try {
          await fetch(`${API_BASE}/api/memory/${testMemoryId}`, {
            method: 'DELETE'
          });
          console.log('   🧹 Test memory cleaned up');
        } catch (cleanupError) {
          console.log('   ⚠️  Cleanup failed (non-critical)');
        }
      } else {
        console.log('   ❌ Memory retrieval failed');
        failed++;
      }
    } catch (error) {
      console.log(`   ❌ Retrieval request failed: ${error.message}`);
      failed++;
    }
  } else {
    console.log('   ⏭️  Skipped (no test memory)');
  }
  
  // Test 6: Memory search
  console.log('\n6. Testing GET /api/memory/search...');
  try {
    const searchResponse = await fetch(`${API_BASE}/api/memory/search?q=test`);
    const searchResult = await searchResponse.json();
    
    if (searchResponse.ok && Array.isArray(searchResult.results || searchResult.memories)) {
      console.log('   ✅ Search endpoint working');
      const results = searchResult.results || searchResult.memories;
      console.log(`   📊 Results: ${results.length}`);
      passed++;
    } else {
      console.log('   ❌ Search response invalid');
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Search request failed: ${error.message}`);
    failed++;
  }
  
  // Summary
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
