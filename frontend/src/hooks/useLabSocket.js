import { useCallback, useEffect, useRef, useState } from "react";

import { LAB_WS_URL } from "../api/client";

const MAX_SERIAL_LINES = 120;

/**
 * Live feed from the hardware lab: the state of every emulated node
 * (pins, LEDs, servo angle, LCD text...), the physical world around them, and
 * the UART traffic between the Arduinos and the Raspberry Pi gateway.
 */
export function useLabSocket() {
  const [state, setState] = useState(null);
  const [serial, setSerial] = useState({});
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;

    function connect() {
      const ws = new WebSocket(LAB_WS_URL);
      socketRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === "state") {
          setState(message);
        } else if (message.type === "hello") {
          setState(message.state);
          setSerial(message.history ?? {});
        } else if (message.type === "serial") {
          const { type, ...entry } = message;
          setSerial((prev) => ({
            ...prev,
            [entry.node]: [...(prev[entry.node] ?? []), entry].slice(-MAX_SERIAL_LINES),
          }));
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) retryTimer = setTimeout(connect, 2500);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      socketRef.current?.close();
    };
  }, []);

  const send = useCallback((message) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }, []);

  return { state, serial, connected, send };
}
