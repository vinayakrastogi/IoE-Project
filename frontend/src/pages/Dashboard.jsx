import { useEffect, useState } from "react";

import { bookingsApi, predictionsApi } from "../api/endpoints";
import BookingModal from "../components/BookingModal";
import OccupancyChart from "../components/OccupancyChart";
import PeakAlertBanner from "../components/PeakAlertBanner";
import QRDisplay from "../components/QRDisplay";
import SlotGrid from "../components/SlotGrid";
import { useSlotSocket } from "../hooks/useSlotSocket";

export default function Dashboard() {
  const { slots, total, free, occupied, occupancy_pct: occupancyPct, connected } = useSlotSocket();
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [latestBooking, setLatestBooking] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [predictionError, setPredictionError] = useState(null);

  useEffect(() => {
    const fetchPrediction = () => {
      predictionsApi
        .peak()
        .then(setPrediction)
        .catch((err) => setPredictionError(err.response?.data?.detail || "Prediction unavailable"));
    };
    fetchPrediction();
    const interval = setInterval(fetchPrediction, 60_000);
    return () => clearInterval(interval);
  }, []);

  const handleConfirmBooking = async (payload) => {
    const booking = await bookingsApi.create(payload);
    setLatestBooking(booking);
    setSelectedSlot(null);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 flex flex-col gap-6">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total Slots" value={total} />
          <StatCard label="Free" value={free} accent="text-slot-free" />
          <StatCard label="Occupied" value={occupied} accent="text-slot-occupied" />
        </div>

        {predictionError ? (
          <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
            {predictionError}
          </div>
        ) : (
          <PeakAlertBanner prediction={prediction} />
        )}

        <SlotGrid slots={slots} onSlotClick={setSelectedSlot} connected={connected} />

        <OccupancyChart prediction={prediction} />
      </div>

      <div className="flex flex-col gap-4">
        <div className="bg-surface rounded-xl border border-line p-4">
          <h2 className="font-semibold text-ink mb-1">Book a Slot</h2>
          <p className="text-sm text-muted">
            Click any free slot on the map to reserve it and get a QR code for gate entry.
          </p>
          <p className="text-xs text-muted/80 mt-2">
            Current lot occupancy: <span className="font-semibold text-ink">{occupancyPct}%</span>
          </p>
        </div>

        {latestBooking && (
          <div className="flex flex-col gap-2 animate-fade-in">
            <h3 className="text-sm font-semibold text-ink">Your QR Code</h3>
            <QRDisplay booking={latestBooking} />
          </div>
        )}
      </div>

      {selectedSlot && (
        <BookingModal
          slot={selectedSlot}
          onClose={() => setSelectedSlot(null)}
          onConfirm={handleConfirmBooking}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, accent = "text-ink" }) {
  return (
    <div className="bg-surface rounded-xl border border-line p-4 text-center">
      <p className={`text-2xl font-bold ${accent}`}>{value}</p>
      <p className="text-xs text-muted mt-1">{label}</p>
    </div>
  );
}
