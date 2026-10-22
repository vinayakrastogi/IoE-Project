import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { GATE_POSITION } from "./layout.js";
import SlotPad from "./SlotPad.jsx";
import Gate from "./Gate.jsx";
import CameraProp from "./CameraProp.jsx";
import AnimatedCar from "./AnimatedCar.jsx";

const GROUND_SIZE = 90;
const CAMERA_PROP_POSITION = [
  GATE_POSITION[0] + 2,
  GATE_POSITION[1] + 3,
  GATE_POSITION[2],
];

export default function ParkingScene({ slots = [], animatingCar = null, gateOpen = false, scanning = false }) {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 28, 38], fov: 50, near: 0.1, far: 300 }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#05070d"]} />
      <fog attach="fog" args={["#05070d", 40, 110]} />

      {/* lighting: dim ambient + cool directional/spot for a moody IoT look */}
      <ambientLight intensity={0.28} color="#8fb3ff" />
      <directionalLight
        position={[15, 25, 10]}
        intensity={0.6}
        color="#bcd6ff"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <spotLight
        position={[-10, 18, -20]}
        angle={0.5}
        penumbra={0.6}
        intensity={0.5}
        color="#38bdf8"
        distance={70}
      />

      {/* ground */}
      <mesh
        position={[0, -0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        <meshStandardMaterial color="#11151c" roughness={1} metalness={0} />
      </mesh>

      {/* drive lane divider stripes, running from the gate into the lot */}
      <group position={[0, 0.005, GATE_POSITION[2] / 2]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-1.4, 0, 0]}>
          <planeGeometry args={[0.08, Math.abs(GATE_POSITION[2]) * 1.6]} />
          <meshStandardMaterial color="#3a4157" roughness={0.9} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[1.4, 0, 0]}>
          <planeGeometry args={[0.08, Math.abs(GATE_POSITION[2]) * 1.6]} />
          <meshStandardMaterial color="#3a4157" roughness={0.9} />
        </mesh>
      </group>

      {slots.map((s) => (
        <SlotPad key={s.id} slot={s} hideCar={animatingCar?.slotIndex === s.index} />
      ))}

      <Gate position={GATE_POSITION} open={gateOpen} />

      <CameraProp position={CAMERA_PROP_POSITION} scanning={scanning} />

      {animatingCar && <AnimatedCar job={animatingCar} />}

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={12}
        maxDistance={70}
        maxPolarAngle={Math.PI / 2 - 0.05}
        target={[0, 0, -8]}
      />
    </Canvas>
  );
}
