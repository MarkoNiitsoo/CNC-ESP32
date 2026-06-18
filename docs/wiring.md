# Wiring

## ESP32-CAM

- Board: AI-Thinker ESP32-CAM.
- Power: 5V input from an external buck converter.
- Ground: common GND with the BTT SKR Pro.
- Camera: not initialized or used in the MVP.

## Marlin UART

The ESP32-CAM uses UART0:

| Signal | ESP32-CAM Pin | SKR Pro UART1 |
| --- | --- | --- |
| ESP TX | GPIO1 | RX1 |
| ESP RX | GPIO3 | TX1 |
| GND | GND | GND |

Default baudrate: `250000`.

Marlin should expose this as serial port `1`, usually as the secondary serial port if USB remains
the primary Marlin console.

Note: GPIO1 and GPIO3 are also the normal USB/programming serial pins. Disconnect or isolate
the SKR Pro UART connection when flashing if the programmer cannot communicate reliably.
