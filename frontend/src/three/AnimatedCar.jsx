import * as THREE from "three";
import { slotPosition, GATE_WAITING_CAR_POSITION } from "./layout.js";
import Car from "./Car.jsx";

const HERO_COLOR = "#38bdf8";

// Progress is externally driven (by whoever owns the animation interval), so
// position/rotation are derived directly from props on every render -- no
// useFrame needed here for the transform itself.
export default function AnimatedCar({ job }) {
  if (!job) return null;

  const { slotIndex, direction, progress } = job;
  const slotPos = slotPosition(slotIndex);
  const waitPos = GATE_WAITING_CAR_POSITION;

  const start = direction === "entry" ? waitPos : slotPos;
  const end = direction === "entry" ? slotPos : waitPos;

  const startVec = new THREE.Vector3(...start);
  const endVec = new THREE.Vector3(...end);
  const t = Math.min(1, Math.max(0, progress ?? 0));
  const currentVec = new THREE.Vector3().lerpVectors(startVec, endVec, t);

  const dx = endVec.x - startVec.x;
  const dz = endVec.z - startVec.z;
  // Car's default forward is +z; atan2(dx, dz) gives the yaw needed to point
  // the car's +z axis along the (dx, dz) travel direction.
  const yaw = Math.atan2(dx, dz);

  return (
    <Car
      color={HERO_COLOR}
      position={[currentVec.x, currentVec.y, currentVec.z]}
      rotation={[0, yaw, 0]}
    />
  );
}
