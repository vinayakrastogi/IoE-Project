// The physical world around the hardware: where cars are, whether one is
// waiting at the barrier. Sensors read from here, so moving a car (by hand in
// the dashboard, or because the backend opened the gate for it) changes what
// the ultrasonic sensors see -- there is no shortcut into the firmware.

import { EventEmitter } from "node:events";

export const TOTAL_SLOTS = 20;

const FREE_RANGE_CM = [150, 260];  // what an empty bay looks like to the sensor
const PARKED_RANGE_CM = [9, 22];   // bumper-to-sensor gap of a parked car
const PARKED_BELOW_CM = 40;

// Drive timings (ms) after the backend opens the gate for a booking.
const ENTRY_BARRIER_UP_MS = 900;   // arm needs ~0.6 s to rise before the car moves
const ENTRY_THROUGH_GATE_MS = 1800;
const ENTRY_DRIVE_TO_BAY_MS = 2500;
const EXIT_LEAVE_BAY_MS = 1200;
const EXIT_TO_GATE_MS = 1000;
const NEXT_CAR_DELAY_MS = 8000;

const randomBetween = ([lo, hi]) => lo + Math.random() * (hi - lo);

export class World extends EventEmitter {
  constructor() {
    super();
    this.distances = new Map();
    this.tweens = new Map();
    this.timers = new Set();
    this.vehicleWaiting = true; // a car idling at the barrier
    this.transit = 0;           // cars currently passing through the barrier line
    this.autoQueue = true;      // keep sending a fresh car to the barrier

    for (let slot = 1; slot <= TOTAL_SLOTS; slot++) {
      this.distances.set(slot, randomBetween(FREE_RANGE_CM));
    }
  }

  // ---- queries ----------------------------------------------------------
  distanceOf(slot) {
    return this.distances.get(slot) ?? 400;
  }

  isParked(slot) {
    return this.distanceOf(slot) < PARKED_BELOW_CM;
  }

  /** True while something blocks the IR beam at the barrier. */
  get beamBlocked() {
    return this.vehicleWaiting || this.transit > 0;
  }

  state() {
    return {
      slots: [...this.distances.entries()].map(([slot, cm]) => ({
        slot,
        distanceCm: Math.round(cm * 10) / 10,
        parked: cm < PARKED_BELOW_CM,
      })),
      gate: {
        vehicleWaiting: this.vehicleWaiting,
        beamBlocked: this.beamBlocked,
        autoQueue: this.autoQueue,
      },
    };
  }

  // ---- direct manipulation (dashboard) -----------------------------------
  setDistance(slot, cm) {
    if (!this.distances.has(slot)) return;
    this.#cancelTween(slot);
    this.#applyDistance(slot, Math.max(2, Math.min(450, Number(cm))));
  }

  parkCar(slot, durationMs = 1500) {
    this.#tween(slot, randomBetween(PARKED_RANGE_CM), durationMs);
  }

  removeCar(slot, durationMs = 1500) {
    this.#tween(slot, randomBetween(FREE_RANGE_CM), durationMs);
  }

  setVehicleWaiting(present) {
    this.vehicleWaiting = Boolean(present);
    this.#emitGate();
  }

  setAutoQueue(enabled) {
    this.autoQueue = Boolean(enabled);
    this.#emitGate();
  }

  // ---- reactions to backend events ----------------------------------------
  /** The backend opened the barrier: a car drives in (entry) or out (exit). */
  handleGateCommand(command) {
    if (command.action !== "open") return;
    const slot = Number(command.slot_index);
    if (command.direction === "exit") this.#carLeaves(slot);
    else this.#carArrives(slot);
  }

  /** An operator forced the slot free: tow whatever is parked there. */
  handleSlotCleared(slot) {
    if (this.isParked(slot)) this.removeCar(slot, 800);
  }

  #carArrives(slot) {
    this.transit++;
    this.#emitGate();
    this.#later(ENTRY_BARRIER_UP_MS + ENTRY_THROUGH_GATE_MS, () => {
      this.vehicleWaiting = false;
      this.transit = Math.max(0, this.transit - 1);
      this.#emitGate();
      if (slot) this.parkCar(slot, ENTRY_DRIVE_TO_BAY_MS);
      if (this.autoQueue) this.#later(NEXT_CAR_DELAY_MS, () => this.setVehicleWaiting(true));
    });
  }

  #carLeaves(slot) {
    if (slot) this.removeCar(slot, EXIT_LEAVE_BAY_MS);
    // The leaving car must reach the barrier while it is still up (the arm holds
    // for 3 s), drive through the beam, and only then may the barrier come down.
    this.#later(EXIT_LEAVE_BAY_MS + EXIT_TO_GATE_MS, () => {
      this.transit++;
      this.#emitGate();
      this.#later(ENTRY_THROUGH_GATE_MS, () => {
        this.transit = Math.max(0, this.transit - 1);
        this.vehicleWaiting = false; // the car idling at the barrier was the one served
        this.#emitGate();
        if (this.autoQueue) this.#later(NEXT_CAR_DELAY_MS, () => this.setVehicleWaiting(true));
      });
    });
  }

  // ---- internals ------------------------------------------------------------
  #applyDistance(slot, cm) {
    this.distances.set(slot, cm);
    this.emit("distance", slot, cm);
    this.emit("change");
  }

  #emitGate() {
    this.emit("beam", this.beamBlocked);
    this.emit("change");
  }

  #later(ms, fn) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  #cancelTween(slot) {
    const running = this.tweens.get(slot);
    if (running) {
      clearInterval(running);
      this.tweens.delete(slot);
    }
  }

  #tween(slot, target, durationMs) {
    if (!this.distances.has(slot)) return;
    this.#cancelTween(slot);
    const from = this.distanceOf(slot);
    const steps = Math.max(1, Math.round(durationMs / 100));
    let step = 0;
    const timer = setInterval(() => {
      step++;
      const t = step / steps;
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in-out
      this.#applyDistance(slot, from + (target - from) * eased);
      if (step >= steps) this.#cancelTween(slot);
    }, 100);
    this.tweens.set(slot, timer);
  }

  dispose() {
    for (const timer of this.tweens.values()) clearInterval(timer);
    for (const timer of this.timers) clearTimeout(timer);
  }
}
