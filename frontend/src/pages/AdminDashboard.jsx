import { LockKeyhole, RotateCcw, ShieldAlert, Unlock } from "lucide-react";
import { useEffect, useState } from "react";

import { adminApi, adminAuth } from "../api/endpoints";

const STATUS_STYLES = {
  free: "bg-emerald-500/10 border-emerald-500/40 text-emerald-300",
  booked: "bg-yellow-400/15 border-yellow-400/60 text-yellow-300",
  occupied: "bg-red-500/10 border-red-500/40 text-red-300",
};

function TokenGate({ onUnlocked }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setChecking(true);
    adminAuth.setToken(token.trim());
    try {
      await adminApi.listSlots();
      onUnlocked();
    } catch (err) {
      adminAuth.clearToken();
      setError(err.response?.status === 403 ? "Incorrect admin token" : "Could not reach the backend");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="bg-surface rounded-xl border border-line p-8 w-full max-w-sm">
        <div className="flex items-center gap-2 mb-1">
          <LockKeyhole size={20} className="text-accent" />
          <h1 className="text-xl font-bold text-ink">Admin Access</h1>
        </div>
        <p className="text-sm text-muted mb-6">
          Enter the admin token (<code className="text-ink/80">ADMIN_TOKEN</code> in the backend's
          environment) to manage slots.
        </p>

        <input
          type="password"
          required
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Admin token"
          className="w-full bg-bg border border-line rounded-md px-3 py-2 text-sm mb-4 text-ink focus:outline-none focus:ring-2 focus:ring-accent/60"
        />

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

        <button
          type="submit"
          disabled={checking || !token.trim()}
          className="w-full inline-flex items-center justify-center gap-2 bg-accent hover:bg-sky-400 disabled:opacity-50 text-bg rounded-md py-2 text-sm font-semibold transition-colors"
        >
          <Unlock size={15} />
          {checking ? "Checking..." : "Unlock"}
        </button>
      </form>
    </div>
  );
}

function SlotAdminCard({ slot, onFree, busy }) {
  return (
    <div className={`rounded-lg border p-3 flex flex-col gap-2 ${STATUS_STYLES[slot.status]}`}>
      <div className="flex items-center justify-between">
        <span className="font-bold text-ink">{slot.label}</span>
        <span className="text-[10px] uppercase tracking-wide opacity-80">{slot.status}</span>
      </div>
      <div className="text-xs text-ink/70 min-h-[2rem]">
        {slot.occupant_name ? (
          <>
            <div>{slot.occupant_name}</div>
            <div className="opacity-70">
              booking #{slot.booking_id} - {slot.booking_status}
            </div>
          </>
        ) : (
          <span className="opacity-50">empty</span>
        )}
      </div>
      <button
        onClick={() => onFree(slot.id)}
        disabled={slot.status === "free" || busy}
        className="text-xs font-medium bg-surface2 hover:bg-line disabled:opacity-30 disabled:cursor-not-allowed text-ink rounded-md py-1.5 transition-colors"
      >
        Free slot
      </button>
    </div>
  );
}

function AdminPanel({ onLocked }) {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busySlotId, setBusySlotId] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const refresh = async () => {
    try {
      const data = await adminApi.listSlots();
      setSlots(data);
      setError(null);
    } catch (err) {
      if (err.response?.status === 403) {
        adminAuth.clearToken();
        onLocked();
        return;
      }
      setError(err.response?.data?.detail || "Failed to load slots");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleFree = async (slotId) => {
    setBusySlotId(slotId);
    setMessage(null);
    try {
      const result = await adminApi.freeSlot(slotId);
      setMessage(result.freed ? `Slot ${result.slot_label} freed.` : `Slot ${result.slot_label} was already free.`);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to free slot");
    } finally {
      setBusySlotId(null);
    }
  };

  const handleFreeAll = async () => {
    setResetting(true);
    setMessage(null);
    try {
      const result = await adminApi.freeAll();
      setMessage(`Reset complete - ${result.freed_count} slot(s) freed.`);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to reset slots");
    } finally {
      setResetting(false);
    }
  };

  const occupiedCount = slots.filter((s) => s.status !== "free").length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <ShieldAlert size={22} className="text-accent" />
          <div>
            <h1 className="text-xl font-bold text-ink">Admin Control</h1>
            <p className="text-sm text-muted">
              Manually free slots for a smooth demo - {occupiedCount} slot(s) currently not free.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleFreeAll}
            disabled={resetting || occupiedCount === 0}
            className="inline-flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 text-red-300 border border-red-900/40 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          >
            <RotateCcw size={14} />
            {resetting ? "Resetting..." : "Free All Slots"}
          </button>
          <button
            onClick={() => {
              adminAuth.clearToken();
              window.location.reload();
            }}
            className="text-xs text-muted hover:text-ink transition-colors"
          >
            Lock
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-4 text-sm rounded-lg px-3 py-2 border bg-emerald-500/10 text-emerald-300 border-emerald-900/40 animate-fade-in">
          {message}
        </div>
      )}
      {error && (
        <div className="mb-4 text-sm rounded-lg px-3 py-2 border bg-red-500/10 text-red-300 border-red-900/40 animate-fade-in">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading...</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
          {slots.map((slot) => (
            <SlotAdminCard key={slot.id} slot={slot} onFree={handleFree} busy={busySlotId === slot.id} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const [unlocked, setUnlocked] = useState(() => Boolean(adminAuth.getToken()));

  if (!unlocked) {
    return <TokenGate onUnlocked={() => setUnlocked(true)} />;
  }
  return <AdminPanel onLocked={() => setUnlocked(false)} />;
}
