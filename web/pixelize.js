// Client-side cozy pixel-art sprite & portrait converter for uploaded item photos.
// Pure pixel/Canvas math (rule/algorithmic conversion, zero external network calls).

export function chromaFeature(r, g, b) {
  const s = Math.max(r + g + b, 30);
  return [
    ((r - g) / s) * 255,
    (((0.5 * (r + g) - b) / s) * 255) * 2.1,
    (0.299 * r + 0.587 * g + 0.114 * b) * 0.08,
  ];
}

function dist3(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Pure RGBA buffer transformation: converts an upright square-cropped RGBA image
 * (`workN x workN`) into a `grid x grid` RGBA pixel-art buffer.
 * - `mode === 'sprite'`: segments central object from background, applies warm cozy palette
 *   quantization, preserves crisp mechanical seams, adds dark plum-brown 1px pixel outline & soft shadow.
 * - `mode === 'card'`: keeps full square scene quantized into crisp cozy pixel blocks with warm border.
 */
export function pixelizeRgbaBuffer(srcRgba, workN, { grid = 48, mode = 'sprite' } = {}) {
  const px = (x, y) => {
    const idx = (y * workN + x) * 4;
    return [srcRgba[idx], srcRgba[idx + 1], srcRgba[idx + 2], srcRgba[idx + 3]];
  };

  if (mode === 'card') {
    const graded = new Array(workN * workN);
    const samples = [];
    for (let y = 0; y < workN; y++) {
      for (let x = 0; x < workN; x++) {
        let [r, g, b] = px(x, y);
        r = 255 * Math.pow(r / 255, 0.85);
        g = 255 * Math.pow(g / 255, 0.87);
        b = 255 * Math.pow(b / 255, 0.87);
        const avg = (r + g + b) / 3;
        const c = [
          Math.min(255, Math.max(0, Math.round(avg + (r - avg) * 1.42 + 6))),
          Math.min(255, Math.max(0, Math.round(avg + (g - avg) * 1.35 + 2))),
          Math.min(255, Math.max(0, Math.round(avg + (b - avg) * 1.32 + 3))),
        ];
        graded[y * workN + x] = c;
        if ((x + y) % 3 === 0) samples.push(c);
      }
    }
    const pal = quantizePalette(samples, 18);
    const out = new Uint8ClampedArray(grid * grid * 4);
    const scale = workN / grid;
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        const oi = (gy * grid + gx) * 4;
        if (gx === 0 || gy === 0 || gx === grid - 1 || gy === grid - 1) {
          out[oi] = 72; out[oi + 1] = 44; out[oi + 2] = 48; out[oi + 3] = 255;
          continue;
        }
        const sx = Math.min(workN - 1, Math.floor((gx + 0.5) * scale));
        const sy = Math.min(workN - 1, Math.floor((gy + 0.5) * scale));
        const c = nearestColor(graded[sy * workN + sx], pal);
        out[oi] = c[0]; out[oi + 1] = c[1]; out[oi + 2] = c[2]; out[oi + 3] = 255;
      }
    }
    return out;
  }

  // Sobel gradient for silhouette boundary protection
  const grad = new Float32Array(workN * workN);
  for (let y = 1; y < workN - 1; y++) {
    for (let x = 1; x < workN - 1; x++) {
      let gxS = 0, gyS = 0;
      for (let c = 0; c < 3; c++) {
        const i00 = ((y - 1) * workN + (x - 1)) * 4 + c;
        const i10 = ((y - 1) * workN + x) * 4 + c;
        const i20 = ((y - 1) * workN + (x + 1)) * 4 + c;
        const i01 = (y * workN + (x - 1)) * 4 + c;
        const i21 = (y * workN + (x + 1)) * 4 + c;
        const i02 = ((y + 1) * workN + (x - 1)) * 4 + c;
        const i12 = ((y + 1) * workN + x) * 4 + c;
        const i22 = ((y + 1) * workN + (x + 1)) * 4 + c;
        const gx = (srcRgba[i20] + 2 * srcRgba[i21] + srcRgba[i22]) - (srcRgba[i00] + 2 * srcRgba[i01] + srcRgba[i02]);
        const gy = (srcRgba[i02] + 2 * srcRgba[i12] + srcRgba[i22]) - (srcRgba[i00] + 2 * srcRgba[i10] + srcRgba[i20]);
        gxS += gx * gx;
        gyS += gy * gy;
      }
      grad[y * workN + x] = Math.sqrt((gxS + gyS) / 3) / 4;
    }
  }

  // Check if image already has alpha transparency
  let transparentBorder = 0, borderTotal = 0;
  const margin = Math.max(4, Math.floor(workN / 24));
  const borderFeats = [];
  for (let y = 0; y < workN; y++) {
    for (let x = 0; x < workN; x++) {
      if (x < margin || x >= workN - margin || y < margin || y >= workN - margin) {
        borderTotal++;
        const [r, g, b, a] = px(x, y);
        if (a < 40) transparentBorder++;
        else borderFeats.push(chromaFeature(r, g, b));
      }
    }
  }

  let fg = new Uint8Array(workN * workN);
  if (transparentBorder > borderTotal * 0.4) {
    for (let i = 0; i < workN * workN; i++) if (srcRgba[i * 4 + 3] >= 60) fg[i] = 1;
  } else {
    const centers = kMeans3(borderFeats, 4, 10, Math.floor(borderFeats.length * 0.14));
    const bgDist = (x, y) => {
      const [r, g, b] = px(x, y);
      const f = chromaFeature(r, g, b);
      let best = Infinity;
      for (const c of centers) {
        const d = dist3(f, c);
        if (d < best) best = d;
      }
      return best;
    };

    const isBg = new Uint8Array(workN * workN);
    const qx = new Int32Array(workN * workN);
    const qy = new Int32Array(workN * workN);
    let qHead = 0, qTail = 0;
    const pushBg = (sx, sy) => {
      const idx = sy * workN + sx;
      if (!isBg[idx] && bgDist(sx, sy) < 16.0) {
        isBg[idx] = 1;
        qx[qTail] = sx;
        qy[qTail] = sy;
        qTail++;
      }
    };
    for (let i = 0; i < workN; i++) {
      pushBg(i, 0); pushBg(i, workN - 1); pushBg(0, i); pushBg(workN - 1, i);
    }
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (qHead < qTail) {
      const cx = qx[qHead], cy = qy[qHead];
      qHead++;
      const [cr, cg, cb] = px(cx, cy);
      const cf = chromaFeature(cr, cg, cb);
      for (const [dx, dy] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= workN || ny < 0 || ny >= workN) continue;
        const nIdx = ny * workN + nx;
        if (isBg[nIdx]) continue;
        const edgeGuard = (nx > 10 && nx < workN - 10 && ny > 10 && ny < workN - 10) ? 18.0 : 32.0;
        if (grad[nIdx] > edgeGuard) continue;
        const [nr, ng, nb] = px(nx, ny);
        const nf = chromaFeature(nr, ng, nb);
        const rx = (nx - workN * 0.5) / (workN * 0.5);
        const ry = (ny - workN * 0.5) / (workN * 0.5);
        const r2 = Math.min(1, rx * rx + ry * ry);
        const thresh = 8.5 + 8.0 * r2;
        if (bgDist(nx, ny) < thresh && dist3(cf, nf) < 6.2) {
          isBg[nIdx] = 1;
          qx[qTail] = nx;
          qy[qTail] = ny;
          qTail++;
        }
      }
    }

    // Keep largest central foreground component
    const vis = new Uint8Array(workN * workN);
    let bestComp = [];
    let bestScore = -1;
    for (let y = 0; y < workN; y++) {
      for (let x = 0; x < workN; x++) {
        const startIdx = y * workN + x;
        if (!isBg[startIdx] && !vis[startIdx]) {
          const comp = [];
          let cHits = 0;
          let ch = 0, ct = 0;
          qx[ct] = x; qy[ct] = y; ct++;
          vis[startIdx] = 1;
          while (ch < ct) {
            const ux = qx[ch], uy = qy[ch]; ch++;
            comp.push([ux, uy]);
            if (Math.abs(ux - workN * 0.5) < workN * 0.28 && Math.abs(uy - workN * 0.5) < workN * 0.28) cHits++;
            for (const [dx, dy] of dirs) {
              const vx = ux + dx, vy = uy + dy;
              if (vx >= 0 && vx < workN && vy >= 0 && vy < workN) {
                const vIdx = vy * workN + vx;
                if (!isBg[vIdx] && !vis[vIdx]) {
                  vis[vIdx] = 1;
                  qx[ct] = vx; qy[ct] = vy; ct++;
                }
              }
            }
          }
          const score = comp.length + cHits * 4;
          if (score > bestScore) { bestScore = score; bestComp = comp; }
        }
      }
    }
    for (const [x, y] of bestComp) fg[y * workN + x] = 1;
    fg = morphDilate(morphErode(fg, workN, 3), workN, 2);
    fg = fillHoles(fg, workN);

    // Fallback if segmentation found too tiny an area (< 6% of frame): use soft rounded center card mask
    let fgCount = 0;
    for (let i = 0; i < fg.length; i++) fgCount += fg[i];
    if (fgCount < workN * workN * 0.06) {
      for (let y = Math.floor(workN * 0.12); y < Math.floor(workN * 0.88); y++) {
        for (let x = Math.floor(workN * 0.12); x < Math.floor(workN * 0.88); x++) fg[y * workN + x] = 1;
      }
    }
  }

  // Local luminance dip for crisp mechanical button/slot creases
  const lum = new Float32Array(workN * workN);
  for (let i = 0; i < workN * workN; i++) {
    lum[i] = 0.299 * srcRgba[i * 4] + 0.587 * srcRgba[i * 4 + 1] + 0.114 * srcRgba[i * 4 + 2];
  }
  const localMean = new Float32Array(workN * workN);
  const rad = 4;
  for (let y = 0; y < workN; y++) {
    for (let x = 0; x < workN; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -rad; dy <= rad; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= workN) continue;
        for (let dx = -rad; dx <= rad; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < workN) { sum += lum[ny * workN + nx]; cnt++; }
        }
      }
      localMean[y * workN + x] = sum / cnt;
    }
  }

  // Warm cozy color grading on foreground
  const graded = new Array(workN * workN);
  const fgSamples = [];
  let minX = workN - 1, maxX = 0, minY = workN - 1, maxY = 0, countFg = 0;
  for (let y = 0; y < workN; y++) {
    for (let x = 0; x < workN; x++) {
      const idx = y * workN + x;
      if (!fg[idx]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      countFg++;
      let [r, g, b] = px(x, y);
      r = 255 * Math.pow(r / 255, 0.76);
      g = 255 * Math.pow(g / 255, 0.80);
      b = 255 * Math.pow(b / 255, 0.79);
      const avg = (r + g + b) / 3;
      const c = [
        Math.min(255, Math.max(0, Math.round(avg + (r - avg) * 1.65 + 10))),
        Math.min(255, Math.max(0, Math.round(avg + (g - avg) * 1.50 + 3))),
        Math.min(255, Math.max(0, Math.round(avg + (b - avg) * 1.48 + 6))),
      ];
      graded[idx] = c;
      if (countFg % 3 === 0) fgSamples.push(c);
    }
  }
  if (!countFg) { minX = 0; maxX = workN - 1; minY = 0; maxY = workN - 1; }
  const pal = quantizePalette(fgSamples.length ? fgSamples : [[230, 180, 150]], 10);

  const bw = Math.max(1, maxX - minX + 1), bh = Math.max(1, maxY - minY + 1);
  const inner = grid - 6;
  const scale = Math.max(bw, bh) / inner;
  const wCells = Math.max(1, Math.round(bw / scale));
  const hCells = Math.max(1, Math.round(bh / scale));
  const offX = Math.floor((grid - wCells) / 2);
  const offY = Math.floor((grid - hCells) / 2);

  const gMask = new Uint8Array(grid * grid);
  const gCol = new Array(grid * grid);
  for (let gy = 0; gy < hCells; gy++) {
    for (let gx = 0; gx < wCells; gx++) {
      const sx = Math.min(workN - 1, Math.floor(minX + (gx + 0.5) * scale));
      const sy = Math.min(workN - 1, Math.floor(minY + (gy + 0.5) * scale));
      const sIdx = sy * workN + sx;
      if (fg[sIdx]) {
        const dip = localMean[sIdx] - lum[sIdx];
        const rc = dip > 14.0 ? [94, 58, 65] : nearestColor(graded[sIdx], pal);
        const tIdx = (offY + gy) * grid + (offX + gx);
        gMask[tIdx] = 1;
        gCol[tIdx] = rc;
      }
    }
  }

  // Prune 1-neighbor spurs for clean pixel curves
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < grid - 1; y++) {
      for (let x = 1; x < grid - 1; x++) {
        const idx = y * grid + x;
        if (gMask[idx]) {
          const nb = gMask[idx + 1] + gMask[idx - 1] + gMask[idx + grid] + gMask[idx - grid];
          if (nb <= 1) gMask[idx] = 0;
        }
      }
    }
  }

  const out = new Uint8ClampedArray(grid * grid * 4);
  // Soft grounding shadow ellipse underneath
  const shadowY = Math.min(grid - 2, offY + hCells);
  const rx = Math.max(3, (wCells - 6) / 2);
  const cx0 = offX + wCells / 2;
  for (let y = Math.max(0, shadowY - 1); y <= Math.min(grid - 1, shadowY + 1); y++) {
    for (let x = 0; x < grid; x++) {
      const dx = (x - cx0) / rx;
      const dy = (y - shadowY) / 1.5;
      if (dx * dx + dy * dy <= 1) {
        const oi = (y * grid + x) * 4;
        out[oi] = 70; out[oi + 1] = 50; out[oi + 2] = 35; out[oi + 3] = 78;
      }
    }
  }

  // Paint foreground & crisp 1px dark plum-brown pixel outline (#482c30)
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const idx = y * grid + x;
      const oi = idx * 4;
      if (gMask[idx]) {
        const c = gCol[idx];
        out[oi] = c[0]; out[oi + 1] = c[1]; out[oi + 2] = c[2]; out[oi + 3] = 255;
      } else if (
        (x + 1 < grid && gMask[idx + 1]) ||
        (x > 0 && gMask[idx - 1]) ||
        (y + 1 < grid && gMask[idx + grid]) ||
        (y > 0 && gMask[idx - grid])
      ) {
        out[oi] = 72; out[oi + 1] = 44; out[oi + 2] = 48; out[oi + 3] = 255;
      }
    }
  }
  return out;
}

function kMeans3(points, k, iters, minClusterSize = 0) {
  if (!points.length) return [[0, 0, 0]];
  const centers = Array.from({ length: k }, (_, i) => [...points[Math.min(points.length - 1, Math.floor((i * points.length) / k))]]);
  let counts = new Int32Array(k);
  for (let it = 0; it < iters; it++) {
    const sums = Array.from({ length: k }, () => [0, 0, 0]);
    counts = new Int32Array(k);
    for (const p of points) {
      let bestI = 0, bestD = Infinity;
      for (let i = 0; i < k; i++) {
        const d = (p[0] - centers[i][0]) ** 2 + (p[1] - centers[i][1]) ** 2 + (p[2] - centers[i][2]) ** 2;
        if (d < bestD) { bestD = d; bestI = i; }
      }
      sums[bestI][0] += p[0]; sums[bestI][1] += p[1]; sums[bestI][2] += p[2];
      counts[bestI]++;
    }
    for (let i = 0; i < k; i++) {
      if (counts[i] > 0) {
        centers[i] = [sums[i][0] / counts[i], sums[i][1] / counts[i], sums[i][2] / counts[i]];
      }
    }
  }
  const valid = centers.filter((_, i) => counts[i] >= minClusterSize);
  return valid.length ? valid : centers;
}

function quantizePalette(samples, k) {
  return kMeans3(samples, k, 10, 1).map(c => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]);
}

function nearestColor(c, pal) {
  let best = pal[0], bestD = Infinity;
  for (const p of pal) {
    const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function morphErode(mask, n, r) {
  const out = new Uint8Array(n * n);
  const r2 = r * r + 1;
  for (let y = r; y < n - r; y++) {
    for (let x = r; x < n - r; x++) {
      if (!mask[y * n + x]) continue;
      let ok = true;
      for (let dy = -r; dy <= r && ok; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= r2 && !mask[(y + dy) * n + (x + dx)]) { ok = false; break; }
        }
      }
      if (ok) out[y * n + x] = 1;
    }
  }
  return out;
}

function morphDilate(mask, n, r) {
  const out = new Uint8Array(n * n);
  const r2 = r * r + 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!mask[y * n + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= n) continue;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          if (dx * dx + dy * dy <= r2 && nx >= 0 && nx < n) out[ny * n + nx] = 1;
        }
      }
    }
  }
  return out;
}

function fillHoles(fg, n) {
  const ext = new Uint8Array(n * n);
  const qx = new Int32Array(n * n), qy = new Int32Array(n * n);
  let h = 0, t = 0;
  const push = (x, y) => {
    const idx = y * n + x;
    if (!fg[idx] && !ext[idx]) { ext[idx] = 1; qx[t] = x; qy[t] = y; t++; }
  };
  for (let i = 0; i < n; i++) { push(i, 0); push(i, n - 1); push(0, i); push(n - 1, i); }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (h < t) {
    const ux = qx[h], uy = qy[h]; h++;
    for (const [dx, dy] of dirs) {
      const vx = ux + dx, vy = uy + dy;
      if (vx >= 0 && vx < n && vy >= 0 && vy < n) push(vx, vy);
    }
  }
  const out = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) if (!ext[i]) out[i] = 1;
  return out;
}

/**
 * Browser helper: converts an uploaded image `File` or `Blob` into a crisp upscaled PNG `File`
 * ready to be uploaded via `/api/uploads` as `pixel_media_id`.
 */
export async function convertFileToPixelPng(file, { mode = 'sprite', grid = 48, outSize = 240 } = {}) {
  if (!file || !file.type?.startsWith('image/')) return null;
  const workN = 144;
  const bitmap = typeof createImageBitmap === 'function'
    ? await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file))
    : await loadImageElement(file);
  try {
    const w = bitmap.width || bitmap.naturalWidth, h = bitmap.height || bitmap.naturalHeight;
    const side = Math.min(w, h);
    const sx = Math.floor((w - side) * 0.5);
    const sy = Math.floor((h - side) * 0.5);

    const workCanvas = document.createElement('canvas');
    workCanvas.width = workN;
    workCanvas.height = workN;
    const wctx = workCanvas.getContext('2d', { willReadFrequently: true });
    wctx.drawImage(bitmap, sx, sy, side, side, 0, 0, workN, workN);
    const rgba = wctx.getImageData(0, 0, workN, workN).data;

    const pixelRgba = pixelizeRgbaBuffer(rgba, workN, { grid, mode });
    const gridCanvas = document.createElement('canvas');
    gridCanvas.width = grid;
    gridCanvas.height = grid;
    gridCanvas.getContext('2d').putImageData(new ImageData(pixelRgba, grid, grid), 0, 0);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outSize;
    outCanvas.height = outSize;
    const octx = outCanvas.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.drawImage(gridCanvas, 0, 0, grid, grid, 0, 0, outSize, outSize);

    const blob = await new Promise(resolve => outCanvas.toBlob(resolve, 'image/png'));
    const previewUrl = URL.createObjectURL(blob);
    const pngFile = new File([blob], (file.name.replace(/\.[^.]+$/, '') || 'item') + `-pixel-${mode}.png`, { type: 'image/png' });
    return { file: pngFile, previewUrl };
  } finally {
    bitmap.close?.();
  }
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = err => { URL.revokeObjectURL(url); reject(err); };
    img.src = url;
  });
}
