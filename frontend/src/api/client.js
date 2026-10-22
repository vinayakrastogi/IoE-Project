import axios from "axios";

// Backend is assumed to be reachable on the same host the frontend was
// loaded from, on port 8000 - this is what makes "open this on my phone on
// the same WiFi" work with zero config: visiting http://<lan-ip>:5173 makes
// this resolve to http://<lan-ip>:8000 automatically, no hardcoded
// "localhost" (which would mean "the phone itself" and always fail).
// VITE_API_URL still overrides this when the backend genuinely lives
// somewhere else.
const inferredApiUrl = `${window.location.protocol}//${window.location.hostname}:8000`;

export const API_URL = import.meta.env.VITE_API_URL || inferredApiUrl;
export const WS_URL = API_URL.replace(/^http/, "ws") + "/ws/slots";
export const EVENTS_WS_URL = API_URL.replace(/^http/, "ws") + "/ws/events";

// The hardware lab (emulated Arduino nodes) lives on port 8090 of the same host.
const inferredLabUrl = `${window.location.protocol}//${window.location.hostname}:8090`;
export const LAB_URL = import.meta.env.VITE_LAB_URL || inferredLabUrl;
export const LAB_WS_URL = LAB_URL.replace(/^http/, "ws") + "/ws";

const client = axios.create({ baseURL: API_URL });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default client;
