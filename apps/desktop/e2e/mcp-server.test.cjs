/**
 * E2E Tests for MCP Server HTTP Endpoints
 *
 * Tests the MCP server's HTTP endpoints that are accessible without
 * the full MCP protocol handshake.
 *
 * Run: node e2e/mcp-server.test.cjs
 */

const http = require("http");

const MCP_HOST = "127.0.0.1";
const MCP_PORT = 8080;

// HTTP request helper
function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: MCP_HOST,
        port: MCP_PORT,
        path,
        method: "GET",
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, data });
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.end();
  });
}

// Test runner
const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  console.log("========================================");
  console.log("  MCP Server E2E Tests");
  console.log("========================================\n");

  // Check server availability
  try {
    await httpGet("/health");
    console.log("✅ MCP server is running on port", MCP_PORT, "\n");
  } catch (e) {
    console.log("❌ MCP server not available on port", MCP_PORT);
    console.log("   Error:", e.message);
    console.log("   Start Mediar app first.\n");
    process.exit(1);
  }

  for (const { name, fn } of tests) {
    process.stdout.write(`  ${name}... `);
    try {
      await fn();
      console.log("✅ PASS");
      passed++;
    } catch (e) {
      console.log("❌ FAIL");
      console.log(`     Error: ${e.message}`);
      failed++;
    }
  }

  console.log("\n========================================");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("========================================\n");

  process.exit(failed > 0 ? 1 : 0);
}

// ===== TESTS =====

test("/health endpoint returns healthy status", async () => {
  const res = await httpGet("/health");
  if (res.status !== 200) {
    throw new Error(`Expected 200, got ${res.status}`);
  }
  if (res.data.status !== "healthy") {
    throw new Error(`Expected healthy, got ${res.data.status}`);
  }
});

test("/health includes version info", async () => {
  const res = await httpGet("/health");
  if (!res.data.version) {
    throw new Error("Missing version in health response");
  }
  if (!res.data.timestamp) {
    throw new Error("Missing timestamp in health response");
  }
});

test("/health includes endpoint list", async () => {
  const res = await httpGet("/health");
  if (!res.data.endpoints) {
    throw new Error("Missing endpoints in health response");
  }
  const endpoints = Object.keys(res.data.endpoints);
  if (!endpoints.includes("/health")) {
    throw new Error("Missing /health in endpoints list");
  }
});

test("/status endpoint returns load info", async () => {
  const res = await httpGet("/status");
  if (res.status !== 200) {
    throw new Error(`Expected 200, got ${res.status}`);
  }
  // Status should have some structure
  if (typeof res.data !== "object") {
    throw new Error("Expected object response");
  }
});

test("/ready endpoint checks readiness", async () => {
  const res = await httpGet("/ready");
  // Ready can return 200 (ready) or 503 (not ready)
  if (res.status !== 200 && res.status !== 503) {
    throw new Error(`Expected 200 or 503, got ${res.status}`);
  }
});

test("invalid endpoint returns 404", async () => {
  const res = await httpGet("/nonexistent_endpoint_xyz");
  if (res.status !== 404) {
    throw new Error(`Expected 404, got ${res.status}`);
  }
});

test("server responds quickly to health check", async () => {
  const start = Date.now();
  await httpGet("/health");
  const elapsed = Date.now() - start;
  if (elapsed > 1000) {
    throw new Error(`Health check too slow: ${elapsed}ms (expected < 1000ms)`);
  }
});

test("multiple concurrent health checks work", async () => {
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(httpGet("/health"));
  }
  const results = await Promise.all(promises);
  for (const res of results) {
    if (res.status !== 200) {
      throw new Error(`Concurrent check failed with status ${res.status}`);
    }
  }
});

// Run
runTests();
