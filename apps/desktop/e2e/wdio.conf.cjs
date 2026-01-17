const path = require("path");
const { spawn } = require("child_process");

// Path to Tauri application binary
const tauriAppPath = path.resolve(__dirname, "../target/debug/mediar.exe");

// Path to tauri-driver
const tauriDriverPath =
  process.env.TAURI_DRIVER_PATH ||
  path.join(process.env.USERPROFILE || process.env.HOME, ".cargo/bin/tauri-driver");

let tauriDriver;

exports.config = {
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./specs/**/*.spec.js"],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        application: tauriAppPath,
      },
    },
  ],
  logLevel: "info",
  baseUrl: "",
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 60000,
  },
  reporters: ["spec"],

  onPrepare: async function () {
    console.log("Starting tauri-driver...");
    tauriDriver = spawn(tauriDriverPath, [], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    tauriDriver.stdout.on("data", (data) => console.log(`[tauri-driver] ${data}`));
    tauriDriver.stderr.on("data", (data) => console.error(`[tauri-driver] ${data}`));
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log("tauri-driver started on port 4444");
  },

  onComplete: async function () {
    if (tauriDriver) {
      console.log("Stopping tauri-driver...");
      tauriDriver.kill();
    }
  },
};
