import { useEffect, useRef, useState } from "react";

import { WS_URL } from "../api/client";
import { slotsApi } from "../api/endpoints";

const emptySnapshot = {
  total: 0,
  free: 0,
  booked: 0,
  occupied: 0,
  occupancy_pct: 0,
  slots: [],
};

export function useSlotSocket() {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const retryRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    slotsApi
      .live()
      .then((data) => {
        if (!cancelled) setSnapshot(data);
      })
      .catch(() => {});

    function connect() {
      const ws = new WebSocket(WS_URL);
      socketRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "slot_update") setSnapshot(data);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) retryRef.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryRef.current);
      socketRef.current?.close();
    };
  }, []);

  return { ...snapshot, connected };
}
