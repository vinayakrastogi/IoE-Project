import os

MQTT_HOST = os.environ.get("MQTT_HOST", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_KEEPALIVE = int(os.environ.get("MQTT_KEEPALIVE", "60"))

TOTAL_SLOTS = int(os.environ.get("TOTAL_SLOTS", "20"))

# Must match backend/app/config.py's topic_* settings.
TOPIC_SENSOR_PREFIX = "parking/sensor"  # -> parking/sensor/{slot_index}/status
TOPIC_GATE_COMMAND = "parking/gate/command"
TOPIC_GATE_ACK = "parking/gate/ack"

# Ultrasonic threshold, mirroring a real HC-SR04 firmware: closer than this
# means "something is parked in front of the sensor".
OCCUPIED_DISTANCE_THRESHOLD_CM = 30.0
