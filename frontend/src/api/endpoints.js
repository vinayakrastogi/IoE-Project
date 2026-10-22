import client from "./client";

export const authApi = {
  signup: (payload) => client.post("/auth/signup", payload).then((r) => r.data),
  login: (email, password) => {
    const form = new URLSearchParams();
    form.append("username", email);
    form.append("password", password);
    return client
      .post("/auth/login", form, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      })
      .then((r) => r.data);
  },
  me: () => client.get("/auth/me").then((r) => r.data),
};

export const slotsApi = {
  list: () => client.get("/slots").then((r) => r.data),
  live: () => client.get("/slots/live").then((r) => r.data),
};

export const bookingsApi = {
  create: (payload) => client.post("/bookings", payload).then((r) => r.data),
  createGuest: (payload) => client.post("/bookings/guest", payload).then((r) => r.data),
  mine: () => client.get("/bookings/me").then((r) => r.data),
};

export const gateApi = {
  scan: (qrToken) => client.post("/gate/scan", { qr_token: qrToken }).then((r) => r.data),
};

export const predictionsApi = {
  peak: (hoursAhead = 24) =>
    client.get("/predictions/peak", { params: { hours_ahead: hoursAhead } }).then((r) => r.data),
};

export const eventsApi = {
  recent: (limit = 50) => client.get("/events/recent", { params: { limit } }).then((r) => r.data),
};

const ADMIN_TOKEN_KEY = "admin_token";

export const adminAuth = {
  getToken: () => localStorage.getItem(ADMIN_TOKEN_KEY) || "",
  setToken: (token) => localStorage.setItem(ADMIN_TOKEN_KEY, token),
  clearToken: () => localStorage.removeItem(ADMIN_TOKEN_KEY),
};

function adminHeaders() {
  return { headers: { "X-Admin-Token": adminAuth.getToken() } };
}

export const adminApi = {
  listSlots: () => client.get("/admin/slots", adminHeaders()).then((r) => r.data),
  freeSlot: (slotId) => client.post(`/admin/slots/${slotId}/free`, {}, adminHeaders()).then((r) => r.data),
  freeAll: () => client.post("/admin/slots/reset-all", {}, adminHeaders()).then((r) => r.data),
};
