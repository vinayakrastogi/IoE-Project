import { useEffect, useState } from "react";

import { bookingsApi } from "../api/endpoints";

const STATUS_BADGE = {
  pending: "bg-amber-500/10 text-amber-300 border border-amber-900/40",
  active: "bg-sky-500/10 text-sky-300 border border-sky-900/40",
  completed: "bg-surface2 text-muted border border-line",
  cancelled: "bg-surface2 text-muted/60 border border-line",
  expired: "bg-red-500/10 text-red-300 border border-red-900/40",
};

export default function BookingHistory() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    bookingsApi
      .mine()
      .then(setBookings)
      .catch((err) => setError(err.response?.data?.detail || "Failed to load bookings"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-ink mb-4">Booking History</h1>

      {loading && <p className="text-sm text-muted">Loading...</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && !error && bookings.length === 0 && (
        <p className="text-sm text-muted">No bookings yet. Head to the dashboard to reserve a slot.</p>
      )}

      <div className="flex flex-col gap-3">
        {bookings.map((booking) => (
          <div
            key={booking.id}
            className="bg-surface rounded-xl border border-line p-4 flex items-center justify-between"
          >
            <div>
              <p className="font-semibold text-ink">
                Slot {booking.slot.label} - {booking.slot.location}
              </p>
              <p className="text-xs text-muted mt-0.5">
                {new Date(booking.start_time).toLocaleString()} &rarr;{" "}
                {new Date(booking.end_time).toLocaleString()}
              </p>
              <p className="text-xs text-muted/70 mt-0.5">Booking #{booking.id}</p>
            </div>
            <span
              className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${STATUS_BADGE[booking.status]}`}
            >
              {booking.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
