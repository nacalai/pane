/**
 * VEV entrypoint. Lifecycle, hardening, crash backstops, selfcheck mode.
 *
 * Offscreen rendering (CPU path) requires hardware acceleration OFF and a
 * forced 1x device scale so paint buffers match the configured resolution.
 */
import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigStore } from './config'
import { VevApp } from './app'
import { registerIpc } from './ipc'

const __dirname = dirname(fileURLToPath(import.meta.url))

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')

const SELFCHECK = process.env.VEV_SELFCHECK === '1'
const SELFCHECK_MS = 20_000
const SELFCHECK_CRASH_AT_MS = 8_000
const SELFCHECK_MIN_FRAMES = 300

let vev: VevApp | null = null
let shuttingDown = false

function teardown(): void {
  if (shuttingDown) return
  shuttingDown = true
  try {
    vev?.shutdown()
  } catch (e) {
    console.error('[main] teardown:', e)
  }
}

// Crash backstops: hardware-adjacent teardown must run on EVERY exit path.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
  teardown()
  app.exit(1)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason)
  teardown()
  app.exit(1)
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void app.whenReady().then(() => {
    const store = new ConfigStore(app.getPath('userData'))
    const resourcesDir = join(app.getAppPath(), 'resources')
    vev = new VevApp(store, resourcesDir)
    vev.initNdiRuntime()

    const control = new BrowserWindow({
      width: 1280,
      height: 900,
      minWidth: 1040,
      minHeight: 700,
      title: 'VEV — Creavid',
      backgroundColor: '#FAFBFC',
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
    control.setMenuBarVisibility(false)
    control.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    control.webContents.on('will-navigate', (event) => event.preventDefault())

    vev.attachControl(control)
    registerIpc(vev)
    vev.capture.start()

    if (process.env.VEV_SELFCHECK_URL) {
      const r = vev.navigate(process.env.VEV_SELFCHECK_URL)
      if (!r.ok) console.error('[main] selfcheck navigate:', r.error)
    }
    if (vev.state().ndi !== 'no-runtime' && (vev.state().config.autoStart || SELFCHECK)) {
      const r = vev.startNdi()
      if (!r.ok) console.error('[main] NDI start:', r.error)
      else console.log(`[main] NDI ready — kilde «${vev.state().config.ndiName}» er på lufta`)
    }

    if (process.env.ELECTRON_RENDERER_URL) {
      void control.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html`)
    } else {
      void control.loadFile(join(__dirname, '../renderer/index.html'))
    }

    if (SELFCHECK) runSelfcheck(control)
  })
}

app.on('before-quit', teardown)
app.on('window-all-closed', () => {
  app.quit()
})

/**
 * VEV_SELFCHECK=1: autonomous smoke — run 20 s on the testcard (or VEV_SELFCHECK_URL),
 * write selfcheck.json + a control-window screenshot, exit 0 iff frames flowed and NDI
 * was live. VEV_SELFCHECK_CRASH=1 additionally kills the content renderer mid-run to
 * prove crash recovery.
 */
function runSelfcheck(control: BrowserWindow): void {
  const dir = process.env.VEV_SELFCHECK_DIR || process.cwd()
  let framesAtCrash: number | null = null

  if (process.env.VEV_SELFCHECK_CRASH === '1') {
    setTimeout(() => {
      if (!vev) return
      framesAtCrash = vev.state().framesSent
      console.log(`[selfcheck] crashing content renderer at ${framesAtCrash} frames`)
      vev.capture.crashForTest()
    }, SELFCHECK_CRASH_AT_MS)
  }

  setTimeout(() => {
    void (async () => {
      if (!vev) return
      const st = vev.state()
      const result = {
        ndi: st.ndi,
        ndiVersion: st.ndiVersion,
        ndiError: st.ndiError,
        framesSent: st.framesSent,
        sentFps: st.sentFps,
        receivers: st.receivers,
        staticPage: st.staticPage,
        url: st.nav.url,
        title: st.nav.title,
        sources: vev.sender.findSources(),
        recovered: framesAtCrash === null ? null : st.framesSent > framesAtCrash + 30
      }
      writeFileSync(join(dir, 'selfcheck.json'), JSON.stringify(result, null, 2))
      try {
        const shot = await control.webContents.capturePage()
        writeFileSync(join(dir, 'selfcheck.png'), shot.toPNG())
      } catch (e) {
        console.error('[selfcheck] screenshot:', e)
      }
      const pass =
        result.ndi === 'live' &&
        result.framesSent > SELFCHECK_MIN_FRAMES &&
        (result.recovered === null || result.recovered === true)
      console.log(`[selfcheck] ${pass ? 'PASS' : 'FAIL'} — ${JSON.stringify(result)}`)
      teardown()
      app.exit(pass ? 0 : 1)
    })()
  }, SELFCHECK_MS)
}
