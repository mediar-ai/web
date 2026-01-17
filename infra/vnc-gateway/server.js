// VNC Gateway - Direct TCP-to-WebSocket proxy
// Routes /vnc/{vm-key} directly to VM's VNC port (5900) - no websockify needed on VM

const http = require("http");
const net = require("net");
const { WebSocketServer } = require("ws");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 8080;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const VNC_PORT = 5900;

// Cache VM IPs for 30 seconds
const vmCache = new Map();
const CACHE_TTL = 30000;

// Throttle activity updates per VM (max once per 30 seconds)
const activityThrottle = new Map();
const ACTIVITY_THROTTLE_MS = 30000;

async function reportActivity(vmKey) {
  const now = Date.now();
  const lastReport = activityThrottle.get(vmKey) || 0;

  if (now - lastReport < ACTIVITY_THROTTLE_MS) {
    return { throttled: true };
  }

  activityThrottle.set(vmKey, now);

  try {
    // Update updated_at for the machine with this terraform key
    const url = `${SUPABASE_URL}/rest/v1/remote_machines?tags=cs.{terraform:${vmKey}}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ updated_at: new Date().toISOString() }),
    });

    if (!res.ok) {
      console.error(`Failed to update activity for ${vmKey}: ${res.status}`);
      return { success: false, error: `HTTP ${res.status}` };
    }

    console.log(`Activity reported for ${vmKey}`);
    return { success: true };
  } catch (err) {
    console.error(`Error reporting activity for ${vmKey}:`, err.message);
    return { success: false, error: err.message };
  }
}

async function getVmIp(vmKey) {
  const cached = vmCache.get(vmKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.ip;
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/remote_machines?select=mcp_endpoint&tags=cs.{terraform:${vmKey}}`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

    const data = await res.json();
    if (!data || data.length === 0) {
      console.error(`VM not found: ${vmKey}`);
      return null;
    }

    const endpoint = data[0].mcp_endpoint;
    const match = endpoint.match(/http:\/\/([^:]+):/);
    if (!match) {
      console.error(`Invalid endpoint format: ${endpoint}`);
      return null;
    }

    const ip = match[1];
    vmCache.set(vmKey, { ip, timestamp: Date.now() });
    console.log(`Resolved ${vmKey} -> ${ip}`);
    return ip;
  } catch (err) {
    console.error(`Failed to lookup VM ${vmKey}:`, err.message);
    return null;
  }
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "healthy" }));
    return;
  }

  // Activity reporting endpoint
  const activityMatch = req.url.match(/^\/api\/activity\/([^\/\?]+)/);
  if (activityMatch && req.method === "POST") {
    const vmKey = activityMatch[1];
    const result = await reportActivity(vmKey);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(result));
    return;
  }

  // CORS preflight for activity endpoint
  if (req.url.startsWith("/api/activity/") && req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // Serve noVNC static files
  if (req.url.startsWith("/novnc/")) {
    const filePath = path.join(
      __dirname,
      "novnc",
      req.url.replace("/novnc/", ""),
    );
    const ext = path.extname(filePath);
    const contentTypes = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    };

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain" });
      res.end(data);
    });
    return;
  }

  // VNC viewer page
  const vncMatch = req.url.match(/^\/vnc\/([^\/\?]+)/);
  if (vncMatch && req.headers.upgrade !== "websocket") {
    const vmKey = vncMatch[1];
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <title>VNC - ${vmKey}</title>
  <style>
    body { margin: 0; background: #000; overflow: hidden; }
    #screen { width: 100vw; height: calc(100vh - 40px); }
    #toolbar {
      height: 40px;
      background: #1a1a1a;
      display: flex;
      align-items: center;
      padding: 0 10px;
      gap: 10px;
    }
    .btn {
      background: #333;
      color: #fff;
      border: 1px solid #555;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .btn:hover { background: #444; }
    #status { color: #888; font-size: 11px; margin-left: auto; }
  </style>
</head>
<body>
  <div id="toolbar">
    <button class="btn" id="pasteBtn">Paste to VM</button>
    <button class="btn" id="copyBtn">Copy from VM</button>
    <button class="btn" id="ctrlAltDel">Ctrl+Alt+Del</button>
    <span id="status">Connecting...</span>
  </div>
  <div id="screen"></div>
  <script type="module">
    import RFB from '/novnc/core/rfb.js';

    const wsUrl = 'wss://' + location.host + '/vnc/${vmKey}/websocket';
    const rfb = new RFB(document.getElementById('screen'), wsUrl, {
      credentials: { password: '${process.env.VNC_PASSWORD || ""}' }
    });
    rfb.viewOnly = false;
    rfb.scaleViewport = true;
    rfb.resizeSession = false;

    // Optimize for low latency over internet
    rfb.qualityLevel = 4;      // 0-9: lower = faster but uglier (4 for speed)
    rfb.compressionLevel = 7;  // 0-9: higher = less bandwidth (7 for internet connections)
    rfb.showDotCursor = true;  // Show cursor position immediately

    const status = document.getElementById('status');
    rfb.addEventListener('connect', () => { status.textContent = 'Connected'; status.style.color = '#4f4'; });
    rfb.addEventListener('disconnect', () => { status.textContent = 'Disconnected'; status.style.color = '#f44'; });

    let vmClipboard = '';
    rfb.addEventListener('clipboard', (e) => { vmClipboard = e.detail.text; });

    document.getElementById('pasteBtn').onclick = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) rfb.clipboardPasteFrom(text);
      } catch (err) { console.error(err); }
    };

    document.getElementById('copyBtn').onclick = async () => {
      try {
        if (vmClipboard) await navigator.clipboard.writeText(vmClipboard);
      } catch (err) { console.error(err); }
    };

    document.getElementById('ctrlAltDel').onclick = () => rfb.sendCtrlAltDel();

    // Activity tracking - report user input to keep VM active
    const vmKey = '${vmKey}';
    let lastActivityReport = 0;
    const ACTIVITY_THROTTLE = 30000; // 30 seconds

    function reportActivity() {
      const now = Date.now();
      if (now - lastActivityReport < ACTIVITY_THROTTLE) return;
      lastActivityReport = now;

      fetch('/api/activity/' + vmKey, { method: 'POST' })
        .then(r => r.json())
        .then(data => {
          if (data.success) console.log('Activity reported');
        })
        .catch(() => {}); // Silently ignore errors
    }

    // Report on user input events
    const screen = document.getElementById('screen');
    screen.addEventListener('mousedown', reportActivity);
    screen.addEventListener('keydown', reportActivity);
    screen.addEventListener('mousemove', () => {
      // Only report mousemove occasionally (in addition to throttle)
      if (Math.random() < 0.1) reportActivity();
    });

    // Also report on connect (user opened VNC = activity)
    rfb.addEventListener('connect', reportActivity);
  </script>
</body>
</html>`);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// WebSocket server - bridges WebSocket to raw TCP (VNC)
const wss = new WebSocketServer({
  noServer: true,
  // Enable per-message compression for lower bandwidth
  perMessageDeflate: {
    zlibDeflateOptions: { level: 6 },
    threshold: 1024,  // Only compress messages >1KB
    concurrencyLimit: 10,
  }
});

server.on("upgrade", async (req, socket, head) => {
  const match = req.url.match(/^\/vnc\/([^\/]+)\/websocket/);
  if (!match) {
    socket.destroy();
    return;
  }

  const vmKey = match[1];
  const vmIp = await getVmIp(vmKey);

  if (!vmIp) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  console.log(`Connecting ${vmKey} to ${vmIp}:${VNC_PORT}`);

  // Connect directly to VNC port via TCP
  const vncSocket = net.createConnection({ host: vmIp, port: VNC_PORT }, () => {
    console.log(`TCP connected to ${vmIp}:${VNC_PORT}`);

    // Disable Nagle's algorithm for lower latency (removes 40-200ms delay)
    vncSocket.setNoDelay(true);

    wss.handleUpgrade(req, socket, head, (ws) => {
      console.log(`WebSocket upgraded for ${vmKey}`);

      // Clear the connection timeout since we connected successfully
      vncSocket.setTimeout(0);

      // WebSocket keepalive ping every 25 seconds to prevent proxy/Cloud Run idle timeouts
      // Cloud Run default timeout is 5 min, but proxies may drop earlier
      let isAlive = true;
      const pingInterval = setInterval(() => {
        if (!isAlive) {
          console.log(`WebSocket ping timeout for ${vmKey}, terminating`);
          ws.terminate();
          return;
        }
        isAlive = false;
        ws.ping();
      }, 25000);

      ws.on('pong', () => {
        isAlive = true;
      });

      // VNC -> WebSocket (binary)
      vncSocket.on("data", (data) => {
        if (ws.readyState === 1) {
          // OPEN - send as binary
          ws.send(data, { binary: true });
        }
      });

      // WebSocket -> VNC
      ws.on("message", (data, isBinary) => {
        if (!vncSocket.destroyed) {
          // Ensure we write as Buffer
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          vncSocket.write(buf);
        }
      });

      ws.on("close", () => {
        console.log(`WebSocket closed for ${vmKey}`);
        clearInterval(pingInterval);
        vncSocket.destroy();
      });

      vncSocket.on("close", () => {
        console.log(`VNC connection closed for ${vmKey}`);
        clearInterval(pingInterval);
        ws.close();
      });

      ws.on("error", (err) => {
        console.error("WS error:", err.message);
        clearInterval(pingInterval);
      });
      vncSocket.on("error", (err) => console.error("VNC error:", err.message));
    });
  });

  vncSocket.on("error", (err) => {
    console.error(`Failed to connect to ${vmIp}:${VNC_PORT}:`, err.message);
    socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    socket.destroy();
  });

  // Timeout for connection
  vncSocket.setTimeout(10000, () => {
    console.error(`Connection timeout to ${vmIp}:${VNC_PORT}`);
    vncSocket.destroy();
    socket.write("HTTP/1.1 504 Gateway Timeout\r\n\r\n");
    socket.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`VNC Gateway listening on port ${PORT}`);
  console.log(
    `Connecting directly to VNC port ${VNC_PORT} (no websockify needed)`,
  );
});
