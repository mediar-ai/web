import { WebSocketServer, WebSocket } from "ws";
import { Socket, connect } from "net";

const port = 3334;

const wss = new WebSocketServer({ port });

console.log(`VNC WebSocket proxy running on ws://localhost:${port}`);

wss.on("connection", (ws: WebSocket, req) => {
  const url = new URL(req.url || "", `http://localhost:${port}`);
  const target = url.searchParams.get("target");

  if (!target) {
    console.error("No target specified");
    ws.close(1008, "No target specified");
    return;
  }

  const [host, portStr] = target.split(":");
  const vncPort = parseInt(portStr || "5900", 10);

  console.log(`Connecting to ${host}:${vncPort}`);

  const tcpSocket: Socket = connect(vncPort, host, () => {
    console.log(`Connected to ${host}:${vncPort}`);
  });

  tcpSocket.on("data", data => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  tcpSocket.on("error", err => {
    console.error(`TCP error: ${err.message}`);
    ws.close(1011, "TCP connection error");
  });

  tcpSocket.on("close", () => {
    console.log("TCP connection closed");
    ws.close();
  });

  ws.on("message", (message: Buffer | ArrayBuffer | Buffer[]) => {
    if (tcpSocket.writable) {
      const data = Buffer.isBuffer(message) ? message : Buffer.from(message as ArrayBuffer);
      tcpSocket.write(data);
    }
  });

  ws.on("close", () => {
    console.log("WebSocket closed");
    tcpSocket.destroy();
  });

  ws.on("error", err => {
    console.error(`WebSocket error: ${err.message}`);
    tcpSocket.destroy();
  });
});
