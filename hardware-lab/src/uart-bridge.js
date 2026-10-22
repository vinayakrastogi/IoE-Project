// Exposes each emulated node's UART as a TCP socket -- the stand-in for the
// USB-serial cable between an Arduino and the Raspberry Pi. The gateway opens
// it with pyserial's socket:// URL scheme, so the very same gateway code runs
// against /dev/ttyUSB0 on real hardware.

import net from "node:net";

export class UartBridge {
  constructor(node, port, log = console) {
    this.node = node;
    this.port = port;
    this.log = log;
    this.clients = new Set();

    this.server = net.createServer((socket) => this.#accept(socket));
    this.node.on("tx", (buffer) => {
      for (const client of this.clients) client.write(buffer);
    });
  }

  listen() {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, "0.0.0.0", () => resolve());
    });
  }

  #accept(socket) {
    socket.setNoDelay(true);
    this.clients.add(socket);
    this.log.info(`[uart] ${this.node.id}: gateway connected on :${this.port}`);
    this.node.emit("serial", { dir: "info", line: "-- gateway connected --" });

    socket.on("data", (buffer) => this.node.receive(buffer));
    socket.on("close", () => {
      this.clients.delete(socket);
      this.node.emit("serial", { dir: "info", line: "-- gateway disconnected --" });
    });
    socket.on("error", () => socket.destroy());
  }

  get connected() {
    return this.clients.size > 0;
  }

  close() {
    for (const client of this.clients) client.destroy();
    this.server.close();
  }
}
