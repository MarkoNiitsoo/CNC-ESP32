# Device configuration and local discovery

The pendant uses `http://cnc.local` by default. No device configuration is required for a
single-machine installation.

## SD configuration

For multiple machines, create `/esp32-cnc/config.json` on the ESP32 SD card:

```json
{
  "device": {
    "hostname": "g-code-cnc",
    "friendlyName": "Workshop G-code CNC"
  },
  "bluetooth": {
    "enabled": true,
    "advertiseName": true
  }
}
```

The legacy fallback location `/config.json` is read only when the preferred file is absent.
The hostname is stored without `.local`; the example above is advertised as
`http://g-code-cnc.local`.

Hostname handling is deliberately conservative:

- Uppercase is converted to lowercase.
- Spaces, underscores, dots, and other unsupported characters become a single hyphen.
- Leading and trailing hyphens are removed.
- A trailing `.local` is removed, so `cnc.local` becomes `cnc`.
- DNS labels are limited to 63 characters.
- An empty result becomes `esp32-cnc-<deviceId>`, using the lowercase MAC suffix.

`friendlyName` is display text and may contain spaces. Both fields must be non-empty strings and
the JSON must match the documented minimal structure. A malformed, oversized, or incomplete file
is ignored safely.

The `bluetooth` object is optional. When omitted, both flags default to `true`. When present, both
flags must be JSON booleans. Valid Bluetooth settings are cached with the device identity in NVS.

## Startup priority

1. Valid SD configuration.
2. Last valid SD identity cached in Preferences/NVS namespace `device`.
3. Firmware defaults: hostname `cnc`, friendly name `ESP32 CNC`.

A valid SD configuration updates NVS. The machine therefore keeps its last known identity if the
SD card is later removed. Invalid SD JSON does not overwrite NVS.

The Settings > Machine Identity panel updates NVS and then attempts to replace the preferred SD
configuration through a temporary file and backup. If SD is absent or read-only, the UI reports a
warning but the NVS identity remains saved. Hostname and friendly-name changes take effect after a
safe restart. Editing and restart are disabled while a job is active or paused.

## Discovery and API

The selected hostname advertises `_http._tcp` and `_esp32cnc._tcp` on port 80 through mDNS.
`GET /api/device` returns the public device identity, current IP/mode, and mDNS state. It never
returns WiFi passwords or other private configuration values.

mDNS depends on client/network support. If `<hostname>.local` does not resolve, use the IP shown by
the router or setup AP and inspect `/api/device`.

## BLE helper label

BLE is not a CNC control channel. It broadcasts a non-connectable, human-readable label so a phone
can help identify the nearby pendant:

- STA mode: `CNC cnc.local` or `CNC <hostname>.local`.
- Setup AP mode: `CNC 192.168.4.1`.
- Long names shorten to `CNC <hostname>` and finally `CNC-<deviceId>`.

BLE starts after the web stack and is skipped under low-memory conditions. The firmware can also
be built with `ESP32CNC_ENABLE_BLE=0`. The lightweight NimBLE stack is used to reduce RAM and flash
pressure. Either case leaves WiFi, mDNS, and HTTP operational.
