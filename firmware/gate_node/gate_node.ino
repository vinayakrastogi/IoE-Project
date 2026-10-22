/*
 * ParkGrid gate controller -- Arduino Uno (ATmega328P, 16 MHz)
 *
 * Drives the entry/exit barrier:
 *   - SG90 servo         barrier arm (0 deg = down, 90 deg = up)
 *   - IR obstacle sensor vehicle-presence beam across the lane (active LOW)
 *   - green / red LEDs   go / stop lamp
 *   - active buzzer      confirmation and rejection tones
 *   - 16x2 HD44780 LCD   driver prompts (4-bit mode)
 *
 * Like the zone nodes it talks a line protocol over UART to the gateway:
 *
 *   node -> gateway   B,<node>,<fw>,0,0                     boot banner
 *                     H,<node>,<uptime_s>                   heartbeat
 *                     V,<0|1>                               vehicle at the barrier
 *                     A,<entry|exit>,<booking>,<slot>       cycle finished (ack)
 *                     # <text>                              log line
 *   gateway -> node   ?                                     "who are you?" -> boot banner
 *                     G,<entry|exit>,<booking>,<slot>       open the barrier
 *                     D,<reason>                            reject (bad QR etc.)
 *                     F,<free>,<total>                      free-slot count for the display
 *
 * The backend decides *whether* a QR code is valid; this firmware only turns
 * its decision into motion, light and sound -- and refuses to lower the arm
 * while the beam is blocked.
 */

#include <Arduino.h>
#include <Servo.h>
#include <LiquidCrystal.h>
#include <avr/sleep.h>

#define FW_VERSION "1.0.0"

// ---------------------------------------------------------------- wiring ---
// Everything sits on the digital header, left to right: LCD, servo, IR, buzzer, lamps.
static const uint8_t PIN_SERVO = 7;
static const uint8_t PIN_IR = 6;
static const uint8_t PIN_BUZZER = 5;
static const uint8_t PIN_LED_RED = 4;
static const uint8_t PIN_LED_GREEN = 3;
// LCD (4-bit mode): RS=D13, E=D12, D4=D11, D5=D10, D6=D9, D7=D8
static LiquidCrystal lcd(13, 12, 11, 10, 9, 8);
static Servo barrier;

// ---------------------------------------------------------------- tuning ---
static const uint8_t ANGLE_CLOSED = 0;
static const uint8_t ANGLE_OPEN = 90;
static const uint8_t ANGLE_STEP = 3;                 // degrees per servo update
static const unsigned long SERVO_STEP_MS = 20;       // -> a full swing takes 0.6 s
static const unsigned long HOLD_OPEN_MS = 3000UL;    // minimum time the arm stays up
static const unsigned long CLEAR_BEAM_MS = 800UL;    // beam must be clear this long before lowering
static const unsigned long MAX_OPEN_MS = 30000UL;    // never stay up forever
static const unsigned long IR_DEBOUNCE_MS = 150UL;
static const unsigned long NODE_BEAT_MS = 15000UL;
static const unsigned long DENY_SHOW_MS = 3500UL;

// ----------------------------------------------------------------- state ---
enum GateState : uint8_t { IDLE, OPENING, HOLDING, CLOSING, DENIED };

static GateState state = IDLE;
static unsigned long stateSinceMs = 0;
static unsigned long lastServoStepMs = 0;
static uint8_t angle = ANGLE_CLOSED;

static bool vehicleAtGate = false;
static bool irRawBlocked = false;
static unsigned long irChangedMs = 0;
static unsigned long beamClearSinceMs = 0;

static bool cycleIsEntry = true;
static long cycleBooking = 0;
static long cycleSlot = 0;

static bool havePending = false;
static bool pendingIsEntry = true;
static long pendingBooking = 0;
static long pendingSlot = 0;

static int freeSlots = -1;
static int totalSlots = 0;

static char rxBuf[40];
static uint8_t rxLen = 0;
static unsigned long lastNodeBeatMs = 0;

// buzzer: a short pattern player so beeps never block the loop
static uint8_t beepsLeft = 0;
static uint16_t beepOnMs = 0;
static uint16_t beepOffMs = 0;
static bool beepIsOn = false;
static unsigned long beepChangedMs = 0;

static char lcdRow0[17] = "";
static char lcdRow1[17] = "";

// ----------------------------------------------------------------- utils ---
static void nap(unsigned long ms) {
  // Sleep in IDLE mode until `ms` have passed; Timer0's 1 ms tick wakes the CPU.
  unsigned long start = millis();
  while ((unsigned long)(millis() - start) < ms) {
    set_sleep_mode(SLEEP_MODE_IDLE);
    sleep_enable();
    sleep_cpu();
    sleep_disable();
  }
}

static void slotLabel(long slot, char *out) {            // 1 -> "A1", 6 -> "B1" (5 bays per row)
  out[0] = (char)('A' + (slot - 1) / 5);
  out[1] = (char)('1' + (slot - 1) % 5);
  out[2] = 0;
}

static void showLcd(const char *row0, const char *row1) {
  if (strncmp(row0, lcdRow0, 16) == 0 && strncmp(row1, lcdRow1, 16) == 0) return;
  strncpy(lcdRow0, row0, 16);
  lcdRow0[16] = 0;
  strncpy(lcdRow1, row1, 16);
  lcdRow1[16] = 0;
  char line[17];
  for (uint8_t r = 0; r < 2; r++) {
    const char *src = r == 0 ? lcdRow0 : lcdRow1;
    memset(line, ' ', 16);
    line[16] = 0;
    memcpy(line, src, strlen(src));
    lcd.setCursor(0, r);
    lcd.print(line);
  }
}

static void startBeeps(uint8_t count, uint16_t onMs, uint16_t offMs) {
  beepsLeft = count;
  beepOnMs = onMs;
  beepOffMs = offMs;
  beepIsOn = true;
  beepChangedMs = millis();
  digitalWrite(PIN_BUZZER, HIGH);
}

static void updateBeeps() {
  if (beepsLeft == 0) return;
  unsigned long now = millis();
  if (beepIsOn && (unsigned long)(now - beepChangedMs) >= beepOnMs) {
    digitalWrite(PIN_BUZZER, LOW);
    beepIsOn = false;
    beepChangedMs = now;
    if (--beepsLeft == 0) return;
  } else if (!beepIsOn && (unsigned long)(now - beepChangedMs) >= beepOffMs) {
    digitalWrite(PIN_BUZZER, HIGH);
    beepIsOn = true;
    beepChangedMs = now;
  }
}

static void setLamp(bool green) {
  digitalWrite(PIN_LED_GREEN, green ? HIGH : LOW);
  digitalWrite(PIN_LED_RED, green ? LOW : HIGH);
}

static void enter(GateState next) {
  state = next;
  stateSinceMs = millis();
}

// ------------------------------------------------------------- reporting ---
static void sendBoot() {
  Serial.print(F("B,gate,"));
  Serial.print(F(FW_VERSION));
  Serial.print(F(",0,0\n"));
}

static void sendNodeBeat() {
  Serial.print(F("H,gate,"));
  Serial.print(millis() / 1000UL);
  Serial.write('\n');
  lastNodeBeatMs = millis();
}

static void sendVehicle() {
  Serial.print(F("V,"));
  Serial.print(vehicleAtGate ? 1 : 0);
  Serial.write('\n');
}

static void sendAck() {
  Serial.print(F("A,"));
  Serial.print(cycleIsEntry ? F("entry") : F("exit"));
  Serial.print(',');
  Serial.print(cycleBooking);
  Serial.print(',');
  Serial.print(cycleSlot);
  Serial.write('\n');
}

// --------------------------------------------------------------- display ---
static void showIdleScreen() {
  char row1[17];
  if (vehicleAtGate) {
    showLcd("Show QR code", "to the camera");
    return;
  }
  if (freeSlots >= 0) {
    snprintf(row1, sizeof(row1), "Free %d of %d", freeSlots, totalSlots);
    showLcd("ParkGrid  Welcome", row1);
  } else {
    showLcd("ParkGrid", "Welcome");
  }
}

// ---------------------------------------------------------------- cycles ---
static void beginCycle(bool isEntry, long booking, long slot) {
  cycleIsEntry = isEntry;
  cycleBooking = booking;
  cycleSlot = slot;

  char label[3];
  char row1[17];
  slotLabel(slot, label);
  if (isEntry) {
    snprintf(row1, sizeof(row1), "Go to slot %s", label);
    showLcd("Welcome!", row1);
  } else {
    snprintf(row1, sizeof(row1), "Slot %s freed", label);
    showLcd("Goodbye!", row1);
  }
  startBeeps(1, 150, 0);
  setLamp(true);
  enter(OPENING);
  Serial.print(F("# barrier opening for "));
  Serial.print(isEntry ? F("entry") : F("exit"));
  Serial.print(F(", slot "));
  Serial.print(label);
  Serial.write('\n');
}

static void beginDeny(const char *reason) {
  char row1[17];
  strncpy(row1, reason, 16);
  row1[16] = 0;
  showLcd("Access denied", row1);
  startBeeps(3, 120, 120);
  digitalWrite(PIN_LED_RED, HIGH);
  digitalWrite(PIN_LED_GREEN, LOW);
  enter(DENIED);
  Serial.print(F("# access denied: "));
  Serial.print(reason);
  Serial.write('\n');
}

static void updateGate() {
  unsigned long now = millis();

  switch (state) {
    case IDLE:
      showIdleScreen();
      if (havePending) {
        havePending = false;
        beginCycle(pendingIsEntry, pendingBooking, pendingSlot);
      }
      break;

    case OPENING:
      if ((unsigned long)(now - lastServoStepMs) >= SERVO_STEP_MS) {
        lastServoStepMs = now;
        angle = min((uint8_t)(angle + ANGLE_STEP), ANGLE_OPEN);
        barrier.write(angle);
        if (angle >= ANGLE_OPEN) {
          beamClearSinceMs = now;
          enter(HOLDING);
        }
      }
      break;

    case HOLDING: {
      if (vehicleAtGate) beamClearSinceMs = now;
      bool held = (unsigned long)(now - stateSinceMs) >= HOLD_OPEN_MS;
      bool beamClear = (unsigned long)(now - beamClearSinceMs) >= CLEAR_BEAM_MS;
      bool timedOut = (unsigned long)(now - stateSinceMs) >= MAX_OPEN_MS;
      if ((held && beamClear) || timedOut) {
        if (timedOut) startBeeps(2, 200, 150);
        enter(CLOSING);
      }
      break;
    }

    case CLOSING:
      if (vehicleAtGate) {                      // a car rolled under the arm: go back up
        Serial.print(F("# beam blocked while closing, reopening\n"));
        beamClearSinceMs = now;
        enter(HOLDING);
        break;
      }
      if ((unsigned long)(now - lastServoStepMs) >= SERVO_STEP_MS) {
        lastServoStepMs = now;
        angle = angle > ANGLE_STEP + ANGLE_CLOSED ? angle - ANGLE_STEP : ANGLE_CLOSED;
        barrier.write(angle);
        if (angle <= ANGLE_CLOSED) {
          setLamp(false);
          sendAck();
          enter(IDLE);
        }
      }
      break;

    case DENIED:
      if (beepsLeft == 0 && (unsigned long)(now - stateSinceMs) >= DENY_SHOW_MS) {
        setLamp(false);
        enter(IDLE);
      }
      break;
  }
}

// ---------------------------------------------------------------- sensors ---
static void pollIr() {
  bool blocked = digitalRead(PIN_IR) == LOW;           // module pulls OUT low on an obstacle
  unsigned long now = millis();
  if (blocked != irRawBlocked) {
    irRawBlocked = blocked;
    irChangedMs = now;
  }
  if (irRawBlocked != vehicleAtGate && (unsigned long)(now - irChangedMs) >= IR_DEBOUNCE_MS) {
    vehicleAtGate = irRawBlocked;
    sendVehicle();
  }
}

// ---------------------------------------------------------- serial input ---
static void handleLine(const char *line) {
  if (line[0] == '?') {                                // gateway just (re)connected: announce ourselves again
    sendBoot();
    sendNodeBeat();
    return;
  }
  if (line[0] == 'G' && line[1] == ',') {              // G,entry,12,3
    bool isEntry = strncmp(line + 2, "entry", 5) == 0;
    const char *p = strchr(line + 2, ',');
    if (p == NULL) return;
    long booking = atol(p + 1);
    p = strchr(p + 1, ',');
    if (p == NULL) return;
    long slot = atol(p + 1);
    if (state == IDLE) {
      beginCycle(isEntry, booking, slot);
    } else {                                           // busy: remember the latest request
      havePending = true;
      pendingIsEntry = isEntry;
      pendingBooking = booking;
      pendingSlot = slot;
    }
  } else if (line[0] == 'D' && line[1] == ',') {       // D,Invalid QR code
    if (state == IDLE || state == DENIED) beginDeny(line + 2);
  } else if (line[0] == 'F' && line[1] == ',') {       // F,14,20
    freeSlots = atoi(line + 2);
    const char *p = strchr(line + 2, ',');
    totalSlots = p ? atoi(p + 1) : 0;
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
      rxLen = 0;
    }
  }
}

// --------------------------------------------------------------- Arduino ---
void setup() {
  Serial.begin(115200);

  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_IR, INPUT);
  digitalWrite(PIN_BUZZER, LOW);

  lcd.begin(16, 2);
  showLcd("ParkGrid gate", "starting...");

  // Lamp test + chirp, then park the arm in the closed position.
  digitalWrite(PIN_LED_GREEN, HIGH);
  digitalWrite(PIN_LED_RED, HIGH);
  startBeeps(1, 80, 0);
  barrier.attach(PIN_SERVO);
  barrier.write(ANGLE_CLOSED);
  nap(500);
  setLamp(false);

  sendBoot();
  sendNodeBeat();
  enter(IDLE);
}

void loop() {
  pollSerial();
  pollIr();
  updateBeeps();
  updateGate();
  if ((unsigned long)(millis() - lastNodeBeatMs) >= NODE_BEAT_MS) sendNodeBeat();
  nap(5);
}
