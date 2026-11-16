# CNC-ESP32 protsesside olekumasinad

Süsteemi põhiprotsesside olekumasinad tegeliku koodi põhjal ([src/main.cpp](../src/main.cpp), [www/preview.js](../www/preview.js), [www/machine-bar.js](../www/machine-bar.js), [www/lib/job-readiness.js](../www/lib/job-readiness.js), [www/lib/job-recovery.js](../www/lib/job-recovery.js)).

---

## 1. Töövoog UI-s (`Job Readiness` 5 sammu)

```mermaid
flowchart LR
  S1["1. Home<br/>(G28 -> usaldusväärne masina null)"] --> S2["2. Place & Safe Z<br/>(paigutus, .run.gc auto-uuendus,<br/>Safe Z lae kontroll)"]
  S2 --> S3["3. Zero XY/Z<br/>(Set Work Zero / Set Z Zero<br/>või Restore Zero)"]
  S3 --> S4["4. Check<br/>(Run Bounds Check / Run Full Aircut<br/>või Continue Without Check)"]
  S4 --> S5["5. Cut<br/>(Authorize & Start Job)"]
  S5 -->|"Lõige pooleli / Stop"| REC["Recovery / Resume<br/>(katkenud töö jätkamine)"]
```

---

## 2. Töö mootori olekumasin (`JobRunnerState` — `src/main.cpp`)

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Preparing : POST /api/job/start (või /api/test-motion/start)
  Preparing --> Running : Eeltöö ja Safe Z lift ok
  Preparing --> Stopped : Stop enne algust (ABORTED_BY_STOP)
  Preparing --> Error : Fail / Safe Z / kaadri viga

  Running --> Pausing : Pause (/api/job/pause)
  Running --> Stopping : Stop (/api/job/stop -> M410 + M5)
  Running --> Completed : Kõik read kinnitatud (EOF)
  Running --> Error : Marlin viga / sidekatkestus

  Pausing --> PausedIntact : Realtime hold (P000) aktiivne
  Pausing --> Paused : Käsurea piiril pausitud
  Pausing --> Stopping : Stop pausimise ajal

  PausedIntact --> Resuming : Resume (/api/job/resume)
  PausedIntact --> RecoveryRequired : Käsitsi liigutamine (interrupt-for-manual-motion)
  Paused --> Resuming : Resume
  Paused --> RecoveryRequired : Käsitsi liigutamine / M6 tööriistavahetus
  Resuming --> Running : Puhver / liikumine taastatud

  Stopping --> Stopped : M410 + M5 lõpetatud
  Stopping --> Error : M410 ebaõnnestus

  Stopped --> RecoveryRequired : Katkenud lõige (checkpoint olemas)
  Error --> RecoveryRequired : Katkenud lõige (checkpoint olemas)
  Completed --> Idle : Järgmine töö / Reset
  Stopped --> Idle : Järgmine töö / Reset
  RecoveryRequired --> Idle : Taastamine lõpetatud või hüljatud
```

---

## 3. Joggingu olekumasin (`JogState` — `src/main.cpp`)

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> PreparingSafeZ : Jog start (Safe=true, Z pole veel Safe Z kõrgusel)
  Idle --> Jogging : Jog start (Safe=false või Z juba Safe Z kõrgusel)

  PreparingSafeZ --> Jogging : Safe Z tõste (G0 Z) valmis, originalZ salvestatud
  PreparingSafeZ --> Stopping : Jog stop / heartbeat timeout
  PreparingSafeZ --> Error : Marlin viga / sidekatkestus

  Jogging --> Jogging : Jog update (uus X/Y/Z kiirusvektor, G91 sammud)
  Jogging --> Stopping : Nupp vabastati / blur / heartbeat timeout
  Jogging --> Error : Marlin viga / limiit / sidekatkestus

  Stopping --> Idle : Liikumine peatatud (G90 taastatud, zRestoreAvailable kui Z ei muutunud)
  Error --> Idle : Viga lähtestatud / järgmine käsk

  Idle --> Idle : Restore Z (tagasi originalZ peale, kui zRestoreAvailable=true)
```

---

## 4. Katkenud töö taastamine (`Recovery` — `www/lib/job-recovery.js` & `src/main.cpp`)

```mermaid
stateDiagram-v2
  [*] --> saved_for_later : Katkenud lõige (stopped / interrupted / error)
  saved_for_later --> needs_home : Masin pole homitud (trusted=false)
  needs_home --> needs_work_zero_restore : Home All tehtud
  saved_for_later --> needs_work_zero_restore : Work Zero kadunud või teine epoch
  needs_work_zero_restore --> needs_z_zero : Work Zero taastatud
  needs_z_zero --> material_confirmation_required : Z Zero kinnitatud
  saved_for_later --> position_untrusted : Positsioon pole usaldusväärne
  saved_for_later --> file_missing : G-kood puudub
  saved_for_later --> execution_file_changed : Run-faili fingerprint muutus
  saved_for_later --> material_confirmation_required : Kaader + fail kehtivad
  material_confirmation_required --> ready : Operaator kinnitas tooriku ja tööriista

  ready --> Phase1_Move : /api/recovery/production/start (Safe Z -> jätkamispunkti XY)
  Phase1_Move --> Phase2_Cut : Safe Z & XY kinnitatud -> jätka G-koodi streamimist
  Phase2_Cut --> recovery_completed : Lõige edukalt lõpetatud

  saved_for_later --> abandoned : Kasutaja hülgab taastamise
  saved_for_later --> marked_finished : Kasutaja märgib lõpetatuks
```

---

## 5. Kontrolleri side ja taastamine (`ControllerCommunicationState`)

```mermaid
stateDiagram-v2
  [*] --> Connected
  Connected --> Waiting : Käsk saadetud Marlinile (M400 / liikumine / M114)
  Waiting --> Connected : OK / vastus saadud
  Waiting --> Unresponsive : ACK watchdog timeout (kordusproovita)
  Unresponsive --> Recovering : Auto-recovery või /api/controller/recover
  Recovering --> Connected : Marlin vastas (identiteet + M114 taastatud)
  Recovering --> Unresponsive : Taastamine ebaõnnestus
```

---

## 6. Wi-Fi käivitus ja taustaühendus (`AP + STA`)

```mermaid
stateDiagram-v2
  [*] --> AP_Only : Ruuteri SSID puudub (192.168.4.1)
  [*] --> AP_STA_Connecting : Ruuteri SSID olemas (G-code-CNC-Setup + STA)
  AP_STA_Connecting --> AP_STA_Connected : Ruuter vastas 15 s sees
  AP_STA_Connecting --> AP_STA_BgRetry : 15 s timeout (AP jääb üles)
  AP_STA_BgRetry --> AP_STA_Connected : Taustaproov iga 20 s (kui töö/jog ei käi)
  AP_STA_Connected --> STA_Only : 12 s ooteaeg (või 3 s kui 0 AP klienti) -> AP välja
```
