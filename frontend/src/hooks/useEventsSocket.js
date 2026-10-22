import { useEffect, useRef, useState } from "react";

import { EVENTS_WS_URL } from "../api/client";
import { eventsApi } from "../api/endpoints";

const MAX_EVENTS = 100;

// Events are kept in ascending chronological order (oldest first, newest
// last) throughout -- LogsFeed renders them top-to-bottom like a console and
// auto-scrolls to the bottom as new ones arrive.
export function useEventsSocket() {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const retryRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    eventsApi
      .recent(50)
      .then((data) => {
        if (!cancelled) setEvents([...data].reverse());
      })
      .catch(() => {});

    function connect() {
      const ws = new WebSocket(EVENTS_WS_URL);
      socketRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "event_backlog") {
            setEvents(data.events);
          } else if (data.type === "event") {
            const { type, ...entry } = data;
            setEvents((prev) => [...prev, entry].slice(-MAX_EVENTS));
          }
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

  return { events, connected };
}
