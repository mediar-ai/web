import { spawn } from "child_process";

function startProxy() {
  console.log("[vnc-proxy-loop] Starting VNC proxy...");

  const proc = spawn("bun", ["vnc-proxy.ts"], {
    stdio: "inherit",
    cwd: process.cwd(),
    shell: true,
  });

  proc.on("exit", code => {
    console.log(`[vnc-proxy-loop] VNC proxy exited with code ${code}, restarting in 2s...`);
    setTimeout(startProxy, 2000);
  });

  proc.on("error", err => {
    console.error("[vnc-proxy-loop] Failed to start VNC proxy:", err);
    setTimeout(startProxy, 2000);
  });
}

startProxy();
