/**
 * Pane entrypoint. Lifecycle, hardening, crash backstops, selfcheck mode.
 *
 * Offscreen rendering (CPU path) requires hardware acceleration OFF and a
 * forced 1x device scale so paint buffers match the configured resolution.
 */
import { app, BrowserWindow, Menu, nativeImage, screen, Tray } from 'electron'
import type { DisplayInfo } from '@shared/schema'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigStore } from './config'
import { PaneApp } from './app'
import { registerIpc } from './ipc'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Stable identity so Windows treats every launch (and the installer) as one app,
// AND so userData (persisted config) resolves to the SAME folder in every launch mode.
// Without setName, a direct/dev launch falls back to "Electron" and settings would appear
// to not persist because they'd land in a different directory than the packaged app.
app.setName('Pane')
app.setAppUserModelId('no.creavid.pane')

let tray: Tray | null = null
/** True once the user really wants to quit — the X button only hides to tray. */
let isQuitting = false

/** Marker arg the login-item launch adds so a boot start comes up hidden to tray. */
const HIDDEN_FLAG = '--hidden'

/**
 * Register/unregister Pane as a Windows login item. Only meaningful when packaged
 * (in dev the exe is electron.exe and we must not pollute the machine's startup).
 * openAtLogin + a --hidden arg → boots straight to the tray.
 */
function syncLoginItem(enabled: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_FLAG] })
}

/** Connected monitors for the presenter-window display picker. */
function readDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Display ${i + 1}`,
    width: d.size.width,
    height: d.size.height,
    primary: d.id === primaryId
  }))
}

/**
 * Locate resources/ across every launch mode: electron-vite preview + packaged asar
 * (app.getAppPath()/resources), and a direct launch of the built output where
 * getAppPath() resolves to out/main (…/out/main → project-root/resources). Picking the
 * dir that actually contains testcard.html keeps the offscreen page from failing to load.
 */
function resolveResourcesDir(): string {
  const fallback = join(app.getAppPath(), 'resources')
  const candidates = [
    fallback,
    join(__dirname, 'resources'),
    join(__dirname, '..', '..', 'resources'),
    join(process.cwd(), 'resources')
  ]
  return candidates.find((d) => existsSync(join(d, 'testcard.html'))) ?? fallback
}

// GPU compositing stays ON by default — measured on this machine: studio OSR 30 fps,
// presenter capturePage 30 fps (software rendering dropped presenter to ~21 fps).
// PANE_SWRENDER=1 falls back to software rendering if a GPU/driver misbehaves.
if (process.env.PANE_SWRENDER === '1') app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')

const SELFCHECK = process.env.PANE_SELFCHECK === '1'
/** Tray/close-to-tray behavior test — enables the tray + close handler under selfcheck. */
const SELFCHECK_TRAY = process.env.PANE_SELFCHECK_TRAY === '1'
const SELFCHECK_MS = Number(process.env.PANE_SELFCHECK_MS) > 0 ? Number(process.env.PANE_SELFCHECK_MS) : 20_000
const SELFCHECK_CRASH_AT_MS = 8_000
const SELFCHECK_MIN_FRAMES = 300

let pane: PaneApp | null = null
let shuttingDown = false

function teardown(): void {
  if (shuttingDown) return
  shuttingDown = true
  try {
    pane?.shutdown()
  } catch (e) {
    console.error('[main] teardown:', e)
  }
}

// On-air-safe backstops: Pane is a live NDI source. A stray rejection/exception must NOT
// take the feed off air, so we log LOUDLY and keep running rather than exit — the frame
// loop, NDI sender, IPC handlers and loaders all fail closed on their own. (Truly fatal
// native faults still crash the process; nothing in JS can prevent those.) Real teardown
// happens only on deliberate quit (before-quit).
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException (keeping Pane live):', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection (keeping Pane live):', reason)
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void app.whenReady().then(() => {
    // Selfcheck must never pollute the real config (mode/url changes would
    // otherwise greet the next human launch).
    const store = new ConfigStore(
      SELFCHECK ? join(app.getPath('temp'), 'pane-selfcheck-config') : app.getPath('userData')
    )
    const resourcesDir = resolveResourcesDir()
    console.log('[main] resources:', resourcesDir)
    pane = new PaneApp(store, resourcesDir)
    pane.initNdiRuntime()

    // Start hidden when launched at boot (--hidden) or when the user set start-minimized.
    // (Under selfcheck this is normally forced off for determinism, but the tray selfcheck
    // opts back in so the hidden-startup path can be verified.)
    const startHidden =
      (!SELFCHECK || SELFCHECK_TRAY) &&
      (process.argv.includes(HIDDEN_FLAG) || pane.state().config.startMinimized)

    const control = new BrowserWindow({
      width: 1280,
      height: 900,
      minWidth: 1040,
      minHeight: 700,
      title: 'Pane — Creavid',
      backgroundColor: '#FAFBFC',
      show: false, // shown explicitly below unless starting hidden to tray
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
    control.setMenuBarVisibility(false)
    control.once('ready-to-show', () => {
      if (!startHidden) control.show()
    })
    // Keep the OS login item in sync with saved config on every launch.
    syncLoginItem(pane.state().config.launchAtLogin)
    pane.onLoginItemChange((cfg) => syncLoginItem(cfg.launchAtLogin))
    control.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    control.webContents.on('will-navigate', (event) => event.preventDefault())
    // Never reload the control UI on F5/Ctrl+R — the renderer maps those keys to reloading
    // the Pane *page* instead. Reloading the control window would just be a jarring flash.
    control.webContents.on('before-input-event', (event, input) => {
      if (
        input.type === 'keyDown' &&
        (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r'))
      ) {
        event.preventDefault()
      }
    })

    // The X button never quits — it hides the control UI to the tray while NDI
    // keeps streaming. Quitting is deliberate, only from the tray menu (which
    // sets isQuitting) or selfcheck. This is the tray-app counterpart to the
    // earlier zombie fix: the window can be hidden, but the tray makes it
    // visible and gives an explicit way to close.
    control.on('close', (event) => {
      if (isQuitting || (SELFCHECK && !SELFCHECK_TRAY)) return
      event.preventDefault()
      control.hide()
    })

    const showControl = (): void => {
      if (control.isDestroyed()) return
      if (control.isMinimized()) control.restore()
      control.show()
      control.focus()
    }

    // Second launch attempt → surface the existing instance instead of starting a new one.
    app.on('second-instance', showControl)

    if (!SELFCHECK || SELFCHECK_TRAY) tray = createTray(showControl, resourcesDir)

    pane.attachControl(control)
    registerIpc(pane)
    pane.startHttp()
    // Feed the monitor list now and whenever it changes (plug/unplug/rearrange).
    pane.setDisplays(readDisplays())
    const refreshDisplays = (): void => pane?.setDisplays(readDisplays())
    screen.on('display-added', refreshDisplays)
    screen.on('display-removed', refreshDisplays)
    screen.on('display-metrics-changed', refreshDisplays)
    pane.capture.start()

    if (process.env.PANE_SELFCHECK_URL) {
      const r = pane.navigate(process.env.PANE_SELFCHECK_URL)
      if (!r.ok) console.error('[main] selfcheck navigate:', r.error)
    }
    if (process.env.PANE_SELFCHECK_MODE === 'presenter') {
      const r = pane.applySettings({ mode: 'presenter' })
      if (!r.ok) console.error('[main] selfcheck mode:', r.error)
    }
    if (pane.state().ndi !== 'no-runtime' && (pane.state().config.autoStart || SELFCHECK)) {
      const r = pane.startNdi()
      if (!r.ok) console.error('[main] NDI start:', r.error)
      else console.log(`[main] NDI ready — source "${pane.state().config.ndiName}" is on air`)
    }

    if (process.env.ELECTRON_RENDERER_URL) {
      void control.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html`)
    } else {
      void control.loadFile(join(__dirname, '../renderer/index.html'))
    }

    if (SELFCHECK) runSelfcheck(control)
  })
}

app.on('before-quit', () => {
  isQuitting = true
  teardown()
  if (tray) {
    tray.destroy()
    tray = null
  }
})
// Tray keeps the app alive while the control window is hidden — do NOT quit here.
// Quitting is explicit (tray menu / selfcheck), so a hidden window never ends the app.
app.on('window-all-closed', () => {
  if (isQuitting || SELFCHECK) app.quit()
})

/** System-tray icon: click to show, right-click for a menu whose only exit is Avslutt. */
function createTray(showControl: () => void, resourcesDir: string): Tray {
  const iconPath = join(resourcesDir, 'icon.png')
  const image = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 })
    : nativeImage.createEmpty()
  const t = new Tray(image)
  t.setToolTip('Pane — webpage → NDI')
  const rebuildMenu = (): void => {
    const live = pane?.state().ndi === 'live'
    t.setContextMenu(
      Menu.buildFromTemplate([
        { label: live ? '● NDI on air' : 'NDI off', enabled: false },
        { type: 'separator' },
        { label: 'Open Pane', click: showControl },
        { type: 'separator' },
        {
          label: 'Quit Pane',
          click: () => {
            isQuitting = true
            app.quit()
          }
        }
      ])
    )
  }
  rebuildMenu()
  // Refresh the on-air label whenever the menu is about to open.
  t.on('click', showControl)
  t.on('right-click', rebuildMenu)
  return t
}

/**
 * PANE_SELFCHECK=1: autonomous smoke — run 20 s on the testcard (or PANE_SELFCHECK_URL),
 * write selfcheck.json + a control-window screenshot, exit 0 iff frames flowed and NDI
 * was live. PANE_SELFCHECK_CRASH=1 additionally kills the content renderer mid-run to
 * prove crash recovery.
 */
function runSelfcheck(control: BrowserWindow): void {
  const dir = process.env.PANE_SELFCHECK_DIR || process.cwd()
  let framesAtCrash: number | null = null
  const tray_test:
    | { closeHiddenNotDestroyed: boolean; trayPresent: boolean; startedHidden: boolean }
    | null = SELFCHECK_TRAY
    ? { closeHiddenNotDestroyed: false, trayPresent: false, startedHidden: false }
    : null

  if (SELFCHECK_TRAY && tray_test) {
    // Record whether the window came up hidden (--hidden / startMinimized path).
    setTimeout(() => {
      tray_test.startedHidden = !control.isVisible()
      console.log(`[selfcheck] initial visible=${control.isVisible()}`)
    }, 2000)
  }

  if (process.env.PANE_SELFCHECK_CRASH === '1') {
    setTimeout(() => {
      if (!pane) return
      framesAtCrash = pane.state().framesSent
      console.log(`[selfcheck] crashing content renderer at ${framesAtCrash} frames`)
      pane.capture.crashForTest()
    }, SELFCHECK_CRASH_AT_MS)
  }

  // Prove the on-air backstops keep Pane alive: a stray uncaughtException + unhandledRejection
  // must NOT take the app down. The run still PASSes (frames keep flowing) → app stayed live.
  if (process.env.PANE_SELFCHECK_THROW === '1') {
    setTimeout(() => {
      framesAtCrash = pane?.state().framesSent ?? 0
      console.log(`[selfcheck] injecting synthetic faults at ${framesAtCrash} frames`)
      void Promise.reject(new Error('selfcheck synthetic unhandledRejection'))
      setTimeout(() => {
        throw new Error('selfcheck synthetic uncaughtException')
      }, 50)
    }, SELFCHECK_CRASH_AT_MS)
  }

  if (SELFCHECK_TRAY && tray_test) {
    setTimeout(() => {
      // Simulate the user pressing X: the window must hide (not destroy), app stays alive.
      control.close()
      setTimeout(() => {
        tray_test.closeHiddenNotDestroyed = !control.isDestroyed() && !control.isVisible()
        tray_test.trayPresent = tray !== null
        console.log(
          `[selfcheck] after X: destroyed=${control.isDestroyed()} visible=${control.isVisible()} tray=${tray !== null}`
        )
      }, 500)
    }, SELFCHECK_CRASH_AT_MS)
  }

  setTimeout(() => {
    void (async () => {
      if (!pane) return
      const st = pane.state()
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
        sources: pane.sender.findSources(),
        recovered: framesAtCrash === null ? null : st.framesSent > framesAtCrash + 30,
        tray: tray_test
      }
      writeFileSync(join(dir, 'selfcheck.json'), JSON.stringify(result, null, 2))
      if (!tray_test) {
        try {
          const shot = await control.webContents.capturePage()
          writeFileSync(join(dir, 'selfcheck.png'), shot.toPNG())
        } catch (e) {
          console.error('[selfcheck] screenshot:', e)
        }
      }
      const trayOk = !tray_test || (tray_test.closeHiddenNotDestroyed && tray_test.trayPresent)
      const pass =
        result.ndi === 'live' &&
        result.framesSent > SELFCHECK_MIN_FRAMES &&
        (result.recovered === null || result.recovered === true) &&
        trayOk
      console.log(`[selfcheck] ${pass ? 'PASS' : 'FAIL'} — ${JSON.stringify(result)}`)
      teardown()
      app.exit(pass ? 0 : 1)
    })()
  }, SELFCHECK_MS)
}
