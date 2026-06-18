# Setup

## PlatformIO

PlatformIO was found in the VS Code-managed environment:

```powershell
C:\Users\marko\.platformio\penv\Scripts\pio.exe
```

If `pio` is not available on PATH, run PlatformIO with the full path:

```powershell
& 'C:\Users\marko\.platformio\penv\Scripts\pio.exe' run
& 'C:\Users\marko\.platformio\penv\Scripts\pio.exe' run --target uploadfs
& 'C:\Users\marko\.platformio\penv\Scripts\pio.exe' run --target upload
```

The web files in `data/` are stored in SPIFFS, so upload the filesystem image with
`uploadfs` as well as the firmware.

## Flashing Reminder

UART0 uses GPIO1 and GPIO3 for Marlin communication. If flashing fails, disconnect the SKR Pro
UART6 wiring from ESP32-CAM GPIO1/GPIO3 while programming.

