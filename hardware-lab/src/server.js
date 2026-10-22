// ParkGrid hardware lab: boots six emulated Arduino Unos (five zone
// controllers + the gate controller) from the compiled firmware, pairs them
// with a physics-lite world model, exposes every node's UART as a TCP port for
// the Raspberry Pi gateway, and streams node state to the dashboard over
// WebSocket. The gateway (not this process) is what talks MQTT to the backend;
// the only MQTT subscription here belongs to the world model, which needs to
// know when a gate opened so a virtual car can drive in.

import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import mqtt from "mqtt";
import { WebSocketServer } from "ws";

import { GateNode, ZoneNode } from "./nodes.js";
import { UartBridge } from "./uart-bridge.js";
import { TOTAL_SLOTS, World } from "./world.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const config = {
  httpPort: Number(process.env.HTTP_PORT ?? 8090),
  zoneUartBase: Number(process.env.UART_BASE_PORT ?? 7001),
  gateUartPort: Number(process.env.GATE_UART_PORT ?? 7010),
  firmwareDir: process.env.FIRMWARE_DIR ?? path.resolve(here, "../../firmware"),
  mqttUrl: process.env.MQTT_URL ?? "mqtt://localhost:1883",
  zones: Number(process.env.ZONES ?? 5),
};

const FIRMWARE_SOURCES = {
  "zone_node.ino": "zone_node/zone_node.ino",
  "gate_node.ino": "gate_node/gate_node.ino",
};

const log = {
  info: (...args) => console.log(new Date().toISOString(), ...args),
  warn: (...args) => console.warn(new Date().toISOString(), ...args),
};

// ---- world + nodes --------------------------------------------------------
const world = new World();
const nodes = [];
const bridges = [];
const serialHistory = new Map(); // node id -> last lines, so a fresh dashboard tab isn't empty
const SERIAL_HISTORY = 80;

function addNode(node, uartPort) {
  const hexName = node.hexPath;
  if (!existsSync(hexName)) {
    log.warn(`[lab] ${node.id}: ${hexName} not found -- run firmware/build.sh. Node stays off.`);
    return;
  }
  try {
    node.boot();
  } catch (error) {
    log.warn(`[lab] ${node.id}: failed to boot: ${error.message}`);
    return;
  }
  serialHistory.set(node.id, []);
  node.on("serial", (event) => {
    const entry = { t: Date.now(), node: node.id, ...event };
    const history = serialHistory.get(node.id);
    history.push(entry);
    if (history.length > SERIAL_HISTORY) history.shift();
    broadcast({ type: "serial", ...entry });
  });
  nodes.push(node);
  bridges.push(new UartBridge(node, uartPort, log));
}

for (let zone = 0; zone < config.zones; zone++) {
  const letter = String.fromCharCode(97 + zone);
  addNode(
    new ZoneNode({ zone, world, hexPath: path.join(config.firmwareDir, "build", `zone_${letter}.hex`) }),
    config.zoneUartBase + zone,
  );
}
addNode(new GateNode({ world, hexPath: path.join(config.firmwareDir, "build", "gate.hex") }), config.gateUartPort);

// ---- main emulation loop ------------------------------------------------------
setInterval(() => {
  const now = performance.now();
  for (const node of nodes) node.step(now);
}, 4);

// ---- MQTT: only for the world model -------------------------------------------
let mqttClient = null;
function connectMqtt() {
  mqttClient = mqtt.connect(config.mqttUrl, {
    clientId: `parkgrid-lab-world-${process.pid}`,
    reconnectPeriod: 2000,
  });
  mqttClient.on("connect", () => {
    log.info(`[mqtt] world model connected to ${config.mqttUrl}`);
    mqttClient.subscribe(["parking/gate/command", "parking/admin/slot_cleared"], { qos: 1 });
  });
  mqttClient.on("error", (error) => log.warn(`[mqtt] ${error.message}`));
  mqttClient.on("message", (topic, payload) => {
    let message;
    try {
      message = JSON.parse(payload.toString());
    } catch {
      return;
    }
    if (topic === "parking/gate/command") world.handleGateCommand(message);
    else if (topic === "parking/admin/slot_cleared") world.handleSlotCleared(Number(message.slot_index));
  });
}
connectMqtt();

// ---- HTTP + WebSocket ----------------------------------------------------------
function buildState() {
  return {
    type: "state",
    t: Date.now(),
    nodes: nodes.map((node) => node.state()),
    world: world.state(),
    mqtt: { connected: Boolean(mqttClient?.connected) },
    uart: bridges.map((bridge) => ({ node: bridge.node.id, port: bridge.port, connected: bridge.connected })),
  };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://lab");
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }
  if (url.pathname === "/health") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", nodes: nodes.length, mqtt: Boolean(mqttClient?.connected) }));
    return;
  }
  if (url.pathname === "/api/state") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify(buildState()));
    return;
  }
  const firmware = url.pathname.match(/^\/firmware\/([\w.]+)$/);
  if (firmware && FIRMWARE_SOURCES[firmware[1]]) {
    const file = path.join(config.firmwareDir, FIRMWARE_SOURCES[firmware[1]]);
    if (existsSync(file)) {
      res.writeHead(200, { ...CORS, "Content-Type": "text/plain; charset=utf-8" });
      res.end(readFileSync(file));
      return;
    }
  }
  res.writeHead(404, CORS).end("not found");
});

const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(message) {
  if (wss.clients.size === 0) return;
  const text = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(text);
  }
}

wss.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "hello",
      totalSlots: TOTAL_SLOTS,
      history: Object.fromEntries(serialHistory),
      state: buildState(),
    }),
  );

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const slot = Number(message.slot);
    switch (message.type) {
      case "park":
        world.parkCar(slot);
        break;
      case "leave":
        world.removeCar(slot);
        break;
      case "distance":
        world.setDistance(slot, message.cm);
        break;
      case "vehicle":
        world.setVehicleWaiting(message.present);
        break;
      case "autoQueue":
        world.setAutoQueue(message.enabled);
        break;
      case "reset":
        nodes.find((node) => node.id === message.node)?.reset();
        break;
      default:
        break;
    }
  });
});

setInterval(() => {
  if (wss.clients.size > 0) broadcast(buildState());
}, 100);

for (const bridge of bridges) {
  await bridge.listen();
}
server.listen(config.httpPort, "0.0.0.0", () => {
  log.info(`[lab] ${nodes.length} node(s) running; dashboard feed on http://0.0.0.0:${config.httpPort} (ws path /ws)`);
  for (const bridge of bridges) log.info(`[lab]   ${bridge.node.id.padEnd(7)} UART on tcp/${bridge.port}`);
});

function shutdown() {
  world.dispose();
  for (const bridge of bridges) bridge.close();
  mqttClient?.end(true);
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
