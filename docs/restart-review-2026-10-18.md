# Projekti uus ülevaatus - 18.10.2026

## Kus töö praegu on

Projekt pole algusjärgus: olemas on failihaldus, eelvaade, töö nullpunkt, kontrollitud käivitus,
peatamine ja taastamine. Septembri viimased muudatused puudutasid nullpunkti kinnitamist ning
Home'i ajal peatamist. Vanade töömärkmete algus oli koodist maha jäänud.

Selle ülevaatuse käigus parandatud:

- Simulaator saatis kontrolleri ühenduse olekuks töö oleku `idle`. Veebiliides keelas seetõttu
  Home'i ja muud tavalised käsud. Nüüd edastatakse ühenduse tegelik olek.
- Home'i/nullimise järel saadeti poolik masina olek, mis asendas brauseris terve oleku.
  Nüüd on algseisu ja uuenduste andmekuju sama.
- Püsivara võis lugeda `Error:` või `Alarm:` vastuse edukaks ja jätkata Home'i/nullimise
  järgmist sammu. Ühine veatuvastus käsitleb nüüd ka erinevat tähesuurust.
- Simulaator uuendab nüüd brauserit ka HTTP käskude ja taustal muutuva töö oleku korral.
- Simulaatoris töötab ka püsivara kasutatav `/preview` aadress.

Kontrollitud: automaattestid, püsivara C++ testid ja ESP32-CAM koostamine. Brauseris avanes
näidistöö ning Home All nupp oli kasutatav. Kogu Home -> Zero -> Start jada jäi brauseri
kinnitusdialoogi automatiseerimise vea tõttu kontrollimata. Päris masinale pole uut püsivara
paigaldatud ega liikumiskäske saadetud.

## Enne päris lõikamist lahendatavad koodileiud

1. **Stopi järel vabastamise loogika on lõpetamata.** `src/main.cpp` sisaldab
   `operatorStopLatch` kontrollimisi ja vabastamist, kuid ei määra seda peatatud olekusse.
   Ka `operatorStopLatchRestartRequested` ei saa väärtust true. Seetõttu ei saa eeldada,
   et eraldi Restart Controller -> Home All töövoog juba toimib. Järgmine parandus peab
   katma peatamise, korduva Stopi, taastumise ja juhtnuppude vabastamise koos testidega.
2. **Nullpunkti masina koordinaat võetakse liiga vara.** `admitMachineOperation()` salvestab
   sihtkoordinaadi enne M400/M114 lõpetamist; `MachineOpCapture::Before` seda ei uuenda.
   Kui puhverdatud liikumine lõpeb hiljem, võib salvestatud nullpunkt olla aegunud.
   Parandus: nõuda värsket asukohatõendit pärast liikumise lõppu ja alles siis teha G92.
3. **Faili lõpp ei tõenda liikumise lõppu.** `processJobRunner()` kutsub faili lõpus
   `completeJob()`, mis märgib töö lõpetatuks ja kustutab taastamispunkti. Lõpu eel puudub
   üldine M400 kinnitus. Parandus: eraldi lõpetamise faas, milles Stop ja ühenduse jälgimine
   jäävad toimima; alles kinnitatud liikumise lõpp lubab COMPLETED olekut.

Need on koodipõhised leiud. Nende füüsilist mõju ei ole selles sessioonis masinal katsetatud.

## Kasutajasõbralikkuse järgmised parandused

| Kasutusjuht | Praegune takistus | Ettepanek |
|---|---|---|
| Ühendamine | ONLINE ei selgita üheselt, kas ESP32 ja Marlin mõlemad vastavad | Näidata eraldi „Veebiliides ühendatud” ja „Masina kontroller vastab”, koos ühe järgmise tegevusega |
| Töö ettevalmistus | Home, nullpunkt ja käivitamise eeldused on eri paneelides | Üks nähtav järjekord: Home -> paiguta tööriist -> määra töö null -> kontrolli kõrgus ja piirid -> käivita |
| Ohutu kõrgus | `project-safe-z-panel` ei kuulu ettevalmistuse sahtlisse | Tuua see Prepare vaatesse nullpunkti ja kontrollsõidu juurde; näidata nii programmi kõrgust kui lisavaru |
| Nullpunkt | Masina kehtiv nullpunkt ja konkreetse töö seos sellega on erinevad mõisted | Näidata eraldi „Masina nullpunkt kehtib” ja „See töö kasutab seda nullpunkti” |
| Paus | `readinessBadge()` nimetab PAUSING oleku juba PAUSED-iks; PAUSED_INTACT puudub | Näidata eraldi „Peatub”, „Pausil - lõikur töötab” ja „Jätkab” |
| Faili avamine | Juhis ütleb „tap to expand”, kuid failile vajutamine avab töö | Joondada juhis tegeliku tegevusega ja lisada nähtav lisatoimingute nupp |
| Tõrkest taastumine | Taastamise tööriistad konkureerivad tavalise ettevalmistusega | Näidata taastamist siis, kui olemas on taastatav töö; anda üks selge põhjus, miks jätkamine on blokeeritud |

## Kuidas päris seadmega jätkata

1. Selgitada välja, kas ESP32 on eraldi Wi-Fi ruuteriga ühendatud või alles CNC juures
   paigaldatud. Vajalik on toimiv veebiaadress ja kinnitus, kas SKR on sisse lülitatud.
2. Praegune lähtekood proovib salvestatud Wi-Fi võrku ja kasutab ebaõnnestumisel seadistusvõrku
   `G-code-CNC-Setup` aadressil `192.168.4.1`. Telefonist saab kontrollida, kas see võrk paistab.
   Paigaldatud püsivara versioon pole veel kinnitatud; selle käitumine võib erineda.
3. Kui veebileht avaneb, kontrollida esmalt seadme versiooni ja kontrolleri olekut. Wi-Fi ühendus
   üksi ei tõenda ESP32 ning SKR vahelist UART ühendust.
4. Pärast eespool loetletud püsivaravigade parandamist ja uue versiooni paigaldamist läbida
   operaatoriga `/test.html` vastuvõtukatsed. Riistvaralise kontrolli staatus on praegu tegemata.

Ära kasuta varasemate commit'ide pealkirju või rohelist automaattestide tulemust tõendina,
et Home'i ajal Stop või taastamine on füüsilisel masinal juba kontrollitud.
