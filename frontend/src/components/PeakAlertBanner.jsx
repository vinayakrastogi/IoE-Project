import { AlertTriangle, ShieldCheck } from "lucide-react";

export default function PeakAlertBanner({ prediction }) {
  if (!prediction) return null;

  const breachingSoon = Boolean(prediction.next_threshold_breach);
  const breachTime = prediction.next_threshold_breach
    ? new Date(prediction.next_threshold_breach).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  if (!breachingSoon) {
    return (
      <div className="rounded-xl border border-emerald-900/50 bg-emerald-500/10 text-emerald-300 px-4 py-3 flex items-center gap-3">
        <ShieldCheck size={20} className="shrink-0 text-emerald-400" />
        <div>
          <p className="font-semibold text-sm text-emerald-200">No congestion predicted</p>
          <p className="text-xs text-emerald-300/80">
            Peak forecast is {prediction.peak_occupancy_pct}% around{" "}
            {String(prediction.peak_hour).padStart(2, "0")}:00 - below the{" "}
            {prediction.threshold_pct}% alert threshold.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-900/50 bg-amber-500/10 text-amber-200 px-4 py-3 flex items-center gap-3 animate-pulse-slow">
      <AlertTriangle size={20} className="shrink-0 text-amber-400" />
      <div>
        <p className="font-semibold text-sm text-amber-100">
          Peak occupancy alert - expected to hit {prediction.threshold_pct}% by {breachTime}
        </p>
        <p className="text-xs text-amber-300/80">
          Predicted peak: {prediction.peak_occupancy_pct}% around{" "}
          {String(prediction.peak_hour).padStart(2, "0")}:00. Consider arriving early or booking
          ahead.
        </p>
      </div>
    </div>
  );
}
