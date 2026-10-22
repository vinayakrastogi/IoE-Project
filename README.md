# ParkGrid - Smart Parking Allocation System

An IoT/IoE college project: an automated parking allocation system with pre-booking,
guest walk-in booking, QR-code gate entry/exit, and ML-driven peak-occupancy alerts.

The IoT layer runs **real firmware**: Arduino C++ sketches compiled with avr-gcc and
executed on an instruction-accurate AVR emulator (avr8js - the engine behind Wokwi),
wired to simulated HC-SR04 ultrasonic sensors, LEDs, a servo barrier, an IR beam, an
LCD and a buzzer, and bridged to MQTT by a Raspberry Pi-style gateway. No physical
boards are needed, but the `.hex` files in [firmware/build/](firmware/build/) are the
same bytes you would flash to an Arduino Uno. The backend, ML pipeline and frontend are
real, working systems.

The frontend is three views sharing one dark-themed app: a **user dashboard**
(book, get a QR, check history), a **Monitor control-room dashboard** (a live 3D scene
of the lot plus a human-readable activity log) and a **Hardware Lab** (the emulated
Arduino boards, their wiring, pins, serial traffic and firmware source, live).

The **Nearby Parking** map at `/nearby` uses Leaflet and OpenStreetMap to find
parking areas within 1, 3, or 5 km. It defaults to Bengaluru; **Use my location**
searches around the browser's location instead. Internet access is required for map
tiles and parking search. These community mapped locations do not include live
availability or operating hours.

## Screenshots

### User dashboard

Live slot status, booking controls, and the predicted occupancy curve.

![ParkGrid user dashboard with live parking slots and occupancy predictions](docs/screenshots/01-user-dashboard.png)

### 3D parking monitor

The control room shows the parking lot, vehicles, gate, and live sensor status in 3D.

![ParkGrid 3D parking monitor with occupied cars, slot indicators, and gate scanner](docs/screenshots/02-monitor-3d.png)

### Guest walk-in booking

Visitors can reserve a parking space without creating an account.

![ParkGrid guest kiosk for walk-in parking bookings](docs/screenshots/06-guest-kiosk-form.png)

## Why it's built this way (read this before your viva)

- **MQTT decouples "hardware" from the app.** The backend's MQTT worker
  ([backend/app/mqtt/worker.py](backend/app/mqtt/worker.py)) consumes
  `parking/sensor/+/status`, `parking/gate/ack` and `parking/node/+/status`, and the
  backend publishes retained `parking/slot/<n>/state` (LED colours) and
  `parking/gate/command`. It has no idea whether the other end is the emulated Arduinos
  behind [gateway/pi_gateway.py](gateway/pi_gateway.py) or real boards on a real
  Raspberry Pi - the gateway is the same script, only its serial ports change
  (`socket://hardware-lab:7001` vs `/dev/ttyUSB0`).
- **The firmware decides, not the simulator.** Each Arduino debounces its ultrasonic
  readings (median-of-3, a 30-40 cm hysteresis band, two confirming sweeps), sleeps
  between sweeps, drives its LEDs from the backend's slot state (falling back to its
  own sensor if the backend goes quiet) and refuses to lower the barrier over a vehicle.
  The emulator only supplies physics (distances, a car at the barrier); see
  [firmware/](firmware/) and `hardware-lab/test/` (the tests run the compiled firmware).
- **Three independent occupancy signals, reconciled by explicit rules.** A slot's
  status is touched by (a) the booking/QR flow (reserve -> gate scan -> occupied),
  (b) the ultrasonic sensors, and (c) operator actions. A gate scan flips the slot at
  once, but the car is still driving to its bay, so the sensor legitimately disagrees
  for a few seconds. The worker therefore keeps short *expected-transition windows*
  ([backend/app/services/transitions.py](backend/app/services/transitions.py)) and
  ignores readings that merely contradict a scan it just processed. See the
  reconciliation table in [backend/app/mqtt/worker.py](backend/app/mqtt/worker.py) -
  this was a real race condition found and fixed during integration testing (a fresh
  gate-scanned "occupied" slot was being undone by the next sensor tick within
  seconds). Worth mentioning if asked "what was the hardest bug?".
- **QR tokens are HMAC-signed, not just random IDs.** `POST /gate/scan` must reject a
  forged `booking_id=1` guess. See [backend/app/services/qr.py](backend/app/services/qr.py).
- **ML ships a Random Forest, but the notebook compares three approaches** (Linear
  Regression, Random Forest, LSTM) with a real, chronological (not random) train/test
  split, so the comparison is defensible rather than just "we picked one". See
  [ml/notebooks/eda_and_model_comparison.ipynb](ml/notebooks/eda_and_model_comparison.ipynb).
- **The Birmingham dataset trains the general diurnal *shape*, not our exact scale.**
  Its car parks have capacities in the hundreds/thousands; our simulated lot has ~20
  slots. `capacity_ratio` partially compensates, but [ml/retrain.py](ml/retrain.py)
  exists specifically to re-fit on our own accumulated `entry_logs` once there's
  enough real data, closing that gap. This is a real, acknowledged limitation, not
  something to gloss over.

## Architecture

```
 Arduino Uno x6 (emulated, real firmware)         Raspberry Pi gateway
 zone-a..e: 4 x HC-SR04 + 4 LEDs each     UART    gateway/pi_gateway.py
 gate: servo, IR beam, LCD, buzzer, LEDs ------->  serial frames <-> MQTT JSON
        ^                                                   |
        | physics: car distances, car at barrier            v
   hardware-lab (avr8js)                              mosquitto (MQTT)
                                                            |
                                                            v
                                          backend (FastAPI) MQTT worker -> Postgres
                                                            |  REST + WebSocket
                                       ml/models/*.joblib --+
                                                            v
                                               frontend (React + Tailwind)
                                        dashboard | monitor (3D) | hardware lab
```

| Layer | Tech | Where |
|---|---|---|
| Firmware | Arduino C++ (avr-gcc 7.3, arduino:avr core), Servo + LiquidCrystal libs | [firmware/](firmware/) |
| Hardware emulation | Node.js + avr8js (ATmega328P @ 16 MHz), HC-SR04 / servo / HD44780 models | [hardware-lab/](hardware-lab/) |
| Gateway (Raspberry Pi role) | Python + pyserial + paho-mqtt | [gateway/](gateway/) |
| Message bus | Mosquitto (MQTT) | [mosquitto/](mosquitto/) |
| Backend API | FastAPI + SQLAlchemy + Alembic + Postgres | [backend/](backend/) |
| ML | scikit-learn (RandomForest), UCI Birmingham dataset | [ml/](ml/) |
| Frontend | React + Vite + Tailwind + Recharts + Three.js + Wokwi elements | [frontend/](frontend/) |
| Legacy Python hardware stand-ins | paho-mqtt (opt-in profile) | [hardware-sim/](hardware-sim/) |

## Quickstart (one command)

Requires Docker + Docker Compose.

```bash
docker compose up --build
```

First run automatically:
1. Trains the ML models from the UCI Birmingham dataset (`ml-trainer` service,
   ~1-2 minutes; skipped on later runs since artifacts persist in `ml/models/`)
2. Runs Postgres migrations and seeds 20 parking slots
3. Starts the MQTT broker and the backend API
4. Boots the **IoT layer**: `hardware-lab` (six emulated Arduino Unos running the
   compiled firmware from [firmware/build/](firmware/build/)) and `pi-gateway` (the
   Raspberry Pi role: serial frames <-> MQTT)
5. Starts the frontend

Nothing changes on its own: slots only change because of what *you* do (bookings, gate
scans, Admin, or moving a virtual car in the Hardware Lab), which is what you want when
you're demoing it live yourself. The old Python traffic generators are an opt-in
profile; see "Demoing each piece" #1 if you want them for the ML prediction feature.

Then open:
- **Frontend**: http://localhost:5173 (Dashboard, Monitor, **Hardware Lab** at `/hardware`)
- **Backend API docs**: http://localhost:8000/docs
- **Backend health**: http://localhost:8000/health

Stop everything with `docker compose down` (add `-v` to also wipe the database and
Mosquitto's persisted state for a truly clean slate next time).

Optional `.env` (copy from [.env.example](.env.example)) to override default
credentials/secrets - fine to skip for a local demo.

## Demoing each piece (for your project defense)

### 1. The live slot map + WebSocket
Open the dashboard (sign up, then you land on it). The grid updates in real time -
a booking, a gate scan, an Admin action or a sensor reading updates Postgres and a
WebSocket broadcast pushes the change to every open browser tab. Open two browser
windows to show both update simultaneously.

The slot LEDs in the Hardware Lab follow the same state: free = green, booked = yellow
(red + green lit together), occupied = red. By default nothing changes on its own - the
lot only reacts to what you do.

**Generating "busy day" traffic for the ML demo.** The peak-prediction feature needs
occupancy to rise and fall over time. The original pure-Python traffic generators are
kept for exactly that, behind an opt-in profile. They publish on the same MQTT topics
as the gateway, so stop the hardware layer first:
```bash
docker compose stop hardware-lab pi-gateway
docker compose --profile simulation up -d sensor-sim gate-sim
docker compose logs -f sensor-sim          # shows the simulated clock (60x speed)
```
Switch back with `docker compose stop sensor-sim gate-sim && docker compose up -d hardware-lab pi-gateway`
(and **Admin -> Free All Slots** to clear whatever the generator left behind).

### 2. Booking + QR + gate entry (no physical scanner needed)
On the dashboard, click any **free** (green) slot, pick a time window, confirm.
You'll get a QR code. Two ways to "scan" it without real hardware:
- Click **Simulate Gate Scan** right under the QR code (fastest, always works).
- Go to **Gate Terminal** in the nav, and either point a webcam at the QR code
  rendered on another screen (real camera decode via `html5-qrcode`), or paste the
  raw token into the manual field.

Scan once for entry, scan again for exit. Watch what the hardware does:
- the slot's LED turns **yellow** the moment the booking is made;
- on the entry scan the gate LCD greets the driver, the servo lifts the barrier (watch it
  in **Hardware -> Gate**), a virtual car drives to the bay, the bay's HC-SR04 measures
  it closing in, the firmware reports it occupied and the LED turns **red**;
- the barrier will not come down while the IR beam is blocked by a vehicle;
- an invalid, forged or already-used QR code is rejected with "Access denied" on the
  LCD and three beeps;
- the exit scan frees the slot, the car leaves the bay, the LED turns green.
The raw conversation between the Arduinos and the gateway is visible in the serial
monitors on the Hardware page, or with `docker compose logs -f pi-gateway`.

### 3. Guest walk-in booking (no login)
Go to **Guest Kiosk** - this is the "kiosk at the gate" flow: name + phone + expected
duration, no account required. It auto-assigns the nearest free slot (lowest index).

### 4. ML peak-occupancy alerts
The dashboard's amber/green banner and the 24-hour chart come from
`GET /predictions/peak`, which loads the trained Random Forest from `ml/models/` and
projects occupancy forward hour-by-hour from the lot's current live state. To trigger
the amber "peak alert" banner, push the live lot past 85%: either park virtual cars in
17+ bays in the Hardware Lab, or run the opt-in Python traffic generator (section 1),
which drives occupancy toward ~90% around simulated midday.

To show the model comparison and evaluation behind it (for a viva question like "why
Random Forest?"), open [ml/notebooks/eda_and_model_comparison.ipynb](ml/notebooks/eda_and_model_comparison.ipynb)
in Jupyter - it's already executed with output cells (plots, metrics tables,
confusion matrix) so it's readable without re-running anything.

### 5. Booking history
**History** in the nav lists a logged-in user's past/current bookings and their
status (pending / active / completed / expired).

### 6. Monitor - the 3D control-room dashboard
**Monitor** in the nav is a second, ops-facing dashboard (no login required, so it
can be pulled up on its own screen) with two tabs:
- **3D View**: a live Three.js scene of the whole lot ([frontend/src/three/](frontend/src/three/)) -
  each slot is a colored LED (green free / amber booked / red occupied, matching the
  live WebSocket feed exactly like the 2D map), occupied slots show a parked car, and
  there's a gate with an animated boom plus a decorative camera prop at the entrance.
  Drag to orbit, scroll to zoom. Present a booking's QR to your webcam (or paste its
  token in the manual field) and watch the gate lift, the boom-camera's indicator
  light pulse while scanning, and a car drive from the gate to its assigned slot -
  the same `/gate/scan` call the Gate Terminal and QR page use, just with a visual
  payoff. The animation timing lives in
  [frontend/src/hooks/useCarAnimation.js](frontend/src/hooks/useCarAnimation.js);
  the 3D primitives themselves don't own any timing logic, they just render whatever
  progress value they're given (see the `AnimatedCar` contract).
- **Logs**: a live, human-readable activity feed - not raw MQTT payloads, summarized
  events like "Slot A1 booked by John Doe", "Slot A1: entry granted for booking #4
  (John Doe)", "Slot B2: ambient sensor detected departure", "Gate hardware
  acknowledged entry cycle for slot index 1". Backed by a new `system_events` table
  ([backend/app/models/system_event.py](backend/app/models/system_event.py)) and a
  second WebSocket channel (`/ws/events`, separate `ConnectionManager` instance from
  the slots one) so it doesn't interfere with the slot-map socket. Four categories:
  `booking`, `gate`, `sensor`, `hardware` - color-coded badges in the feed.

### 7. Hardware Lab - the IoT layer, live
**Hardware** in the nav (`/hardware`) shows the six emulated Arduino Uno boards:
- **Floor**: all 20 bays. The slider is the distance between a bay's ultrasonic sensor
  and whatever is in front of it; drag it below 30 cm (or press **Park car**) and watch
  the firmware measure it, debounce it, report it over serial, and the backend flip the
  slot. The LED shown is the Arduino's real output pin state. The gate card shows the
  LCD, the barrier and the IR beam, plus a toggle to send a car to the barrier.
- **Zone A-E**: the circuit of one controller - four HC-SR04 sensors and four LEDs wired
  to an Arduino Uno, drawn with Wokwi's open-source part library - with live LED colours,
  readings, a **reset button** (the firmware reboots and the gateway re-syncs it) and the
  serial monitor with every frame decoded into plain English.
- **Gate**: the barrier controller - servo, IR obstacle sensor, buzzer, stop/go lamps and
  a 16x2 LCD in 4-bit mode.
- **Firmware**: the sketch source, the serial protocol and the build instructions.

How it fits together (also a good viva answer): the sketches in [firmware/](firmware/) are
compiled by avr-gcc into ordinary Arduino Uno flash images. [hardware-lab/](hardware-lab/)
loads them into an AVR emulator (avr8js) and models the *outside world* only: a sensor
module that raises ECHO for 58 microseconds per centimetre after a trigger pulse, a servo
whose pulse width becomes an angle, an HD44780 controller, an IR beam. The firmware's
`pulseIn()`, `Servo`, `LiquidCrystal` and `Serial` calls all run unmodified. Its UART is
exposed on a TCP port, which [gateway/pi_gateway.py](gateway/pi_gateway.py) opens with
pyserial's `socket://` scheme - on a real Raspberry Pi the same script opens
`/dev/ttyUSB0`.

Run the emulator tests (they execute the compiled firmware against a simulated clock):
```bash
cd hardware-lab && npm install && npm test
```
Change the firmware: edit a sketch, run `firmware/build.sh` (compiles inside Docker,
nothing to install), then `docker compose restart hardware-lab`.

### 8. Admin Control - resetting the demo on the fly
**Admin** (the small shield icon at the far right of the nav, or go straight to
`/admin/dashboard`) lets you force any slot back to `free` - or free all 20 slots at
once - without waiting for an exit scan. Because the sensors are real firmware reading a
virtual world, an admin "free" also tows the virtual car out of the bay (the backend
publishes `parking/admin/slot_cleared`); otherwise the HC-SR04 would - correctly -
re-occupy the slot a moment later. Useful right before a live demo. Gated behind a shared token (`ADMIN_TOKEN` in the backend's
environment, default `123456789` - **change this before actually
deploying anywhere**), entered once and stored in the browser's `localStorage`. This
is a single-operator shared-secret, not per-user roles - appropriate for "the person
running the demo," not a multi-admin production system. Freeing a slot correctly
closes out whatever booking/entry-log was occupying it (cancelled if it never
checked in, completed with an exit timestamp if it had) and logs a `system` event,
so History and the Monitor Logs tab both stay consistent with what actually
happened.

### 9. Opening it from your phone (same WiFi)
The frontend dev server already binds `0.0.0.0`, and the frontend infers the
backend's address from whatever host it was itself loaded from (see
[frontend/src/api/client.js](frontend/src/api/client.js)) instead of hardcoding
`localhost` - so as long as your phone is on the **same WiFi/LAN** as the machine
running `docker compose`, no configuration is needed. On that machine, find its LAN
IP:
```bash
ipconfig getifaddr en0        # macOS, Wi-Fi
# or: hostname -I             # Linux
# or: ipconfig                # Windows, look for IPv4 Address
```
Then on your phone's browser, go to `http://<that-ip>:5173` (e.g.
`http://192.168.1.23:5173`). Use **Guest Kiosk** (no login needed) to book a slot and
get a QR code on your phone's screen, then on the laptop open **Gate Terminal** or
**Monitor**, click **Start Camera**, and show the phone's QR to the laptop's webcam.
Two things worth knowing:
- Camera access (`getUserMedia`) requires a "secure context." `http://localhost` is
  exempted from that requirement, so the **laptop** scanning via `http://localhost:5173`
  works fine - but if you ever open the scanner itself from a **non-localhost**
  address (e.g. testing the camera from the phone), most browsers will block camera
  access over plain HTTP. The phone in this workflow only needs to *display* a QR
  code, not scan one, so this doesn't come up in normal use.
- If the phone can't reach it, it's almost always a firewall or a "guest/isolated"
  WiFi network that blocks device-to-device traffic - check both devices are on the
  same (non-guest) network, and that your OS firewall allows incoming connections on
  ports 5173/8000.

## Running pieces individually (without Docker)

Useful if you want to iterate on one layer at a time.

**Backend** (needs a local Postgres + Mosquitto, or point at the Dockerized ones):
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql+psycopg2://parking:parking@localhost:5432/parking
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload
```

**ML training** (downloads the UCI Birmingham dataset on first run, caches it in
`ml/data/`):
```bash
cd ml
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt   # full set, includes Jupyter + TensorFlow for the notebook
python train.py
jupyter notebook notebooks/eda_and_model_comparison.ipynb
```
Retrain later on your own accumulated data once the app has logged enough real
entries/exits:
```bash
DATABASE_URL=postgresql+psycopg2://parking:parking@localhost:5432/parking python retrain.py
```

**IoT layer** (needs a running MQTT broker, e.g. `docker compose up -d mosquitto`):
```bash
# 1. compile the firmware (Docker; or skip - the .hex files are committed)
firmware/build.sh

# 2. the six emulated Arduinos (UARTs on tcp/7001-7005 and 7010, dashboard feed on :8090)
cd hardware-lab && npm install
MQTT_URL=mqtt://localhost:1883 FIRMWARE_DIR=../firmware npm start

# 3. the Raspberry Pi gateway, pointed at those sockets
cd gateway && pip install -r requirements.txt
MQTT_HOST=localhost \
GATEWAY_NODES="zone-a=socket://localhost:7001,zone-b=socket://localhost:7002,zone-c=socket://localhost:7003,zone-d=socket://localhost:7004,zone-e=socket://localhost:7005,gate=socket://localhost:7010" \
python pi_gateway.py
```
On a real Raspberry Pi you would give `GATEWAY_NODES` serial devices instead
(`zone-a=/dev/ttyUSB0,...,gate=/dev/ttyACM0`) and flash `firmware/build/*.hex` to the
boards with `avrdude`.

**Legacy Python hardware stand-ins** (the pre-firmware simulators, for traffic generation):
```bash
cd hardware-sim
pip install -r requirements.txt
python sensor_simulator.py --speed 360     # a full simulated day in ~4 minutes
python gate_simulator.py                   # in a second terminal
```

**Frontend**: http://localhost:5173 (Dashboard, Monitor, **Hardware Lab** at `/hardware`)
- **Backend API docs**: http://localhost:8000/docs
- **Backend health**: http://localhost:8000/health

Stop everything with `docker compose down` (add `-v` to also wipe the database and
Mosquitto's persisted state for a truly clean slate next time).

Optional `.env` (copy from [.env.example](.env.example)) to override default
credentials/secrets - fine to skip for a local demo.

## Demoing each piece (for your project defense)

### 1. The live slot map + WebSocket
Open the dashboard (sign up, then you land on it). The grid updates in real time -
a booking, a gate scan, an Admin action or a sensor reading updates Postgres and a
WebSocket broadcast pushes the change to every open browser tab. Open two browser
windows to show both update simultaneously.

The slot LEDs in the Hardware Lab follow the same state: free = green, booked = yellow
(red + green lit together), occupied = red. By default nothing changes on its own - the
lot only reacts to what you do.

**Generating "busy day" traffic for the ML demo.** The peak-prediction feature needs
occupancy to rise and fall over time. The original pure-Python traffic generators are
kept for exactly that, behind an opt-in profile. They publish on the same MQTT topics
as the gateway, so stop the hardware layer first:
```bash
docker compose stop hardware-lab pi-gateway
docker compose --profile simulation up -d sensor-sim gate-sim
docker compose logs -f sensor-sim          # shows the simulated clock (60x speed)
```
Switch back with `docker compose stop sensor-sim gate-sim && docker compose up -d hardware-lab pi-gateway`
(and **Admin -> Free All Slots** to clear whatever the generator left behind).

### 2. Booking + QR + gate entry (no physical scanner needed)
On the dashboard, click any **free** (green) slot, pick a time window, confirm.
You'll get a QR code. Two ways to "scan" it without real hardware:
- Click **Simulate Gate Scan** right under the QR code (fastest, always works).
- Go to **Gate Terminal** in the nav, and either point a webcam at the QR code
  rendered on another screen (real camera decode via `html5-qrcode`), or paste the
  raw token into the manual field.

Scan once for entry, scan again for exit. Watch what the hardware does:
- the slot's LED turns **yellow** the moment the booking is made;
- on the entry scan the gate LCD greets the driver, the servo lifts the barrier (watch it
  in **Hardware -> Gate**), a virtual car drives to the bay, the bay's HC-SR04 measures
  it closing in, the firmware reports it occupied and the LED turns **red**;
- the barrier will not come down while the IR beam is blocked by a vehicle;
- an invalid, forged or already-used QR code is rejected with "Access denied" on the
  LCD and three beeps;
- the exit scan frees the slot, the car leaves the bay, the LED turns green.
The raw conversation between the Arduinos and the gateway is visible in the serial
monitors on the Hardware page, or with `docker compose logs -f pi-gateway`.

### 3. Guest walk-in booking (no login)
Go to **Guest Kiosk** - this is the "kiosk at the gate" flow: name + phone + expected
duration, no account required. It auto-assigns the nearest free slot (lowest index).

### 4. ML peak-occupancy alerts
The dashboard's amber/green banner and the 24-hour chart come from
`GET /predictions/peak`, which loads the trained Random Forest from `ml/models/` and
projects occupancy forward hour-by-hour from the lot's current live state. To trigger
the amber "peak alert" banner, push the live lot past 85%: either park virtual cars in
17+ bays in the Hardware Lab, or run the opt-in Python traffic generator (section 1),
which drives occupancy toward ~90% around simulated midday.

To show the model comparison and evaluation behind it (for a viva question like "why
Random Forest?"), open [ml/notebooks/eda_and_model_comparison.ipynb](ml/notebooks/eda_and_model_comparison.ipynb)
in Jupyter - it's already executed with output cells (plots, metrics tables,
confusion matrix) so it's readable without re-running anything.

### 5. Booking history
**History** in the nav lists a logged-in user's past/current bookings and their
status (pending / active / completed / expired).

### 6. Monitor - the 3D control-room dashboard
**Monitor** in the nav is a second, ops-facing dashboard (no login required, so it
can be pulled up on its own screen) with two tabs:
- **3D View**: a live Three.js scene of the whole lot ([frontend/src/three/](frontend/src/three/)) -
  each slot is a colored LED (green free / amber booked / red occupied, matching the
  live WebSocket feed exactly like the 2D map), occupied slots show a parked car, and
  there's a gate with an animated boom plus a decorative camera prop at the entrance.
  Drag to orbit, scroll to zoom. Present a booking's QR to your webcam (or paste its
  token in the manual field) and watch the gate lift, the boom-camera's indicator
  light pulse while scanning, and a car drive from the gate to its assigned slot -
  the same `/gate/scan` call the Gate Terminal and QR page use, just with a visual
  payoff. The animation timing lives in
  [frontend/src/hooks/useCarAnimation.js](frontend/src/hooks/useCarAnimation.js);
  the 3D primitives themselves don't own any timing logic, they just render whatever
  progress value they're given (see the `AnimatedCar` contract).
- **Logs**: a live, human-readable activity feed - not raw MQTT payloads, summarized
  events like "Slot A1 booked by John Doe", "Slot A1: entry granted for booking #4
  (John Doe)", "Slot B2: ambient sensor detected departure", "Gate hardware
  acknowledged entry cycle for slot index 1". Backed by a new `system_events` table
  ([backend/app/models/system_event.py](backend/app/models/system_event.py)) and a
  second WebSocket channel (`/ws/events`, separate `ConnectionManager` instance from
  the slots one) so it doesn't interfere with the slot-map socket. Four categories:
  `booking`, `gate`, `sensor`, `hardware` - color-coded badges in the feed.

### 7. Hardware Lab - the IoT layer, live
**Hardware** in the nav (`/hardware`) shows the six emulated Arduino Uno boards:
- **Floor**: all 20 bays. The slider is the distance between a bay's ultrasonic sensor
  and whatever is in front of it; drag it below 30 cm (or press **Park car**) and watch
  the firmware measure it, debounce it, report it over serial, and the backend flip the
  slot. The LED shown is the Arduino's real output pin state. The gate card shows the
  LCD, the barrier and the IR beam, plus a toggle to send a car to the barrier.
- **Zone A-E**: the circuit of one controller - four HC-SR04 sensors and four LEDs wired
  to an Arduino Uno, drawn with Wokwi's open-source part library - with live LED colours,
  readings, a **reset button** (the firmware reboots and the gateway re-syncs it) and the
  serial monitor with every frame decoded into plain English.
- **Gate**: the barrier controller - servo, IR obstacle sensor, buzzer, stop/go lamps and
  a 16x2 LCD in 4-bit mode.
- **Firmware**: the sketch source, the serial protocol and the build instructions.

How it fits together (also a good viva answer): the sketches in [firmware/](firmware/) are
compiled by avr-gcc into ordinary Arduino Uno flash images. [hardware-lab/](hardware-lab/)
loads them into an AVR emulator (avr8js) and models the *outside world* only: a sensor
module that raises ECHO for 58 microseconds per centimetre after a trigger pulse, a servo
whose pulse width becomes an angle, an HD44780 controller, an IR beam. The firmware's
`pulseIn()`, `Servo`, `LiquidCrystal` and `Serial` calls all run unmodified. Its UART is
exposed on a TCP port, which [gateway/pi_gateway.py](gateway/pi_gateway.py) opens with
pyserial's `socket://` scheme - on a real Raspberry Pi the same script opens
`/dev/ttyUSB0`.

Run the emulator tests (they execute the compiled firmware against a simulated clock):
```bash
cd hardware-lab && npm install && npm test
```
Change the firmware: edit a sketch, run `firmware/build.sh` (compiles inside Docker,
nothing to install), then `docker compose restart hardware-lab`.

### 8. Admin Control - resetting the demo on the fly
**Admin** (the small shield icon at the far right of the nav, or go straight to
`/admin/dashboard`) lets you force any slot back to `free` - or free all 20 slots at
once - without waiting for an exit scan. Because the sensors are real firmware reading a
virtual world, an admin "free" also tows the virtual car out of the bay (the backend
publishes `parking/admin/slot_cleared`); otherwise the HC-SR04 would - correctly -
re-occupy the slot a moment later. Useful right before a live demo. Gated behind a shared token (`ADMIN_TOKEN` in the backend's
environment, default `123456789` - **change this before actually
deploying anywhere**), entered once and stored in the browser's `localStorage`. This
is a single-operator shared-secret, not per-user roles - appropriate for "the person
running the demo," not a multi-admin production system. Freeing a slot correctly
closes out whatever booking/entry-log was occupying it (cancelled if it never
checked in, completed with an exit timestamp if it had) and logs a `system` event,
so History and the Monitor Logs tab both stay consistent with what actually
happened.

### 9. Opening it from your phone (same WiFi)
The frontend dev server already binds `0.0.0.0`, and the frontend infers the
backend's address from whatever host it was itself loaded from (see
[frontend/src/api/client.js](frontend/src/api/client.js)) instead of hardcoding
`localhost` - so as long as your phone is on the **same WiFi/LAN** as the machine
running `docker compose`, no configuration is needed. On that machine, find its LAN
IP:
```bash
ipconfig getifaddr en0        # macOS, Wi-Fi
# or: hostname -I             # Linux
# or: ipconfig                # Windows, look for IPv4 Address
```
Then on your phone's browser, go to `http://<that-ip>:5173` (e.g.
`http://192.168.1.23:5173`). Use **Guest Kiosk** (no login needed) to book a slot and
get a QR code on your phone's screen, then on the laptop open **Gate Terminal** or
**Monitor**, click **Start Camera**, and show the phone's QR to the laptop's webcam.
Two things worth knowing:
- Camera access (`getUserMedia`) requires a "secure context." `http://localhost` is
  exempted from that requirement, so the **laptop** scanning via `http://localhost:5173`
  works fine - but if you ever open the scanner itself from a **non-localhost**
  address (e.g. testing the camera from the phone), most browsers will block camera
  access over plain HTTP. The phone in this workflow only needs to *display* a QR
  code, not scan one, so this doesn't come up in normal use.
- If the phone can't reach it, it's almost always a firewall or a "guest/isolated"
  WiFi network that blocks device-to-device traffic - check both devices are on the
  same (non-guest) network, and that your OS firewall allows incoming connections on
  ports 5173/8000.

## Running pieces individually (without Docker)

Useful if you want to iterate on one layer at a time.

**Backend** (needs a local Postgres + Mosquitto, or point at the Dockerized ones):
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql+psycopg2://parking:parking@localhost:5432/parking
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload
```

**ML training** (downloads the UCI Birmingham dataset on first run, caches it in
`ml/data/`):
```bash
cd ml
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt   # full set, includes Jupyter + TensorFlow for the notebook
python train.py
jupyter notebook notebooks/eda_and_model_comparison.ipynb
```
Retrain later on your own accumulated data once the app has logged enough real
entries/exits:
```bash
DATABASE_URL=postgresql+psycopg2://parking:parking@localhost:5432/parking python retrain.py
```

**Hardware simulation** (needs a running MQTT broker, e.g. `docker compose up mosquitto`):
```bash
cd hardware-sim
pip install -r requirements.txt
python sensor_simulator.py --speed 360     # a full simulated day in ~4 minutes
python gate_simulator.py                   # in a second terminal
```

**Frontend**:
```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_URL (default http://localhost:8000), VITE_LAB_URL (default http://localhost:8090)
npm run dev
```

## API reference

Full interactive docs at `/docs` (Swagger UI) once the backend is running. Summary:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/signup` | - | Create account, returns JWT |
| POST | `/auth/login` | - | Login (OAuth2 form), returns JWT |
| GET | `/auth/me` | JWT | Current user |
| POST | `/bookings` | JWT | Book a specific free slot, returns QR token |
| POST | `/bookings/guest` | - | Walk-in booking, auto-assigns nearest free slot |
| GET | `/bookings/me` | JWT | Booking history |
| POST | `/gate/scan` | - | Validate QR, toggle entry/exit, publish gate-open over MQTT |
| GET | `/slots` / `/slots/live` | - | Current slot map snapshot |
| GET | `/predictions/peak` | - | ML-predicted occupancy curve for the next N hours |
| WS | `/ws/slots` | - | Live slot map push updates |
| GET | `/events/recent` | - | Last N human-readable system events (Monitor's Logs tab) |
| WS | `/ws/events` | - | Live event feed push updates |
| GET | `/admin/slots` | Admin token | All slots with occupant/booking info |
| POST | `/admin/slots/{id}/free` | Admin token | Force one slot back to free |
| POST | `/admin/slots/reset-all` | Admin token | Force every slot back to free |

## MQTT contract

| Topic | From -> to | Payload | Notes |
|---|---|---|---|
| `parking/sensor/<slot>/status` | gateway -> backend | `{sensor_id, node, slot_index, distance_cm, occupied, timestamp}` | one per bay, on change and every 5 s |
| `parking/slot/<slot>/state` | backend -> gateway | `{slot_index, label, status}` | **retained**; status is `free` / `booked` / `occupied`, the node turns it into LED colours |
| `parking/gate/command` | backend -> gateway | `{action: "open", direction, booking_id, slot_index}` or `{action: "deny", reason}` | open the barrier / reject with a 16-character reason |
| `parking/gate/ack` | gateway -> backend | `{booking_id, slot_index, direction, status}` | barrier cycle finished |
| `parking/gate/vehicle` | gateway -> anyone | `{present}` | IR beam |
| `parking/node/<id>/status` | gateway -> backend | `{node, online, event, firmware, first_slot, slots, uptime_s}` | **retained**; boot / heartbeat |
| `parking/admin/slot_cleared` | backend -> world | `{slot_index}` | an operator forced the slot free |

The Arduino-to-gateway serial frames (`S,3,1,12.4`, `L,3,b`, `G,entry,12,3`, ...) are
documented at the top of [gateway/pi_gateway.py](gateway/pi_gateway.py) and in each sketch.

## Data model

- **User** - email/password (bcrypt), JWT auth
- **Slot** - index, label, location, status (`free` / `booked` / `occupied`)
- **Booking** - user (nullable for guests), slot, time window, signed `qr_token`,
  status (`pending` / `active` / `completed` / `cancelled` / `expired`)
- **EntryLog** - booking, entry/exit timestamps
- **SystemEvent** - timestamp, category (`booking` / `gate` / `sensor` / `hardware`),
  human-readable message, optional structured `meta`

Migrations live in [backend/alembic/versions/](backend/alembic/versions/).

## Repo structure

```
firmware/       Arduino sketches (zone + gate controllers), Docker-based build, prebuilt .hex
hardware-lab/   Node.js emulator: avr8js + HC-SR04/servo/LCD models, world, UART bridge, tests
gateway/        Raspberry Pi gateway: serial frames <-> MQTT (Python, pyserial + paho)
backend/        FastAPI app, MQTT worker, SQLAlchemy models, Alembic migrations
ml/             Training script, retrain script, EDA/model-comparison notebook, saved models
frontend/       React + Tailwind: dashboard, guest kiosk, gate terminal, monitor, hardware lab
hardware-sim/   Legacy pure-Python MQTT traffic generators (opt-in profile)
mosquitto/      Mosquitto broker config
docs/           Project documentation (markdown) and presentation (pptx)
docker-compose.yml
```

## Known limitations (good viva answers, not oversights)

- Single backend process: the WebSocket fan-out and MQTT publisher are in-process,
  so this doesn't horizontally scale as-is (see docstring in
  [backend/app/services/ws_manager.py](backend/app/services/ws_manager.py)). Fine
  for a single-lot demo; would move to Redis pub/sub for multi-instance deployment.
- The ML model's `capacity_ratio` feature only partially compensates for the scale
  gap between Birmingham's large lots and our small simulated one - see
  [ml/retrain.py](ml/retrain.py)'s docstring.
- No rate limiting / account lockout on auth endpoints - out of scope for a college
  demo, would matter for production.
- **The "hardware" is emulated, not built.** The firmware is real and flashable, but
  what it senses and drives is modelled in software: the HC-SR04 echo timing, servo pulse
  measurement and HD44780 protocol are accurate to the microsecond because the CPU is
  emulated cycle by cycle, but acoustics, noise, power and mechanical behaviour are not.
- **Arduino Uno nodes, not ESP32.** An Uno has no network interface, hence the Raspberry
  Pi gateway. We evaluated ESP32 emulation (Wokwi, Velxio/QEMU): Wokwi's local-network
  gateway and offline mode are paid features, and the QEMU-based ESP32 emulators run
  10-50x slower than real time, which breaks HC-SR04 timing. An ESP32 port would publish
  the same JSON straight to MQTT and drop the gateway hop; the firmware logic carries over.
- **One lane for the barrier.** Entry and exit share one barrier and one IR beam; a real
  site would have a lane (and a controller) per direction.
- The lab serves control messages (`park`, `leave`, `distance`) over an unauthenticated
  WebSocket on port 8090 - fine for a local demo, not for a shared network.
