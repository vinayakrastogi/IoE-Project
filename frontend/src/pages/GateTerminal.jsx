import { useState } from "react";

import QrScanner from "../components/QrScanner";

export default function GateTerminal() {
  const [log, setLog] = useState([]);

  const pushLog = (entry) => setLog((prev) => [entry, ...prev].slice(0, 8));

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-ink">Simulated Gate Terminal</h1>
        <p className="text-sm text-muted mt-1">
          Scan a booking QR with the camera, or paste its token below - just like a real
          camera-and-servo gate, minus the hardware.
        </p>
      </div>

      <QrScanner onResult={pushLog} />

      <div className="bg-surface rounded-xl border border-line p-6 mt-4">
        <h2 className="font-semibold text-ink mb-3">Recent Activity</h2>
        {log.length === 0 && <p className="text-sm text-muted">No scans yet.</p>}
        <ul className="flex flex-col gap-2">
          {log.map((entry, i) => (
            <li
              key={i}
              className={`text-sm rounded-md px-3 py-2 border ${
                entry.ok
                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-900/40"
                  : "bg-red-500/10 text-red-300 border-red-900/40"
              }`}
            >
              <span className="font-mono text-xs text-muted mr-2">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              {entry.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
