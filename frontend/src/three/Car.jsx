// Stylized low-poly car built from primitive meshes. Faces +z by default
// (front bumper / headlights toward +z, rear bumper / taillights toward -z),
// so callers can rotate.y to point it wherever it needs to drive.

const BODY_LENGTH = 1.8; // along z
const BODY_WIDTH = 0.9; // along x
const BODY_HEIGHT = 0.7; // along y
const BODY_Y = 0.45; // body center height off the ground

const CABIN_LENGTH = 1.0;
const CABIN_WIDTH = 0.72;
const CABIN_HEIGHT = 0.42;
const CABIN_Y = BODY_Y + BODY_HEIGHT / 2 + CABIN_HEIGHT / 2 - 0.05;
const CABIN_Z = -0.08; // slightly toward the rear, like a real cabin greenhouse

const WHEEL_RADIUS = 0.26;
const WHEEL_THICKNESS = 0.22;
const WHEEL_Y = 0.26;
const WHEEL_X = BODY_WIDTH / 2 + 0.02;
const WHEEL_Z = BODY_LENGTH / 2 - 0.42;

function Wheel({ x, z }) {
  return (
    <mesh position={[x, WHEEL_Y, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_THICKNESS, 16]} />
      <meshStandardMaterial color="#0b0d12" roughness={0.85} metalness={0.1} />
    </mesh>
  );
}

export default function Car({ color = "#94a3b8", ...groupProps }) {
  return (
    <group {...groupProps}>
      {/* body */}
      <mesh position={[0, BODY_Y, 0]} castShadow receiveShadow>
        <boxGeometry args={[BODY_WIDTH, BODY_HEIGHT, BODY_LENGTH]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.55} />
      </mesh>

      {/* cabin / glass */}
      <mesh position={[0, CABIN_Y, CABIN_Z]} castShadow>
        <boxGeometry args={[CABIN_WIDTH, CABIN_HEIGHT, CABIN_LENGTH]} />
        <meshStandardMaterial
          color="#0f1a2e"
          roughness={0.15}
          metalness={0.2}
          transparent
          opacity={0.65}
        />
      </mesh>

      {/* wheels - 4 corners */}
      <Wheel x={-WHEEL_X} z={WHEEL_Z} />
      <Wheel x={WHEEL_X} z={WHEEL_Z} />
      <Wheel x={-WHEEL_X} z={-WHEEL_Z} />
      <Wheel x={WHEEL_X} z={-WHEEL_Z} />

      {/* headlights - warm white, front = +z */}
      <mesh position={[-BODY_WIDTH / 2 + 0.18, BODY_Y, BODY_LENGTH / 2 + 0.02]}>
        <boxGeometry args={[0.16, 0.1, 0.04]} />
        <meshStandardMaterial
          color="#fff7dd"
          emissive="#ffe9a8"
          emissiveIntensity={1.4}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[BODY_WIDTH / 2 - 0.18, BODY_Y, BODY_LENGTH / 2 + 0.02]}>
        <boxGeometry args={[0.16, 0.1, 0.04]} />
        <meshStandardMaterial
          color="#fff7dd"
          emissive="#ffe9a8"
          emissiveIntensity={1.4}
          roughness={0.4}
        />
      </mesh>

      {/* taillights - red, rear = -z */}
      <mesh position={[-BODY_WIDTH / 2 + 0.18, BODY_Y, -BODY_LENGTH / 2 - 0.02]}>
        <boxGeometry args={[0.16, 0.1, 0.04]} />
        <meshStandardMaterial
          color="#ff3b3b"
          emissive="#ff1f1f"
          emissiveIntensity={1.2}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[BODY_WIDTH / 2 - 0.18, BODY_Y, -BODY_LENGTH / 2 - 0.02]}>
        <boxGeometry args={[0.16, 0.1, 0.04]} />
        <meshStandardMaterial
          color="#ff3b3b"
          emissive="#ff1f1f"
          emissiveIntensity={1.2}
          roughness={0.4}
        />
      </mesh>
    </group>
  );
}
