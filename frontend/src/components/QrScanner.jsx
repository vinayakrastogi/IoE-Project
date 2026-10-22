import { Html5Qrcode } from "html5-qrcode";
import { Camera, CameraOff, ScanLine } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { gateApi } from "../api/endpoints";

const SAME_CODE_COOLDOWN_MS = 12000;

/**
 * Camera + manual QR entry, shared between the Gate Terminal page and the
 * Monitor dashboard's 3D scanner overlay. This component owns the camera
 * lifecycle and the raw scan/submit plumbing; it does NOT keep its own
 * activity log or drive any 3D state -- callers get every attempt via
 * `onResult` and can do whatever they need with it (render a log, trigger an
 * animation, both).
 */
export default function QrScanner({ onResult, onBusyChange, compact = false }) {
  const elementId = useId().replace(/:/g, "");
  const [cameraActive, setCameraActive] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [busy, setBusy] = useState(false);
  const scannerRef = useRef(null);
  const processingRef = useRef(false);
  const lastCameraScanRef = useRef({ token: null, at: 0 });

  useEffect(() => {
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setBusyState = (value) => {
    setBusy(value);
    onBusyChange?.(value);
  };

  const submitToken = async (token) => {
    if (!token || processingRef.current) return;
    processingRef.current = true;
    setBusyState(true);
    try {
      const response = await gateApi.scan(token);
      onResult?.({
        ok: true,
        message: `${response.message} (${response.action}, slot ${response.slot_label})`,
        timestamp: response.timestamp,
        response,
      });
    } catch (err) {
      onResult?.({
        ok: false,
        message: err.response?.data?.detail || "Scan rejected",
        timestamp: new Date().toISOString(),
      });
    } finally {
      setBusyState(false);
      setTimeout(() => {
        processingRef.current = false;
      }, 1500);
    }
  };

  const startCamera = async () => {
    try {
      const scanner = new Html5Qrcode(elementId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: compact ? 160 : 220 },
        (decodedText) => {
          // The camera re-reads a QR that stays in view many times a second;
          // without this, the same code would be scanned again a moment
          // later and toggle entry into exit. Same code = ignored for a while.
          const now = Date.now();
          const last = lastCameraScanRef.current;
          if (decodedText === last.token && now - last.at < SAME_CODE_COOLDOWN_MS) return;
          lastCameraScanRef.current = { token: decodedText, at: now };
          submitToken(decodedText);
        },
        () => {}
      );
      setCameraActive(true);
    } catch (err) {
      onResult?.({
        ok: false,
        message: `Camera unavailable: ${err}`,
        timestamp: new Date().toISOString(),
      });
    }
  };

  const stopCamera = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
      } catch {
        // already stopped
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    submitToken(manualToken.trim());
    setManualToken("");
  };

  return (
    <div className="flex flex-col gap-3">
      <div className={compact ? "bg-surface2 rounded-lg p-3" : "bg-surface rounded-xl border border-line p-6"}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={compact ? "text-sm font-semibold text-ink" : "font-semibold text-ink"}>
            Camera Scan
          </h2>
          <button
            onClick={cameraActive ? stopCamera : startCamera}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
              cameraActive
                ? "bg-red-500/10 text-red-300 hover:bg-red-500/20"
                : "bg-accent text-bg hover:bg-sky-400"
            }`}
          >
            {cameraActive ? <CameraOff size={14} /> : <Camera size={14} />}
            {cameraActive ? "Stop Camera" : "Start Camera"}
          </button>
        </div>
        <div
          id={elementId}
          className={`rounded-lg overflow-hidden bg-bg border border-line ${compact ? "min-h-[140px]" : "min-h-[200px]"}`}
        />
      </div>

      <form
        onSubmit={handleManualSubmit}
        className={compact ? "bg-surface2 rounded-lg p-3" : "bg-surface rounded-xl border border-line p-6"}
      >
        <h2 className={compact ? "text-sm font-semibold text-ink mb-2" : "font-semibold text-ink mb-3"}>
          Manual / Pasted Token
        </h2>
        <div className="flex gap-2">
          <input
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            placeholder="Paste qr_token here"
            className="flex-1 bg-bg border border-line rounded-md px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/60"
          />
          <button
            type="submit"
            disabled={busy || !manualToken.trim()}
            className="inline-flex items-center gap-1.5 bg-accent hover:bg-sky-400 disabled:opacity-50 text-bg px-4 rounded-md text-sm font-semibold transition-colors"
          >
            <ScanLine size={14} />
            Scan
          </button>
        </div>
      </form>
    </div>
  );
}
