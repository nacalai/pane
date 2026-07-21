# VEV — nettside → NDI

**VEV** (norsk: *vev*) gjør en hvilken som helst nettside om til en ekte **NDI-kilde**.
Skriv inn en adresse, naviger siden i sanntid gjennom forhåndsvisningen, og hele vinduet
publiseres som `MASKIN (VEV)` på nettverket — klar for vMix, OBS/DistroAV, TriCaster m.fl.

En moderne Creavid-erstatning for [rse/vingester](https://github.com/rse/vingester) (2022, forlatt)
og [tractus.HtmlToNdi](https://github.com/tractusevents/tractus.HtmlToNdi) — bygget på Electron 33
(H.264/AAC følger med, så mer av nettet spiller enn i CEF-baserte verktøy) og **NDI 6** via koffi
FFI rett inn i `Processing.NDI.Lib.x64.dll` (ingen node-gyp, ingen forlatte addons).

## Bruk

```bash
npm install
npm run dev       # utvikling
npm start         # kjør bygget app (bygg først: npm run build)
```

Krav: [NDI Tools/Runtime](https://ndi.video/tools/) installert (DLL-en finnes automatisk).
Uten NDI-runtime kjører appen fortsatt — med tydelig banner, forhåndsvisning og navigasjon.

- **Testkort**-knappen legger et VAPOR-testkort med klokke på lufta — øyeblikkelig signal å
  verifisere i vMix.
- Klikk i forhåndsvisningen for å styre siden (mus + tastatur + rullehjul; Esc slipper tastaturet).
- **Transparent bakgrunn** gir ekte alfa i NDI (HTML-grafikk kan keyes rett over program).
- Lyd fra siden er dempet lokalt som standard («Spill lyd på denne maskinen» slår på).
  NDI-lyd er ikke med i v1.

## Arkitektur

```
offscreen BrowserWindow ── paint (BGRA) ──► paced send-loop ──► koffi ──► NDI 6
        ▲                            └──► JPEG/PNG preview ──► kontroll-UI (React + VAPOR)
        └── sendInputEvent ◄── normaliserte mus/tast-hendelser ◄── forhåndsvisningen
```

Hele videobanen bor i main-prosessen — ingen IPC-hopp for pixels. Statiske sider holdes i
live med bilderepetisjon. `resources/testcard.html` er standardinnhold ved første start.

## Verifisering

```bash
npm run typecheck && npm run lint && npm test   # porter
VEV_SELFCHECK=1 npm start                        # 20 s røyktest → selfcheck.json + .png
node tools/ndi-probe.js VEV 10                   # uavhengig NDI-mottaker: frames/fps/pixler
```

Se `docs/superpowers/specs/` og `docs/superpowers/plans/` for design og plan.
