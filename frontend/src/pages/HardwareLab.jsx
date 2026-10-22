import { CircuitBoard, Code2, Cpu, LayoutGrid, Plug, Radio } from "lucide-react";
import { useMemo, useState } from "react";

import { LAB_URL } from "../api/client";
import BayControl from "../components/hardware/BayControl";
import FirmwareView from "../components/hardware/FirmwareView";
import GateCircuit from "../components/hardware/GateCircuit";
import GatePanel from "../components/hardware/GatePanel";
import SerialMonitor from "../components/hardware/SerialMonitor";
import ZoneCircuit from "../components/hardware/ZoneCircuit";
import { useLabSocket } from "../hooks/useLabSocket";

function Chip({ ok, children }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
        ok ? "border-emerald-900/50 bg-emerald-500/10 text-emerald-300" : "border-line bg-surface text-muted"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400 animate-pulse" : "bg-line"}`} />
      {children}
    </span>
  );
}

function TabButton({ active, icon: Icon, children, ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
        active ? "bg-surface2 text-ink shadow-glow" : "text-muted hover:text-ink"
      }`}
    >
      {Icon && <Icon size={14} />}
      {children}
    </button>
  );
}

function recentActivity(lines = []) {
  const now = Date.now();
  const last = (dir) => [...lines].reverse().find((entry) => entry.dir === dir);
  const tx = last("tx");
  const rx = last("rx");
  return { tx: Boolean(tx && now - tx.t < 180), rx: Boolean(rx && now - rx.t < 180) };
}

function OfflinePanel() {
  return (
    <div className="bg-surface border border-line rounded-xl p-8 text-center max-w-xl mx-auto mt-10">
      <Plug className="mx-auto text-muted mb-3" size={28} />
      <h2 className="text-ink font-semibold mb-1">The hardware lab is not reachable</h2>
      <p className="text-sm text-muted leading-relaxed">
        Looking for it at <code className="text-ink/90">{LAB_URL}</code>. It starts with the rest of the stack:
      </p>
      <pre className="mt-3 text-left text-xs bg-bg border border-line rounded-lg px-3 py-2 text-ink/90 overflow-x-auto">
        docker compose up -d hardware-lab pi-gateway
      </pre>
    </div>
  );
}

export default function HardwareLab() {
  const { state, serial, connected, send } = useLabSocket();
  const [tab, setTab] = useState("floor");

  const { nodes, zones, gate, bays } = useMemo(() => {
    const list = state?.nodes ?? [];
    const zoneNodes = list.filter((n) => n.kind === "zone");
    const gateNode = list.find((n) => n.kind === "gate");
    const worldBySlot = new Map((state?.world.slots ?? []).map((s) => [s.slot, s]));
    const all = zoneNodes.flatMap((node) =>
      node.slots.map((slot) => ({ ...slot, node: node.id, parked: worldBySlot.get(slot.slot)?.parked ?? false })),
    );
    return { nodes: list, zones: zoneNodes, gate: gateNode, bays: all };
  }, [state]);

  const gatewayLinks = (state?.uart ?? []).filter((u) => u.connected).length;
  const totalLinks = state?.uart.length ?? 0;
  const activeZone = zones.find((z) => `zone-${z.zone}` === tab || z.id === tab);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="max-w-3xl">
          <h1 className="text-xl font-bold text-ink flex items-center gap-2">
            <Cpu size={20} className="text-accent" />
            Hardware Lab
          </h1>
          <p className="text-sm text-muted leading-relaxed">
            Real firmware, compiled with avr-gcc, running on {nodes.length || 6} emulated Arduino Uno boards. Sensors
            measure a virtual world, the firmware decides, and a Raspberry Pi gateway turns the serial traffic into MQTT
            for the backend. Nothing on this page is scripted: move a car, book a slot or scan a QR code and watch the
            pins react.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip ok={connected}>{connected ? "Lab connected" : "Connecting..."}</Chip>
          <Chip ok={Boolean(state?.mqtt.connected)}>MQTT</Chip>
          <Chip ok={totalLinks > 0 && gatewayLinks === totalLinks}>
            Gateway links {gatewayLinks}/{totalLinks || 6}
          </Chip>
        </div>
      </div>

      {!connected && !state ? (
        <OfflinePanel />
      ) : !state ? (
        <p className="text-sm text-muted">Waiting for the first update...</p>
      ) : (
        <>
          <div className="flex gap-1 bg-surface border border-line rounded-lg p-1 mb-4 overflow-x-auto">
            <TabButton active={tab === "floor"} icon={LayoutGrid} onClick={() => setTab("floor")}>
              Floor
            </TabButton>
            {zones.map((zone) => (
              <TabButton
                key={zone.id}
                active={tab === zone.id}
                icon={CircuitBoard}
                onClick={() => setTab(zone.id)}
              >
                Zone {zone.id.slice(-1).toUpperCase()}
              </TabButton>
            ))}
            {gate && (
              <TabButton active={tab === "gate"} icon={Radio} onClick={() => setTab("gate")}>
                Gate
              </TabButton>
            )}
            <TabButton active={tab === "firmware"} icon={Code2} onClick={() => setTab("firmware")}>
              Firmware
            </TabButton>
          </div>

          {tab === "floor" && (
            <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
              <div>
                <p className="text-xs text-muted mb-3">
                  Twenty bays, each watched by its own HC-SR04. The slider is the distance between the sensor and
                  whatever is in front of it - drag it below 30 cm to park a car. The LED is the physical pin state of
                  the Arduino.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
                  {bays.map((bay) => (
                    <BayControl key={bay.slot} bay={bay} send={send} compact />
                  ))}
                </div>
              </div>
              {gate && (
                <div className="xl:sticky xl:top-20 self-start">
                  <GatePanel gate={gate} world={state.world} send={send} />
                </div>
              )}
            </div>
          )}

          {activeZone && (
            <div className="flex flex-col gap-4">
              <div className="bg-surface border border-line rounded-xl p-3 overflow-hidden">
                <ZoneCircuit node={activeZone} serialActivity={recentActivity(serial[activeZone.id])} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {activeZone.slots.map((slot) => (
                  <BayControl
                    key={slot.slot}
                    bay={{ ...slot, node: activeZone.id }}
                    send={send}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span>
                  Uptime {activeZone.uptimeS} s - emulated CPU busy {activeZone.cpuBusyPct}% - boots {activeZone.boots}
                </span>
                <button
                  onClick={() => send({ type: "reset", node: activeZone.id })}
                  className="font-medium bg-surface2 hover:bg-line text-ink rounded-md px-3 py-1.5 transition-colors"
                >
                  Press reset button
                </button>
              </div>
              <SerialMonitor lines={serial[activeZone.id]} title={`${activeZone.id} serial link`} />
            </div>
          )}

          {tab === "gate" && gate && (
            <div className="flex flex-col gap-4">
              <div className="bg-surface border border-line rounded-xl p-3 overflow-hidden">
                <GateCircuit node={gate} serialActivity={recentActivity(serial.gate)} />
              </div>
              <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
                <GatePanel gate={gate} world={state.world} send={send} />
                <div className="flex flex-col gap-3">
                  <SerialMonitor lines={serial.gate} title="gate serial link" height={220} />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                    <span>
                      Uptime {gate.uptimeS} s - emulated CPU busy {gate.cpuBusyPct}% - boots {gate.boots}
                    </span>
                    <button
                      onClick={() => send({ type: "reset", node: "gate" })}
                      className="font-medium bg-surface2 hover:bg-line text-ink rounded-md px-3 py-1.5 transition-colors"
                    >
                      Press reset button
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "firmware" && <FirmwareView />}
        </>
      )}
    </div>
  );
}
