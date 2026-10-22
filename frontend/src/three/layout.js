// Shared geometry contract for the 3D monitor scene. Both the parking-lot
// scene and the gate-scan animation import from here so a car's drive path
// always lands exactly on the slot mesh it's supposed to park in.

export const TOTAL_SLOTS = 20;
export const SLOTS_PER_ROW = 5;
export const ROWS_TOTAL = Math.ceil(TOTAL_SLOTS / SLOTS_PER_ROW);

export const SLOT_WIDTH = 3.2;
export const SLOT_DEPTH = 5.5;
export const ROW_GAP = 6.5; // drive-aisle gap between facing rows

// Row 0 (slots 1-5, labels A1-A5) is the front row, closest to the gate.
// z increases with row index, moving away from the gate.
const FIRST_ROW_Z = (0 - (ROWS_TOTAL - 1) / 2) * (SLOT_DEPTH + ROW_GAP);

export function slotPosition(index) {
  const row = Math.floor((index - 1) / SLOTS_PER_ROW);
  const col = (index - 1) % SLOTS_PER_ROW;
  const x = (col - (SLOTS_PER_ROW - 1) / 2) * SLOT_WIDTH;
  const z = (row - (ROWS_TOTAL - 1) / 2) * (SLOT_DEPTH + ROW_GAP);
  return [x, 0, z];
}

// Gate sits in front of row A, facing into the lot along +z. Kept close
// enough to row A that the default camera framing in ParkingScene.jsx shows
// the gate clearly alongside the full lot without orbiting.
export const GATE_POSITION = [0, 0, FIRST_ROW_Z - 7];
export const GATE_WAITING_CAR_POSITION = [0, 0, FIRST_ROW_Z - 4];
export const GATE_LANE_X = 0;

export const STATUS_COLORS = {
  free: "#22c55e",
  booked: "#facc15",
  occupied: "#ef4444",
};

export const STATUS_EMISSIVE_INTENSITY = {
  free: 0.9,
  booked: 0.9,
  occupied: 1.2,
};
