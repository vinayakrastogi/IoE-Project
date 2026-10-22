import { Text } from "@react-three/drei";
import {
  SLOT_WIDTH,
  SLOT_DEPTH,
  slotPosition,
  STATUS_COLORS,
  STATUS_EMISSIVE_INTENSITY,
} from "./layout.js";
import Car from "./Car.jsx";

// Fixed, deterministic palette so parked-car colors are stable across
// re-renders (no randomness / flicker) but still visually varied lot-wide.
const CAR_PALETTE = ["#64748b", "#38bdf8", "#f8fafc", "#a78bfa", "#2dd4bf", "#fb923c"];

const PAD_MARGIN = 0.35; // gap between adjacent pads so slot boundaries read clearly
const PAD_W = SLOT_WIDTH - PAD_MARGIN;
const PAD_D = SLOT_DEPTH - PAD_MARGIN;
const LINE_THICKNESS = 0.06;
const LINE_HEIGHT = 0.02;

function StallLines() {
  // Four thin pale strokes tracing the pad's rectangle, like painted lines.
  const halfW = PAD_W / 2;
  const halfD = PAD_D / 2;
  return (
    <group position={[0, 0.011, 0]}>
      {/* left / right edges (run along z) */}
      <mesh position={[-halfW, 0, 0]}>
        <boxGeometry args={[LINE_THICKNESS, LINE_HEIGHT, PAD_D]} />
        <meshStandardMaterial color="#dbe4f3" emissive="#dbe4f3" emissiveIntensity={0.12} roughness={0.9} />
      </mesh>
      <mesh position={[halfW, 0, 0]}>
        <boxGeometry args={[LINE_THICKNESS, LINE_HEIGHT, PAD_D]} />
        <meshStandardMaterial color="#dbe4f3" emissive="#dbe4f3" emissiveIntensity={0.12} roughness={0.9} />
      </mesh>
      {/* front / back edges (run along x) */}
      <mesh position={[0, 0, -halfD]}>
        <boxGeometry args={[PAD_W, LINE_HEIGHT, LINE_THICKNESS]} />
        <meshStandardMaterial color="#dbe4f3" emissive="#dbe4f3" emissiveIntensity={0.12} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0, halfD]}>
        <boxGeometry args={[PAD_W, LINE_HEIGHT, LINE_THICKNESS]} />
        <meshStandardMaterial color="#dbe4f3" emissive="#dbe4f3" emissiveIntensity={0.12} roughness={0.9} />
      </mesh>
    </group>
  );
}

export default function SlotPad({ slot, hideCar = false }) {
  const [x, , z] = slotPosition(slot.index);
  const ledColor = STATUS_COLORS[slot.status] ?? STATUS_COLORS.free;
  const ledIntensity = STATUS_EMISSIVE_INTENSITY[slot.status] ?? STATUS_EMISSIVE_INTENSITY.free;
  const carColor = CAR_PALETTE[slot.index % CAR_PALETTE.length];
  const showCar = slot.status === "occupied" && !hideCar;

  // LED puck sits near the front edge of the pad (the edge closer to the
  // gate / -z side), so it reads clearly on approach and from above.
  const ledZ = -PAD_D / 2 + 0.4;

  return (
    <group position={[x, 0, z]}>
      {/* ground pad - dark asphalt */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[PAD_W, PAD_D]} />
        <meshStandardMaterial color="#171d29" roughness={0.95} metalness={0.05} />
      </mesh>

      <StallLines />

      {/* LED occupancy indicator */}
      <group position={[0, 0.06, ledZ]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.22, 0.22, 0.06, 20]} />
          <meshStandardMaterial
            color={ledColor}
            emissive={ledColor}
            emissiveIntensity={ledIntensity}
            roughness={0.3}
            metalness={0.2}
          />
        </mesh>
        <pointLight color={ledColor} intensity={1.4} distance={3.2} decay={2} position={[0, 0.35, 0]} />
      </group>

      {/* slot label */}
      <Text
        position={[0, 1.6, -PAD_D / 2 + 0.15]}
        rotation={[-Math.PI / 8, 0, 0]}
        fontSize={0.55}
        color="#e5e9f0"
        anchorX="center"
        anchorY="middle"
      >
        {slot.label}
      </Text>

      {showCar && (
        // Pad is deeper along z (SLOT_DEPTH) than wide along x (SLOT_WIDTH),
        // and rows are laid out with the drive aisle between them along z --
        // so the car's default +z-facing orientation (long axis along z)
        // is what reads as "parked" here; no extra rotation needed.
        <Car color={carColor} position={[0, 0, 0]} />
      )}
    </group>
  );
}
