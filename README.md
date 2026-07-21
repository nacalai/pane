# VEV — nettside → NDI

**VEV** (norsk: *vev*) gjør en hvilken som helst nettside om til en ekte **NDI-kilde**.
Skriv inn en adresse, naviger siden i sanntid, og hele vinduet publiseres som `MASKIN (VEV)`
på nettverket — klar for vMix, OBS/DistroAV, TriCaster m.fl.

En moderne Creavid-erstatning for [rse/vingester](https://github.com/rse/vingester) (2022, forlatt)
og [tractus.HtmlToNdi](https://github.com/tractusevents/tractus.HtmlToNdi) — bygget på Electron 33
(H.264/AAC følger med, så mer av nettet spiller enn i CEF-baserte verktøy) og **NDI 6** via koffi
FFI rett inn i `Processing.NDI.Lib.x64.dll` (ingen node-gyp, ingen forlatte addons).

## Bruk

```bash
npm install
npm run dev       # utvikling
npm start         # kjør bygget app (bygg først: npm run build)
npm run dist      # bygg Windows-installer (NSIS) → release/
```

**Installert app:** én instans totalt (andre oppstart henter frem det åpne vinduet).
**X-knappen lukker aldri** — den minimerer til systemstatusfeltet der NDI fortsetter å
sende. Høyreklikk tray-ikonet → «Avslutt VEV» for å faktisk lukke.

Krav: [NDI Tools/Runtime](https://ndi.video/tools/) installert (DLL-en finnes automatisk).
Uten NDI-runtime kjører appen fortsatt — med tydelig banner, forhåndsvisning og navigasjon.

## To moduser

| | **Studio** (standard) | **Presenter** |
|---|---|---|
| Vindu | Skjult — rendres offscreen i nøyaktig oppløsning | Synlig 1920×1080-vindu, F11 = fullskjerm |
| Styring | Klikk/tast i forhåndsvisningen i kontrollvinduet | Presentereren bruker siden **direkte** — klikk, grafer, skjemaer |
| Bildekilde | `paint`-events (offscreen) | `capturePage`-polling av det synlige vinduet |
| Alfa/transparent | ✅ (HTML-grafikk keyes i vMix) | — |

Begge moduser sender samme NDI-pipeline: BGRA → paced send-loop (30 fps målt i begge)
med bilderepetisjon så statiske sider aldri «mister» NDI-signalet.

## Fjernstyring (Stream Deck / Companion)

Innebygd HTTP-API — `http://127.0.0.1:9350/api/…` (port/token i høyrepanelet;
LAN-tilgang krever token, ellers kun localhost):

```
GET /api/key?key=ArrowRight          neste lysbilde/element (alle tastetrykk)
GET /api/key?key=r&mod=control       med modifikatorer
GET /api/scroll?dy=600               bla nedover (negativ = opp)
GET /api/click?x=0.5&y=0.5           klikk (normaliserte koordinater)
GET /api/go?url=vg.no                bytt side
GET /api/nav/back|forward|reload     nettlesernavigasjon
GET /api/testcard                    testkortet på lufta
GET /api/presenter?fullscreen=1      presenter-modus (fullskjerm)
GET /api/studio                      tilbake til skjult studio-modus
GET /api/ndi/start | /api/ndi/stop   NDI av/på
GET /api/status                      full tilstand som JSON (for feedbacks)
```

Stream Deck: «Web Requests»-plugin (BarRaider) → GET. Companion: Generic HTTP → GET.
Eksterne maskiner: slå på «Tillat LAN», sett token, og send `Authorization: Bearer <token>`
(query-token støttes ikke — lekker i logger). Sikkerhet: nettleser-utløste kall
(Sec-Fetch-Site/Origin) avvises — en fiendtlig nettside i innholdsvinduet kan ikke
fjernstyre sendingen — og Host-headeren pinnes mot DNS-rebinding.

- **Testkort**-knappen legger et VAPOR-testkort med klokke på lufta — øyeblikkelig signal i vMix.
- **Transparent bakgrunn** (studio) gir ekte alfa i NDI — HTML-grafikk keyes rett over program.
- Lyd fra siden er dempet lokalt som standard («Spill lyd på denne maskinen» slår på).
  NDI-lyd er ikke med i v1.
- `VEV_SWRENDER=1` faller tilbake til programvare-rendering om GPU-en lager trøbbel.

## Arkitektur

```
studio:    offscreen BrowserWindow ── paint (BGRA) ──┐
presenter: synlig BrowserWindow ── capturePage ──────┤
                                                     ▼
                       paced send-loop (repetisjon) ──► koffi ──► NDI 6
                                  └──► JPEG/PNG preview ──► kontroll-UI (React + VAPOR)
HTTP /api/… ──► samme kommandoer som UI-et (zod-validert hele veien)
```

Hele videobanen bor i main-prosessen — ingen IPC-hopp for pixels.
`beginFrameSubscription` leverer aldri frames for synlige vinduer i denne
Electron-versjonen (verifisert empirisk med og uten GPU) — derfor capturePage-polling.

## Verifisering

```bash
npm run typecheck && npm run lint && npm test    # porter (54 tester)
VEV_SELFCHECK=1 npm start                        # 20 s røyktest → selfcheck.json + .png
VEV_SELFCHECK=1 VEV_SELFCHECK_MODE=presenter npm start
node tools/ndi-probe.cjs VEV 10                  # uavhengig NDI-mottaker: frames/fps/pixler
```

Se `docs/superpowers/specs/` og `docs/superpowers/plans/` for design og plan.
