import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function OccupancyChart({ prediction }) {
  if (!prediction) return null;

  const data = prediction.curve.map((point) => ({
    time: new Date(point.timestamp).toLocaleTimeString([], { hour: "2-digit" }),
    occupancy: point.predicted_occupancy_pct,
  }));

  return (
    <div className="bg-surface rounded-xl border border-line p-4">
      <h2 className="font-semibold text-ink mb-3">Predicted Occupancy - Next 24h</h2>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#232c40" />
          <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#8b96ab" }} interval={2} stroke="#232c40" />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#8b96ab" }} stroke="#232c40" />
          <Tooltip
            formatter={(value) => [`${value}%`, "Predicted occupancy"]}
            contentStyle={{
              backgroundColor: "#0e1420",
              border: "1px solid #232c40",
              borderRadius: 8,
              color: "#e5e9f0",
            }}
            labelStyle={{ color: "#8b96ab" }}
          />
          <ReferenceLine
            y={prediction.threshold_pct}
            stroke="#ef4444"
            strokeDasharray="4 4"
            label={{ value: `${prediction.threshold_pct}% threshold`, fontSize: 10, fill: "#f87171" }}
          />
          <Line type="monotone" dataKey="occupancy" stroke="#38bdf8" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
