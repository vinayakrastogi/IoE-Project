/*
 * ParkGrid zone controller -- Arduino Uno (ATmega328P, 16 MHz)
 *
 * Watches four parking bays. Per bay:
 *   - one HC-SR04 ultrasonic sensor at the head of the bay (measures the gap
 *     to the car's bumper)
 *   - one red/green LED. Red + green together make yellow = "reserved".
 *
 * An Uno has no network interface, so the node talks a tiny line protocol over
 * its UART to a gateway (a Raspberry Pi running gateway/pi_gateway.py), which
 * turns the frames into MQTT messages for the backend:
 *
 *   node -> gateway   B,<node>,<fw>,<first_slot>,<slots>   boot banner
 *                     H,<node>,<uptime_s>                   node heartbeat
 *                     S,<slot>,<0|1>,<distance_cm>          slot report
 *                     # <text>                              log line
 *   gateway -> node   ?                                     "who are you?" -> boot banner
 *                     L,<slot>,<f|b|o>                      LED state (free /
 *                                                           booked / occupied)
 *                                                           decided by the backend
 *
 * One binary per zone, selected at compile time with -DNODE_ZONE=0..4
 * (zone a..e = slots 1-4, 5-8, 9-12, 13-16, 17-20). See firmware/build.sh.
 *
 * Power: the CPU sleeps (SLEEP_MODE_IDLE) whenever it has nothing to do. The
 * ultrasonic echo is timed by pin-change interrupts -- the ISR stamps the rising
 * and falling edge with micros() while the CPU sleeps -- instead of busy-waiting
 * in pulseIn(), and is only awaited for a few milliseconds since all we need to
 * know is "is something within ~1 m of the bumper".
 */

#include <Arduino.h>
#include <avr/sleep.h>

#ifndef NODE_ZONE
#define NODE_ZONE 0
#endif

#define FW_VERSION "1.0.0"
#define SLOTS_PER_NODE 4
#define FIRST_SLOT (NODE_ZONE * SLOTS_PER_NODE + 1)

// ---------------------------------------------------------------- wiring ---
static const uint8_t TRIG_PIN[SLOTS_PER_NODE]  = {9, 7, 5, 3};     // HC-SR04 TRIG, bay 1..4
static const uint8_t ECHO_PIN[SLOTS_PER_NODE]  = {8, 6, 4, 2};     // HC-SR04 ECHO
static const uint8_t GREEN_PIN[SLOTS_PER_NODE] = {13, A0, A2, A4}; // LED green leg
static const uint8_t RED_PIN[SLOTS_PER_NODE]   = {12, A1, A3, A5}; // LED red leg

// ---------------------------------------------------------------- tuning ---
static const unsigned long ECHO_TIMEOUT_US = 6000UL;    // ~1 m round trip; no echo by then = empty bay
static const float NO_ECHO_CM = 400.0f;                 // reported when nothing answers in time
static const float OCCUPIED_BELOW_CM = 30.0f;           // closer than this: a car is parked
static const float FREE_ABOVE_CM = 40.0f;               // hysteresis: farther than this: bay is empty
static const uint8_t WINDOW = 3;                        // median filter length (sweeps)
static const uint8_t CONFIRM_SWEEPS = 2;                // sweeps a change must persist (debounce)
static const unsigned long BAY_SPACING_MS = 30;         // quiet time between two sensors firing
static const unsigned long SWEEP_REST_MS = 60;          // extra rest at the end of each sweep
static const unsigned long SLOT_REPORT_MS = 5000UL;     // re-send state even if unchanged
static const unsigned long NODE_BEAT_MS = 15000UL;
static const unsigned long BACKEND_STATE_TTL_MS = 90000UL;  // gateway silent this long: LEDs go stand-alone

// ----------------------------------------------------------------- state ---
struct Slot {
  bool occupied;                 // debounced local decision
  bool reported;                 // has this boot reported at least once
  uint8_t disagree;              // consecutive sweeps that contradict `occupied`
  uint8_t filled;                // how many readings are in `history`
  uint8_t next;                  // ring-buffer write index
  float history[WINDOW];         // recent raw readings
  float distanceCm;              // last filtered reading
  unsigned long lastReportMs;
  char backendState;             // 'f' | 'b' | 'o', or 0 when the backend hasn't told us
  unsigned long backendStateMs;
};

static Slot slots[SLOTS_PER_NODE];
static unsigned long lastNodeBeatMs = 0;
static char rxBuf[24];
static uint8_t rxLen = 0;

// Sleep until `ms` have passed. Timer0 ticks every ~1 ms and wakes the CPU.
static void nap(unsigned long ms) {
  unsigned long start = millis();
  while ((unsigned long)(millis() - start) < ms) {
    set_sleep_mode(SLEEP_MODE_IDLE);
    sleep_enable();
    sleep_cpu();
    sleep_disable();
  }
}

static void printNodeName() {
  Serial.print(F("zone-"));
  Serial.print((char)('a' + NODE_ZONE));
}

// ------------------------------------------------------------ ultrasonic ---
// One HC-SR04 measurement: a 10 us trigger pulse, then the echo pin stays high
// for the sound's round-trip time = 58 us per cm of distance. The echo edges are
// timestamped in a pin-change interrupt, so the CPU can sleep while it waits.
static volatile uint8_t activeEcho = 0xFF;          // echo pin currently being timed
static volatile uint8_t echoStage = 0;              // 0 waiting, 1 rise seen, 2 fall seen
static volatile unsigned long echoRiseUs = 0;
static volatile unsigned long echoFallUs = 0;

static void onEchoEdge() {
  if (activeEcho == 0xFF) return;
  unsigned long now = micros();
  if (digitalRead(activeEcho)) {
    if (echoStage == 0) {
      echoRiseUs = now;
      echoStage = 1;
    }
  } else if (echoStage == 1) {
    echoFallUs = now;
    echoStage = 2;
  }
}

ISR(PCINT0_vect) { onEchoEdge(); }                  // D8..D13
ISR(PCINT2_vect) { onEchoEdge(); }                  // D0..D7

static void echoInterrupt(uint8_t pin, bool enable) {
  volatile uint8_t *mask = digitalPinToPCMSK(pin);
  uint8_t bit = _BV(digitalPinToPCMSKbit(pin));
  if (enable) {
    *digitalPinToPCICR(pin) |= _BV(digitalPinToPCICRbit(pin));
    *mask |= bit;
  } else {
    *mask &= ~bit;
  }
}

static float pingCm(uint8_t i) {
  const uint8_t echo = ECHO_PIN[i];
  echoStage = 0;
  activeEcho = echo;
  echoInterrupt(echo, true);

  digitalWrite(TRIG_PIN[i], LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN[i], HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN[i], LOW);

  unsigned long started = micros();
  while (echoStage != 2 && (unsigned long)(micros() - started) < ECHO_TIMEOUT_US) {
    set_sleep_mode(SLEEP_MODE_IDLE);
    sleep_enable();
    sleep_cpu();                                    // woken by the echo edge (or Timer0's 1 ms tick)
    sleep_disable();
  }

  echoInterrupt(echo, false);
  activeEcho = 0xFF;
  if (echoStage != 2) return NO_ECHO_CM;            // nothing answered in time

  float cm = (float)(echoFallUs - echoRiseUs) / 58.0f;
  return cm > NO_ECHO_CM ? NO_ECHO_CM : cm;
}

// Median of the last WINDOW readings: one stray echo can never flip the bay.
static float filtered(Slot &s, float reading) {
  s.history[s.next] = reading;
  s.next = (s.next + 1) % WINDOW;
  if (s.filled < WINDOW) s.filled++;

  float w[WINDOW];
  for (uint8_t k = 0; k < s.filled; k++) w[k] = s.history[k];
  for (uint8_t a = 1; a < s.filled; a++) {             // insertion sort
    float v = w[a];
    int8_t b = a - 1;
    while (b >= 0 && w[b] > v) {
      w[b + 1] = w[b];
      b--;
    }
    w[b + 1] = v;
  }
  return w[s.filled / 2];
}

// -------------------------------------------------------------- reporting ---
static void reportSlot(uint8_t i) {
  Slot &s = slots[i];
  Serial.print(F("S,"));
  Serial.print(FIRST_SLOT + i);
  Serial.print(',');
  Serial.print(s.occupied ? 1 : 0);
  Serial.print(',');
  Serial.print(s.distanceCm, 1);
  Serial.write('\n');
  s.lastReportMs = millis();
  s.reported = true;
}

static void sendBoot() {
  Serial.print(F("B,"));
  printNodeName();
  Serial.print(',');
  Serial.print(F(FW_VERSION));
  Serial.print(',');
  Serial.print(FIRST_SLOT);
  Serial.print(',');
  Serial.print(SLOTS_PER_NODE);
  Serial.write('\n');
}

static void sendNodeBeat() {
  Serial.print(F("H,"));
  printNodeName();
  Serial.print(',');
  Serial.print(millis() / 1000UL);
  Serial.write('\n');
  lastNodeBeatMs = millis();
}

// ------------------------------------------------------------------- LEDs ---
static void applyLeds(uint8_t i) {
  Slot &s = slots[i];
  char state = s.backendState;
  if (state != 0 && (unsigned long)(millis() - s.backendStateMs) > BACKEND_STATE_TTL_MS) {
    s.backendState = 0;
    state = 0;
  }
  if (state == 0) state = s.occupied ? 'o' : 'f';      // stand-alone: no backend, local sensor decides

  digitalWrite(RED_PIN[i], (state == 'o' || state == 'b') ? HIGH : LOW);
  digitalWrite(GREEN_PIN[i], (state == 'f' || state == 'b') ? HIGH : LOW);
}

// ------------------------------------------------------------- sensing ---
static void sweepSlot(uint8_t i) {
  Slot &s = slots[i];
  s.distanceCm = filtered(s, pingCm(i));

  // Hysteresis band (30..40 cm) + debounce so a person walking past or a
  // flickering echo never toggles the bay.
  bool nowOccupied = s.occupied ? (s.distanceCm < FREE_ABOVE_CM)
                                : (s.distanceCm < OCCUPIED_BELOW_CM);
  if (nowOccupied != s.occupied) {
    if (++s.disagree >= CONFIRM_SWEEPS) {
      s.occupied = nowOccupied;
      s.disagree = 0;
      reportSlot(i);
      Serial.print(F("# slot "));
      Serial.print(FIRST_SLOT + i);
      Serial.print(s.occupied ? F(" occupied, gap ") : F(" free, gap "));
      Serial.print(s.distanceCm, 1);
      Serial.print(F(" cm\n"));
    }
  } else {
    s.disagree = 0;
  }
  if (!s.reported) reportSlot(i);
}

// ---------------------------------------------------------- serial input ---
static void handleLine(const char *line) {
  if (line[0] == '?') {                              // gateway just (re)connected: announce ourselves again
    sendBoot();
    sendNodeBeat();
    return;
  }
  if (line[0] == 'L' && line[1] == ',') {            // L,<slot>,<f|b|o>
    const char *comma = strchr(line + 2, ',');
    if (comma == NULL) return;
    int slot = atoi(line + 2);
    char state = comma[1];
    if (slot < FIRST_SLOT || slot >= FIRST_SLOT + SLOTS_PER_NODE) return;
    if (state != 'f' && state != 'b' && state != 'o') return;
    uint8_t i = slot - FIRST_SLOT;
    slots[i].backendState = state;
    slots[i].backendStateMs = millis();
    applyLeds(i);
  }
}

static void pollSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      rxBuf[rxLen] = 0;
      if (rxLen > 0) handleLine(rxBuf);
      rxLen = 0;
    } else if (rxLen < sizeof(rxBuf) - 1) {
      rxBuf[rxLen++] = c;
    } else {
      rxLen = 0;                                       // overlong line: drop it
    }
  }
}

// --------------------------------------------------------------- Arduino ---
void setup() {
  Serial.begin(115200);

  for (uint8_t i = 0; i < SLOTS_PER_NODE; i++) {
    pinMode(TRIG_PIN[i], OUTPUT);
    digitalWrite(TRIG_PIN[i], LOW);
    pinMode(ECHO_PIN[i], INPUT);
    pinMode(RED_PIN[i], OUTPUT);
    pinMode(GREEN_PIN[i], OUTPUT);
    slots[i].distanceCm = NO_ECHO_CM;
  }

  // Lamp test: every LED on for half a second so a dead one is obvious.
  for (uint8_t i = 0; i < SLOTS_PER_NODE; i++) {
    digitalWrite(RED_PIN[i], HIGH);
    digitalWrite(GREEN_PIN[i], HIGH);
  }
  nap(500);
  for (uint8_t i = 0; i < SLOTS_PER_NODE; i++) applyLeds(i);

  sendBoot();
  sendNodeBeat();
}

void loop() {
  for (uint8_t i = 0; i < SLOTS_PER_NODE; i++) {
    sweepSlot(i);
    pollSerial();
    applyLeds(i);
    if ((unsigned long)(millis() - slots[i].lastReportMs) >= SLOT_REPORT_MS) reportSlot(i);
    nap(BAY_SPACING_MS);
  }

  if ((unsigned long)(millis() - lastNodeBeatMs) >= NODE_BEAT_MS) sendNodeBeat();
  nap(SWEEP_REST_MS);
}
