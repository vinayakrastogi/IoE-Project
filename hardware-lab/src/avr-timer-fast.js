// avr8js re-schedules every timer once per *prescaler tick* -- every 64 CPU
// cycles for the Arduino core's default setup, ~250 000 times a second per
// timer -- even though almost nothing observable happens between an overflow
// and the next one. That makes an idle (sleeping) Arduino cost ~10% of a host
// core, which adds up with six of them.
//
// This keeps avr8js's counter logic (so every flag, interrupt and pin toggle
// is still produced by the library) but changes *when* it runs: instead of
// every tick, only at the next moment something can be observed -- a counter
// overflow, or a compare match whose interrupt is enabled. TCNT reads and
// register writes still bring the counter up to date on demand (avr8js hooks
// them), and writes that move a compare target re-plan the next wake-up.
//
// Conservative by construction: any configuration it doesn't model exactly
// (PWM output pins, compare interrupts in PWM modes) falls back to avr8js's
// own per-tick scheduling, so behaviour never differs, only host cost.

const NORMAL = 0;
const PHASE_CORRECT = 1;
const CTC = 2;
const FAST_PWM = 3;
const PHASE_FREQUENCY_CORRECT = 4;

const PHASE_CORRECT_SLICE_TICKS = 256;

function ticksUntilObservable(timer) {
  const { config, tcnt, timerMode } = timer;
  const comOutputsActive = (timer.TCCRA & 0xf0) !== 0;
  if (comOutputsActive) return 1; // a PWM/toggle pin follows the counter: needs exact timing

  const timsk = timer.TIMSK;
  const overflowEnabled = (timsk & config.TOIE) !== 0;
  const compareAEnabled = (timsk & config.OCIEA) !== 0;
  const compareBEnabled = (timsk & config.OCIEB) !== 0;

  if (timerMode === NORMAL || timerMode === FAST_PWM || timerMode === CTC) {
    const top = timer.TOP;
    const period = top + 1;
    let ticks = period - tcnt; // up to and including the wrap to 0
    for (const [enabled, ocr] of [
      [compareAEnabled, timer.ocrA],
      [compareBEnabled, timer.ocrB],
    ]) {
      if (!enabled || ocr > top) continue;
      const toMatch = ocr > tcnt ? ocr - tcnt : ocr + period - tcnt;
      ticks = Math.min(ticks, toMatch);
    }
    return Math.max(1, ticks);
  }

  if (timerMode === PHASE_CORRECT || timerMode === PHASE_FREQUENCY_CORRECT) {
    if (overflowEnabled || compareAEnabled || compareBEnabled) return 1;
    return PHASE_CORRECT_SLICE_TICKS; // nothing can interrupt; just keep the counter fresh
  }

  return 1;
}

export function coarsenTimerScheduling(timer) {
  const { cpu, config } = timer;
  const stockCount = timer.count;

  const count = (reschedule = true, external = false) => {
    // When the prescaler was just changed, avr8js schedules the first tick itself.
    const schedulesItself = timer.updateDivider;
    stockCount(false, external);
    if (schedulesItself || !reschedule || !timer.divider) return;

    const ticks = ticksUntilObservable(timer);
    const dueCycle = timer.lastCycle + ticks * timer.divider;
    cpu.addClockEvent(count, Math.max(1, dueCycle - cpu.cycles));
  };
  timer.count = count;

  // Registers whose value changes *when* the next event is due: re-plan right after a write.
  const replan = () => cpu.updateClockEvent(count, 0);
  const watched = [config.OCRA, config.OCRB, config.TIMSK, config.TCCRA];
  if (config.bits === 16) watched.push(config.ICR);
  for (const register of watched) {
    const previous = cpu.writeHooks[register];
    if (!previous) continue;
    cpu.writeHooks[register] = (value, oldValue, address, mask) => {
      const handled = previous(value, oldValue, address, mask);
      if (handled !== true) cpu.data[address] = value; // keep avr8js's default store for hooks that return nothing
      replan();
      return true;
    };
  }
}
