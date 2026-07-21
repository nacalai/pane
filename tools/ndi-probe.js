'use strict';
/*
 * ndi-probe.js — independent NDI RECEIVER used to prove VEV's output end-to-end.
 * Finds a source whose name contains the given needle, connects, captures video
 * for N seconds, and reports resolution / fps / pixel samples as JSON.
 *
 *   node tools/ndi-probe.js VEV 10
 *
 * Exit codes: 0 = frames received and sane, 2 = source not found, 3 = no frames,
 * 1 = unexpected failure.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const koffi = require('koffi');

const NEEDLE = process.argv[2] || 'VEV';
const SECONDS = Math.max(2, Number(process.argv[3] || 8));
const FIND_TIMEOUT_MS = 15000;

const RECV_COLOR_BGRX_BGRA = 0;
const RECV_BANDWIDTH_HIGHEST = 100;
const FRAME_TYPE_VIDEO = 1;

function dllPath() {
  const dirs = [];
  for (const k of ['NDI_RUNTIME_DIR_V6', 'NDI_RUNTIME_DIR_V5', 'NDI_RUNTIME_DIR_V4']) {
    if (process.env[k]) dirs.push(process.env[k]);
  }
  dirs.push('C:\\Program Files\\NDI\\NDI 6 Runtime\\v6');
  dirs.push('C:\\Program Files\\NDI\\NDI 6 Tools\\Runtime');
  dirs.push('C:\\Program Files\\NDI\\NDI 5 Runtime\\v5');
  for (const d of dirs) {
    const p = path.join(d, 'Processing.NDI.Lib.x64.dll');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('NDI runtime DLL not found');
}

async function main() {
  const dll = dllPath();
  process.env.PATH = path.dirname(dll) + path.delimiter + process.env.PATH;
  const lib = koffi.load(dll);

  const NDIlib_source_t = koffi.struct('NDIlib_source_t', {
    p_ndi_name: 'char*',
    p_url_address: 'char*'
  });
  koffi.struct('NDIlib_find_create_t', {
    show_local_sources: 'bool',
    p_groups: 'char*',
    p_extra_ips: 'char*'
  });
  koffi.struct('NDIlib_recv_create_v3_t', {
    source_to_connect_to: 'NDIlib_source_t',
    color_format: 'int',
    bandwidth: 'int',
    allow_video_fields: 'bool',
    p_ndi_recv_name: 'char*'
  });
  const NDIlib_video_frame_v2_t = koffi.struct('NDIlib_video_frame_v2_t', {
    xres: 'int',
    yres: 'int',
    FourCC: 'int',
    frame_rate_N: 'int',
    frame_rate_D: 'int',
    picture_aspect_ratio: 'float',
    frame_format_type: 'int',
    timecode: 'int64',
    p_data: 'uint8*',
    line_stride_in_bytes: 'int',
    p_metadata: 'char*',
    timestamp: 'int64'
  });

  const fns = {
    initialize: lib.func('bool NDIlib_initialize()'),
    destroy: lib.func('void NDIlib_destroy()'),
    find_create: lib.func('void* NDIlib_find_create_v2(NDIlib_find_create_t* p)'),
    find_destroy: lib.func('void NDIlib_find_destroy(void* p)'),
    find_get: lib.func('NDIlib_source_t* NDIlib_find_get_current_sources(void* p, _Out_ uint32_t* n)'),
    recv_create: lib.func('void* NDIlib_recv_create_v3(NDIlib_recv_create_v3_t* p)'),
    recv_destroy: lib.func('void NDIlib_recv_destroy(void* p)'),
    recv_capture: lib.func(
      'int NDIlib_recv_capture_v2(void* p, _Out_ NDIlib_video_frame_v2_t* v, void* a, void* m, uint32_t timeout)'
    ),
    recv_free_video: lib.func('void NDIlib_recv_free_video_v2(void* p, NDIlib_video_frame_v2_t* v)')
  };

  if (!fns.initialize()) throw new Error('NDIlib_initialize failed');

  // ---- find the source ----
  const find = fns.find_create({ show_local_sources: true, p_groups: null, p_extra_ips: null });
  let sourceName = null;
  const findDeadline = Date.now() + FIND_TIMEOUT_MS;
  while (Date.now() < findDeadline && !sourceName) {
    const count = [0];
    const ptr = fns.find_get(find, count);
    const n = count[0] | 0;
    if (n > 0 && ptr) {
      const decoded = koffi.decode(ptr, NDIlib_source_t, n);
      for (const s of decoded) {
        const name = (s.p_ndi_name || '').toString();
        if (name.includes(NEEDLE)) {
          sourceName = name;
          break;
        }
      }
    }
    if (!sourceName) await new Promise((r) => setTimeout(r, 400));
  }
  if (!sourceName) {
    console.log(JSON.stringify({ ok: false, error: `no source containing "${NEEDLE}" found` }));
    fns.find_destroy(find);
    fns.destroy();
    process.exit(2);
  }

  // ---- connect + capture ----
  const recv = fns.recv_create({
    source_to_connect_to: { p_ndi_name: sourceName, p_url_address: null },
    color_format: RECV_COLOR_BGRX_BGRA,
    bandwidth: RECV_BANDWIDTH_HIGHEST,
    allow_video_fields: false,
    p_ndi_recv_name: `ndi-probe (${os.hostname()})`
  });
  if (!recv) throw new Error('recv_create failed');

  let frames = 0;
  let last = null;
  let lastPixels = null;
  const captureStart = Date.now();
  const deadline = captureStart + SECONDS * 1000;
  let firstFrameAt = null;

  while (Date.now() < deadline) {
    const v = {};
    const t = fns.recv_capture(recv, v, null, null, 1000);
    if (t === FRAME_TYPE_VIDEO) {
      frames++;
      if (firstFrameAt === null) firstFrameAt = Date.now();
      last = { xres: v.xres, yres: v.yres, fourCC: v.FourCC, stride: v.line_stride_in_bytes };
      if (Date.now() > deadline - 1500 && v.p_data && !lastPixels) {
        // sample pixels from the final stretch: center + top-left corner
        const bytes = koffi.decode(v.p_data, koffi.array('uint8', v.line_stride_in_bytes * v.yres));
        const px = (x, y) => {
          const o = y * v.line_stride_in_bytes + x * 4;
          return { b: bytes[o], g: bytes[o + 1], r: bytes[o + 2], a: bytes[o + 3] };
        };
        lastPixels = {
          center: px(Math.floor(v.xres / 2), Math.floor(v.yres / 2)),
          corner: px(8, 8)
        };
      }
      fns.recv_free_video(recv, v);
    }
  }

  const activeSecs = firstFrameAt ? (Date.now() - firstFrameAt) / 1000 : SECONDS;
  const result = {
    ok: frames > 0,
    source: sourceName,
    frames,
    fps: frames > 0 ? Math.round((frames / activeSecs) * 10) / 10 : 0,
    video: last,
    pixels: lastPixels
  };
  console.log(JSON.stringify(result, null, 2));

  fns.recv_destroy(recv);
  fns.find_destroy(find);
  fns.destroy();
  process.exit(frames > 0 ? 0 : 3);
}

main().catch((e) => {
  console.error('probe failed:', e.message);
  process.exit(1);
});
