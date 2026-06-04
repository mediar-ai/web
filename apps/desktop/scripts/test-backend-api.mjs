#!/usr/bin/env node
/**
 * Test script for authenticated API calls to production web-app backend
 * Uses DEV_AUTH_TOKEN from .env.local (local or web-app workspace)
 */

import fs from "fs";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Production API base URL
const API_BASE_URL = "https://app.mediar.ai";

// Read DEV_AUTH_TOKEN from .env.local
const localEnvPath = path.join(__dirname, "..", ".env.local"); // Project root .env.local
const webAppEnvPath = path.join("C:", "Users", "screenpipe-windows", "mediar-web-app-workspace", ".env.local");
let DEV_AUTH_TOKEN = null;

// Try local .env.local first
try {
  const envContent = fs.readFileSync(localEnvPath, "utf8");
  const tokenMatch = envContent.match(/DEV_AUTH_TOKEN=(.+)/);
  if (tokenMatch) {
    DEV_AUTH_TOKEN = tokenMatch[1].trim();
    console.log("Using DEV_AUTH_TOKEN from local .env.local");
  }
} catch (error) {
  // Silent fail, will try web-app next
}

// Fallback to web-app workspace .env.local
if (!DEV_AUTH_TOKEN) {
  try {
    const envContent = fs.readFileSync(webAppEnvPath, "utf8");
    const tokenMatch = envContent.match(/DEV_AUTH_TOKEN=(.+)/);
    if (tokenMatch) {
      DEV_AUTH_TOKEN = tokenMatch[1].trim();
      console.log("Using DEV_AUTH_TOKEN from web-app workspace");
    }
  } catch (error) {
    console.error("Failed to read .env.local from web-app workspace:", error.message);
  }
}

// Require the token to be provided via .env.local; no hardcoded fallback
if (!DEV_AUTH_TOKEN) {
  console.error(
    "DEV_AUTH_TOKEN not found. Set it in apps/desktop/.env.local or the web-app workspace .env.local before running this script."
  );
  process.exit(1);
}

console.log("=".repeat(80));
console.log("Testing Production Web-App Backend API");
console.log("=".repeat(80));
console.log(`API Base URL: ${API_BASE_URL}`);
console.log(`Auth Token: ${DEV_AUTH_TOKEN.substring(0, 20)}...`);
console.log("");

// Color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function printSection(title) {
  console.log(`\n${colors.bright}${colors.cyan}${"=".repeat(60)}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}${title}${colors.reset}`);
  console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}\n`);
}

function printSuccess(message) {
  console.log(`${colors.green}✅ ${message}${colors.reset}`);
}

function printError(message) {
  console.log(`${colors.red}❌ ${message}${colors.reset}`);
}

function printInfo(message) {
  console.log(`${colors.yellow}ℹ️  ${message}${colors.reset}`);
}

// Test 1: Verify Desktop Token
async function testVerifyToken() {
  printSection("Test 1: Verify Desktop Token");

  const url = `${API_BASE_URL}/api/auth/verify-desktop-token`;

  try {
    printInfo(`POST ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEV_AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        machineId: "test-machine-" + Date.now(),
        appVersion: "1.0.0-test",
      }),
    });

    console.log(`Response Status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      const data = await response.json();
      printSuccess("Token verified successfully!");
      console.log("User Info:", JSON.stringify(data.user, null, 2));
      return true;
    } else {
      const errorText = await response.text();
      printError(`Token verification failed: ${errorText}`);
      return false;
    }
  } catch (error) {
    printError(`Request failed: ${error.message}`);
    return false;
  }
}

// Test 2: AI Chat Endpoint
async function testAIChat() {
  printSection("Test 2: AI Chat Endpoint");

  const url = `${API_BASE_URL}/api/ai`;

  try {
    printInfo(`POST ${url}`);

    const requestBody = {
      model: "gemini-2.5-pro",
      input: "Hello! Can you confirm this API is working? Please respond with a short message.",
      system: "You are a helpful assistant. Keep responses brief.",
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 100,
      },
    };

    console.log("Request Body:", JSON.stringify(requestBody, null, 2));

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEV_AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    console.log(`Response Status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      const data = await response.json();
      printSuccess("AI Chat API call successful!");
      console.log("\nAI Response:");
      console.log("-".repeat(40));
      console.log(data.text);
      console.log("-".repeat(40));
      if (data.metrics) {
        console.log("\nMetrics:", JSON.stringify(data.metrics, null, 2));
      }
      return true;
    } else {
      const errorText = await response.text();
      printError(`AI Chat failed: ${errorText}`);
      return false;
    }
  } catch (error) {
    printError(`Request failed: ${error.message}`);
    return false;
  }
}

// Test 3: Event Ingestion
async function testEventIngestion() {
  printSection("Test 3: Event Ingestion Endpoint");

  const url = `${API_BASE_URL}/api/ingest`;

  try {
    printInfo(`POST ${url}`);

    const testEvent = {
      type: "test_event",
      timestamp: new Date().toISOString(),
      data: {
        source: "mediar-app-test-script",
        message: "Testing event ingestion from desktop app",
        testId: Date.now(),
      },
    };

    console.log("Event Data:", JSON.stringify(testEvent, null, 2));

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEV_AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testEvent),
    });

    console.log(`Response Status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      const data = await response.text();
      printSuccess("Event ingested successfully!");
      if (data) {
        console.log("Response:", data);
      }
      return true;
    } else {
      const errorText = await response.text();
      printError(`Event ingestion failed: ${errorText}`);
      return false;
    }
  } catch (error) {
    printError(`Request failed: ${error.message}`);
    return false;
  }
}

// Test 4: MCP Workflow Ingestion
async function testMCPWorkflow() {
  printSection("Test 4: MCP Workflow Ingestion");

  const url = `${API_BASE_URL}/api/ingest/mcp-workflow`;

  try {
    printInfo(`POST ${url}`);

    const workflowData = {
      name: "test-workflow",
      status: "completed",
      steps: [
        {
          id: "step1",
          name: "Initialize",
          status: "success",
          duration: 100,
        },
        {
          id: "step2",
          name: "Process",
          status: "success",
          duration: 250,
        },
      ],
      totalDuration: 350,
      timestamp: new Date().toISOString(),
    };

    console.log("Workflow Data:", JSON.stringify(workflowData, null, 2));

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEV_AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(workflowData),
    });

    console.log(`Response Status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      const data = await response.text();
      printSuccess("MCP Workflow ingested successfully!");
      if (data) {
        console.log("Response:", data);
      }
      return true;
    } else {
      const errorText = await response.text();
      printError(`MCP Workflow ingestion failed: ${errorText}`);
      return false;
    }
  } catch (error) {
    printError(`Request failed: ${error.message}`);
    return false;
  }
}

// Test 5: Execution Q&A (if you have a valid execution ID)
async function testExecutionQA() {
  printSection("Test 5: Execution Q&A Endpoint");

  const url = `${API_BASE_URL}/api/ai/execution-qa`;
  const executionId = 14518; // Sample execution ID from the existing test script

  try {
    printInfo(`POST ${url}`);
    printInfo(`Using Execution ID: ${executionId}`);

    const requestBody = {
      executionId: executionId,
      messages: [
        {
          role: "user",
          content: "Can you list the workflow steps for this execution?",
        },
      ],
    };

    console.log("Request Body:", JSON.stringify(requestBody, null, 2));

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEV_AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    console.log(`Response Status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      const data = await response.json();
      printSuccess("Execution Q&A call successful!");
      console.log("\nAI Response:");
      console.log("-".repeat(40));
      if (data.text && data.text.length > 500) {
        console.log(data.text.substring(0, 500) + "...");
        console.log(`[Truncated - ${data.text.length} total characters]`);
      } else {
        console.log(data.text || "No text in response");
      }
      console.log("-".repeat(40));
      return true;
    } else {
      const errorText = await response.text();
      if (response.status === 404) {
        printInfo(`Execution ${executionId} not found (expected if it doesn't exist)`);
      } else {
        printError(`Execution Q&A failed: ${errorText}`);
      }
      return false;
    }
  } catch (error) {
    printError(`Request failed: ${error.message}`);
    return false;
  }
}

// Main test runner
async function runAllTests() {
  console.log(`${colors.bright}${colors.magenta}`);
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     MEDIAR APP → WEB-APP BACKEND API TEST SUITE         ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(colors.reset);

  const results = [];

  // Run tests sequentially
  results.push({ name: "Token Verification", passed: await testVerifyToken() });
  results.push({ name: "AI Chat", passed: await testAIChat() });
  results.push({ name: "Event Ingestion", passed: await testEventIngestion() });
  results.push({ name: "MCP Workflow", passed: await testMCPWorkflow() });
  results.push({ name: "Execution Q&A", passed: await testExecutionQA() });

  // Print summary
  printSection("Test Summary");

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log("Results:");
  results.forEach(r => {
    const icon = r.passed ? `${colors.green}✅` : `${colors.red}❌`;
    console.log(`  ${icon} ${r.name}${colors.reset}`);
  });

  console.log("\n" + "-".repeat(40));
  console.log(`Total: ${results.length} tests`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);

  if (passed === results.length) {
    console.log(`\n${colors.bright}${colors.green}🎉 All tests passed!${colors.reset}`);
  } else {
    console.log(`\n${colors.bright}${colors.yellow}⚠️  Some tests failed. Check the output above.${colors.reset}`);
  }
}

// Command line argument parsing
const args = process.argv.slice(2);
const command = args[0];

if (command === "--help" || command === "-h") {
  console.log("Usage: node test-backend-api.mjs [command]");
  console.log("");
  console.log("Commands:");
  console.log("  (no command)     Run all tests");
  console.log("  token           Test token verification only");
  console.log("  ai              Test AI chat only");
  console.log("  event           Test event ingestion only");
  console.log("  workflow        Test MCP workflow ingestion only");
  console.log("  qa              Test execution Q&A only");
  console.log("  --help, -h      Show this help message");
  process.exit(0);
}

// Run specific test or all tests
switch (command) {
  case "token":
    await testVerifyToken();
    break;
  case "ai":
    await testAIChat();
    break;
  case "event":
    await testEventIngestion();
    break;
  case "workflow":
    await testMCPWorkflow();
    break;
  case "qa":
    await testExecutionQA();
    break;
  default:
    await runAllTests();
}
