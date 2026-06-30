# Local Mock Development Server

## Purpose

The mock server runs the existing `www/` application on a desktop without an ESP32, SD card,
Marlin controller, or CNC machine. It is development and workflow simulation only.

It never opens a serial port. Production firmware and `src/` behavior are unchanged.

## Start

From the repository root:

```powershell
npm install
npm run dev:mock
```

Open:

```text
http://localhost:8097
```

The server listens on `0.0.0.0` by default so phones, tablets, and headsets on the same private LAN
can open the URL printed as `LAN:`. For example:

```text
http://192.168.8.142:8097
```

The LAN address may change when DHCP reconnects. Use the address printed by `npm run dev:mock`.
Windows Firewall may ask whether Node.js may accept private-network connections; allow only Private
networks. Do not expose this server to the internet or a public/untrusted network: mock file and
command APIs have no authentication.

The terminal prints:

```text
CNC-ESP32 mock dev server
UI: http://localhost:8097
LAN: http://192.168.8.142:8097
Mock SD: dev/mock-sd
Mode: DEV MOCK - NO REAL MACHINE
```

Every locally served page shows a small yellow `DEV MOCK` badge beside machine state/XYZ. Its title
retains `DEV MOCK - NO REAL MACHINE`. If that badge is absent, do not assume the page is connected
to the simulator.

## Mock SD

Persistent runtime files are stored under:

```text
dev/mock-sd/gcode
dev/mock-sd/jobs
dev/mock-sd/jobs/generated
dev/mock-sd/jobs/thumbs
dev/mock-sd/logs
dev/mock-sd/firmware
dev/mock-sd/www
```

The web application itself is served directly from repository `www/`, so code edits appear after a
browser refresh. Mock `/www` file API storage is separate to prevent file-manager tests from
rewriting source files.

Reset mock SD and restore samples:

```powershell
npm run dev:mock:reset
```

The reset deletes mock runtime state only. It does not touch repository `www/`, firmware, or test
fixtures.

## Sample Jobs

- `safe-square.gc`: small metric square inside configured limits.
- `safe-rectangle.gc`: small metric rectangle inside configured limits.
- `negative-x-offset.gc`: intentionally moves below X0.
- `out-of-bounds.gc`: intentionally exceeds X maximum.
- `dangerous-z-dive.gc`: intentionally moves below configured Z minimum.

Samples are created only when missing, so uploaded files and job JSON persist across normal restarts.

## Supported APIs

The mock server implements the API contracts used by the current UI:

- `GET /api/health`
- `GET /api/ui/status`
- `GET /api/sd/status`
- `GET /api/files`
- `GET /api/download`
- `POST /api/upload`
- `POST /api/delete`
- `POST /api/mkdir`
- `POST /api/rename`
- `POST /api/cmd`
- `GET /api/marlin/log`
- `GET /api/job/status`
- `POST /api/job/start`
- `POST /api/job/pause`
- `POST /api/job/resume`
- `POST /api/job/stop`
- `POST /api/job/feed-override`
- `POST /api/jog/start`, `/api/jog/update`, and `/api/jog/stop`
- `GET /api/jog/status`
- `POST /api/work-zero/goto`

Unknown `/api/*` paths return HTTP 501 with a clear mock TODO response.

## Mock Marlin

Supported commands include:

- `M115`, `M114`, `M119`
- `G20`, `G21`, `G90`, `G91`, `G17`, `G54` through `G59.3`
- `G92 X/Y/Z`
- `G0` and `G1` with X/Y/Z/F
- `M3`, `M4`, `M5`, `M220`, `M400`, `M410`

The simulator tracks work position, G92 offset, units, coordinate mode, feed, feed override,
workspace, spindle/laser state, endstops, and recent command/response log.

## Safety Simulation

Limits come from `dev/mock-config.json`. The default work area is X 0..1625, Y 0..5800, and
Z -30..120 mm.

- X/Y/Z outside configured limits returns `Mock soft limit exceeded` and sets a running job to
  `ERROR`.
- `G28` is rejected as unexpected unless `allowHoming` is deliberately enabled for a test.
- `G53` is rejected as unexpected.
- Non-default G55+ workspace commands are blocked by the job runner unless job metadata explicitly
  allows them.
- No automatic homing, zero restore, resume, or recovery is simulated.

These checks test application behavior. They are not proof that a real machine is safe.

## Job Runner Model

The mock runner reads the same uploaded job JSON and uses the shared active-run invariant from
`www/lib/job-active-run.js`.

- Job JSON must be `ARMED`.
- Requested path and mode must equal the armed `activeRun`.
- Generated jobs must be valid and not dirty, stale, missing, or fingerprint-mismatched.
- The runner streams exactly `activeRun.path`; it never silently falls back to source G-code.
- Status exposes firmware-shaped line, byte, progress, response, error, and feed-override fields.
- Pause, Resume, Stop, M5, and M220 are deterministic simulations rather than motion physics.

## Limitations

- Motion timing and acceleration are not physically accurate.
- G2/G3 preview remains browser-side; MockMarlin treats unsupported commands as acknowledged mock
  commands rather than simulating arc motion.
- Mock jog advances the simulated position in short relative ticks and applies heartbeat expiry;
  it does not model real acceleration, inertia, or delayed Z restore timing.
- WiFi, OTA, camera, GPIO, UART, and real SD hardware are not simulated.
- Resume/recovery is not implemented.
- Browser confirmations still appear because the production UI is being exercised unchanged.

Run automated checks with:

```powershell
npm.cmd test
```
