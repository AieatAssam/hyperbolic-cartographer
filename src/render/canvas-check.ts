/** Pure helpers to detect a blank board canvas (used in tests and QA). */

export interface LumaSample {
  mean: number;
  chroma: number;
  nonBackdrop: number;
  ok: boolean;
}

/** Analyse RGBA image data from a centre band (board area). Fails if too dark and achromatic. */
export function analyseCanvasPixels(data: Uint8ClampedArray, w: number, h: number): LumaSample {
  let sum = 0, chroma = 0, bright = 0, n = 0;
  const y0 = Math.floor(h * 0.2), y1 = Math.floor(h * 0.85);
  const x0 = Math.floor(w * 0.08), x1 = Math.floor(w * 0.92);
  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      sum += l;
      chroma += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      if (l > 0.08) bright++;
      n++;
    }
  }
  const mean = sum / Math.max(1, n);
  const chromaMean = chroma / Math.max(1, n);
  const nonBackdrop = bright / Math.max(1, n);
  const ok = mean > 0.06 && (chromaMean > 0.04 || nonBackdrop > 0.15);
  return { mean, chroma: chromaMean, nonBackdrop, ok };
}
