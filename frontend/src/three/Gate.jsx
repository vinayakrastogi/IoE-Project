import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { GATE_LANE_X } from "./layout.js";

const LANE_HALF_WIDTH = 2.4; // clear width for a car to pass between posts
const POST_HEIGHT = 2.4;
const POST_SIZE = 0.28;
const BASE_HEIGHT = 0.25;
const BOOM_LENGTH = LANE_HALF_WIDTH * 2 + 0.6;
const BOOM_THICKNESS = 0.1;

const CLOSED_ROTATION = 0;
// Boom's long axis starts along local +x (horizontal, blocking the lane).
// Rotating the pivot group around +z swings that +x axis up toward +y, so a
// POSITIVE angle here raises the arm up and out of the way.
const OPEN_ROTATION = (Math.PI / 180) * 75; // ~75deg swung up, clear of the lane
const LERP_SPEED = 6; // higher = faster settle, ~0.5-0.7s full travel with damp-like lerp

function BoomStripes() {
  // A handful of alternating red/white segments along the boom for the
  // classic barrier-arm look, laid end to end along the boom's length (x).
  const segments = 7;
  const segLength = BOOM_LENGTH / segments;
  return (
    <group>
      {Array.from({ length: segments }, (_, i) => {
        const x = -BOOM_LENGTH / 2 + segLength * (i + 0.5);
        const isRed = i % 2 === 0;
        return (
          <mesh key={i} position={[x, 0, 0]}>
            <boxGeometry args={[segLength - 0.02, BOOM_THICKNESS, BOOM_THICKNESS]} />
            <meshStandardMaterial
              color={isRed ? "#dc2626" : "#f4f6fb"}
              roughness={0.5}
              metalness={0.1}
            />
          </mesh>
        );
      })}
    </group>
  );
}

export default function Gate({ position = [0, 0, 0], open = false }) {
  const boomPivotRef = useRef();
  const currentRotRef = useRef(CLOSED_ROTATION);

  useFrame((_, delta) => {
    const target = open ? OPEN_ROTATION : CLOSED_ROTATION;
    const t = 1 - Math.exp(-LERP_SPEED * delta); // smooth damp-like lerp factor
    currentRotRef.current += (target - currentRotRef.current) * t;
    if (boomPivotRef.current) {
      boomPivotRef.current.rotation.z = currentRotRef.current;
    }
  });

  const leftPostX = GATE_LANE_X - LANE_HALF_WIDTH;
  const rightPostX = GATE_LANE_X + LANE_HALF_WIDTH;

  return (
    <group position={position}>
      {/* left post (boom pivots here) + housing */}
      <group position={[leftPostX, 0, 0]}>
        <mesh position={[0, BASE_HEIGHT / 2, 0]} castShadow>
          <boxGeometry args={[0.6, BASE_HEIGHT, 0.6]} />
          <meshStandardMaterial color="#1a2233" roughness={0.7} metalness={0.3} />
        </mesh>
        <mesh position={[0, POST_HEIGHT / 2 + BASE_HEIGHT, 0]} castShadow>
          <boxGeometry args={[POST_SIZE, POST_HEIGHT, POST_SIZE]} />
          <meshStandardMaterial color="#151d2e" roughness={0.5} metalness={0.4} />
        </mesh>
        {/* control housing box near the top of the post */}
        <mesh position={[0.22, POST_HEIGHT + BASE_HEIGHT - 0.2, 0]} castShadow>
          <boxGeometry args={[0.32, 0.4, 0.34]} />
          <meshStandardMaterial color="#0e1420" roughness={0.4} metalness={0.5} />
        </mesh>
        {/* status LED on the housing */}
        <mesh position={[0.4, POST_HEIGHT + BASE_HEIGHT - 0.1, 0]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial
            color={open ? "#22c55e" : "#ef4444"}
            emissive={open ? "#22c55e" : "#ef4444"}
            emissiveIntensity={1}
          />
        </mesh>

        {/* boom pivot: rotates around z axis, arm extends toward +x */}
        <group
          ref={boomPivotRef}
          position={[0, POST_HEIGHT + BASE_HEIGHT - 0.05, 0]}
        >
          <group position={[BOOM_LENGTH / 2, 0, 0]}>
            <mesh castShadow>
              <boxGeometry args={[BOOM_LENGTH, BOOM_THICKNESS, BOOM_THICKNESS]} />
              <meshStandardMaterial color="#f4f6fb" roughness={0.5} metalness={0.1} />
            </mesh>
            <BoomStripes />
          </group>
        </group>
      </group>

      {/* right post + housing (no boom, mirrors the left) */}
      <group position={[rightPostX, 0, 0]}>
        <mesh position={[0, BASE_HEIGHT / 2, 0]} castShadow>
          <boxGeometry args={[0.6, BASE_HEIGHT, 0.6]} />
          <meshStandardMaterial color="#1a2233" roughness={0.7} metalness={0.3} />
        </mesh>
        <mesh position={[0, POST_HEIGHT / 2 + BASE_HEIGHT, 0]} castShadow>
          <boxGeometry args={[POST_SIZE, POST_HEIGHT, POST_SIZE]} />
          <meshStandardMaterial color="#151d2e" roughness={0.5} metalness={0.4} />
        </mesh>
        <mesh position={[-0.22, POST_HEIGHT + BASE_HEIGHT - 0.2, 0]} castShadow>
          <boxGeometry args={[0.32, 0.4, 0.34]} />
          <meshStandardMaterial color="#0e1420" roughness={0.4} metalness={0.5} />
        </mesh>
      </group>
    </group>
  );
}
