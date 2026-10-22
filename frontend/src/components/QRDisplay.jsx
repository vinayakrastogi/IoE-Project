import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";

import { gateApi } from "../api/endpoints";

export default function QRDisplay({ booking, showSimulateScan = true }) {
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [scanning, setScanning] = useState(false);

  const handleSimulateScan = async () => {
    setScanning(true);
    setScanError(null);
    try {
      const result = await gateApi.scan(booking.qr_token);
      setScanResult(result);
    } catch (err) {
      setScanError(err.response?.data?.detail || "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="bg-surface rounded-xl border border-line p-5 flex flex-col items-center gap-3">
      <div className="bg-white p-3 rounded-lg">
        <QRCodeSVG value={booking.qr_token} size={168} />
      </div>
      <div className="text-center">
        <p className="font-semibold text-ink">Slot {booking.slot.label}</p>
        <p className="text-xs text-muted">
          {new Date(booking.start_time).toLocaleString()} &rarr;{" "}
          {new Date(booking.end_time).toLocaleString()}
        </p>
        <p className="text-xs text-muted/70 mt-1">Booking #{booking.id}</p>
      </div>

      {showSimulateScan && (
        <div className="w-full pt-3 border-t border-line">
          <p className="text-[11px] text-muted mb-2 text-center">
            No physical scanner? Simulate the gate camera reading this code:
          </p>
          <button
            onClick={handleSimulateScan}
            disabled={scanning}
            className="w-full bg-accent hover:bg-sky-400 disabled:opacity-50 text-bg text-sm font-semibold py-2 rounded-lg transition-colors"
          >
            {scanning ? "Scanning..." : "Simulate Gate Scan"}
          </button>
          {scanResult && (
            <p className="mt-2 text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-900/40 rounded-md p-2 text-center">
              {scanResult.message} ({scanResult.action})
            </p>
          )}
          {scanError && (
            <p className="mt-2 text-sm text-red-300 bg-red-500/10 border border-red-900/40 rounded-md p-2 text-center">
              {scanError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
