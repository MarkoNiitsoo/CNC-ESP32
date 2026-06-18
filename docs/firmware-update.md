# Firmware Update

## WebOTA Update

Use WebOTA when the pendant UI is reachable over WiFi.

1. Build firmware with PlatformIO.
2. Open the pendant web UI.
3. Go to `/update`.
4. Select `.pio-build/esp32cam/firmware.bin`.
5. Press `Upload Firmware`.
6. Wait for the success page and automatic reboot.

Do not update while the CNC is moving or cutting.

## SD Rescue Update

Use SD rescue update when WiFi, WebOTA, or the web UI is not reachable.

Copy the firmware binary to the SD card using exactly this path:

```text
/firmware/update.bin
```

Then create this marker file:

```text
/firmware/INSTALL.NOW
```

Reboot the ESP32-CAM. The firmware checks for the marker before starting WiFi or the web server.
The update only starts when both files exist.

Never rely on a root-level `firmware.bin`. The pendant will not automatically install:

```text
/firmware.bin
```

## SD Rescue Result Files

On success:

```text
/firmware/INSTALL.NOW is removed
/firmware/update.bin is renamed to /firmware/update.done.bin when possible
/logs/update.log records the result
```

On failure:

```text
/firmware/INSTALL.NOW is removed
/firmware/INSTALL.FAILED is written
/logs/update.log records the error
```

The device does not reboot-loop after a failed rescue update. It continues normal boot, so setup AP
fallback may still start.

## Recovering After Failure

1. Remove or inspect `/firmware/INSTALL.FAILED`.
2. Read `/logs/update.log`.
3. Replace `/firmware/update.bin` with a fresh PlatformIO `firmware.bin`.
4. Create `/firmware/INSTALL.NOW` again.
5. Reboot the ESP32-CAM.

