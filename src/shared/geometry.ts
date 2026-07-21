export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The rect an object-fit:contain image of frameW×frameH occupies inside a
 * boxW×boxH container. Pointer coords must normalize against THIS rect, not
 * the container — otherwise letterbox bars skew every click.
 */
export function containRect(boxW: number, boxH: number, frameW: number, frameH: number): Rect {
  if (boxW <= 0 || boxH <= 0 || frameW <= 0 || frameH <= 0) return { x: 0, y: 0, w: 0, h: 0 }
  const scale = Math.min(boxW / frameW, boxH / frameH)
  const w = frameW * scale
  const h = frameH * scale
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h }
}
