import { Boxes, Terminal } from "lucide-react";
import { useState } from "react";

import LogsFeed from "../components/LogsFeed";
import QrScanner from "../components/QrScanner";
import { useCarAnimation } from "../hooks/useCarAnimation";
import { useSlotSocket } from "../hooks/useSlotSocket";
import ParkingScene from "../three/ParkingScene";

const GATE_OPEN_LEAD_MS = 500;

function TabButton({ active, icon: Icon, children, ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active ? "bg-surface2 text-ink shadow-glow" : "text-muted hover:text-ink"
      }`}
    >
      <Icon size={15} />
      {children}
    </button>
  );
}

export default function MonitorDashboard() {
  const { slots, total, free, occupied, connected } = useSlotSocket();
  const [tab, setTab] = useState("3d");
  const [gateOpen, setGateOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [animatingCar, runCarJob] = useCarAnimation();

  const handleScanResult = (entry) => {
    setLastResult(entry);
    if (entry.ok && entry.response) {
      const { slot_index, action } = entry.response;
      setGateOpen(true);
      window.setTimeout(() => {
        runCarJob(slot_index, action, {
          onComplete: () => setGateOpen(false),
        });
      }, GATE_OPEN_LEAD_MS);
    }
    window.setTimeout(() => {
      setLastResult((current) => (current === entry ? null : current));
    }, 6000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-ink">Monitor - Control Room</h1>
          <p className="text-sm text-muted">
            Live 3D view of the simulated hardware and the software reacting to it - {occupied}/{total} occupied,{" "}
            {free} free.
          </p>
        </div>
        <div className="flex gap-1 bg-surface border border-line rounded-lg p-1">
          <TabButton active={tab === "3d"} icon={Boxes} onClick={() => setTab("3d")}>
            3D View
          </TabButton>
          <TabButton active={tab === "logs"} icon={Terminal} onClick={() => setTab("logs")}>
            Logs
          </TabButton>
        </div>
      </div>

      {tab === "3d" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="bg-surface border border-line rounded-xl overflow-hidden h-[560px] relative">
            <ParkingScene slots={slots} animatingCar={animatingCar} gateOpen={gateOpen} scanning={scanning} />
            <div className="absolute top-3 left-3 flex items-center gap-1.5 text-xs font-medium bg-bg/70 backdrop-blur px-2.5 py-1 rounded-full border border-line">
              <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-line"}`} />
              {connected ? "Live sensor feed" : "Connecting..."}
            </div>
            <div className="absolute bottom-3 left-3 flex gap-3 text-[11px] text-muted bg-bg/70 backdrop-blur px-3 py-1.5 rounded-full border border-line">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slot-free" /> Free
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slot-booked" /> Booked
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slot-occupied" /> Occupied
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <QrScanner compact onBusyChange={setScanning} onResult={handleScanResult} />
            {lastResult && (
              <div
                className={`text-sm rounded-lg px-3 py-2 border animate-fade-in ${
                  lastResult.ok
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-900/40"
                    : "bg-red-500/10 text-red-300 border-red-900/40"
                }`}
              >
                {lastResult.message}
              </div>
            )}
            <p className="text-xs text-muted leading-relaxed">
              Drag to orbit, scroll to zoom. Present a booking's QR to the camera above (or paste its
              token) to watch the gate lift and the car drive to its assigned slot.
            </p>
          </div>
        </div>
      ) : (
        <div className="h-[640px]">
          <LogsFeed />
        </div>
      )}
    </div>
  );
}
