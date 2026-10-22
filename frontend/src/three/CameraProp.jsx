import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

const IDLE_COLOR = "#38bdf8"; // calm blue, steady
const SCAN_COLOR = "#67e8f9"; // bright cyan, pulsing
const IDLE_INTENSITY = 0.5;
const SCAN_PULSE_SPEED = 8; // fast pulse while actively "scanning"

export default function CameraProp({ position = [0, 0, 0], scanning = false }) {
  const indicatorRef = useRef();

  useFrame(({ clock }) => {
    if (!indicatorRef.current) return;
    const mat = indicatorRef.current.material;
    if (scanning) {
      // Oscillate between a low floor and a bright peak for an attention
      // grabbing "actively reading a QR code" pulse.
      const wave = (Math.sin(clock.elapsedTime * SCAN_PULSE_SPEED) + 1) / 2;
      mat.emissiveIntensity = 0.6 + wave * 2.4;
    } else {
      mat.emissiveIntensity = IDLE_INTENSITY;
    }
  });

  return (
    <group position={position}>
      {/* pole */}
      <mesh position={[0, -0.6, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 1.2, 10]} />
        <meshStandardMaterial color="#1a2233" roughness={0.6} metalness={0.4} />
      </mesh>

      {/* housing, angled to look back toward the waiting-car spot (-z-ish) */}
      <group rotation={[0.35, Math.PI, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.26, 0.22, 0.42]} />
          <meshStandardMaterial color="#0e1420" roughness={0.35} metalness={0.6} />
        </mesh>
        {/* lens */}
        <mesh position={[0, 0, 0.24]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.09, 0.09, 0.12, 16]} />
          <meshStandardMaterial color="#04070c" roughness={0.1} metalness={0.8} />
        </mesh>
        {/* indicator light on top of housing */}
        <mesh ref={indicatorRef} position={[0, 0.15, 0.1]}>
          <sphereGeometry args={[0.035, 10, 10]} />
          <meshStandardMaterial
            color={scanning ? SCAN_COLOR : IDLE_COLOR}
            emissive={scanning ? SCAN_COLOR : IDLE_COLOR}
            emissiveIntensity={IDLE_INTENSITY}
          />
        </mesh>
      </group>
    </group>
  );
}
