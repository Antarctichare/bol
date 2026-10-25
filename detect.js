// detect.js — 눈/입 자동 감지 (DOM에 의존하지 않는 순수 함수)
//
// 원리: 캐릭터의 얼굴 피부색 영역을 찾고, 그 영역 안쪽에서 '피부보다 확실히 어두운 덩어리'를
// 눈/입 후보로 모은 뒤, 위치 관계(좌우 한 쌍 + 그 아래 가운데)로 눈 2개와 입 1개를 고릅니다.
// 얼굴 인식 AI를 쓰지 않기 때문에 SD/치비 캐릭터에서도 동작하지만,
// 피부가 단색에 가깝고 눈이 어두운 윤곽선으로 둘러싸인 스타일에서 가장 잘 맞습니다.
//
// img: RGBA Uint8ClampedArray (W x H), 반환 좌표는 이미지 대비 % (rigBoxes와 같은 단위)

function detectFaceFeatures(img, W, H) {
  const fail = (reason) => ({ ok: false, reason });
  const lum = (i) => 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];

  // 1) 캐릭터(불투명) 영역
  let bx0 = W, by0 = H, bx1 = -1, by1 = -1, opaque = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (img[(y * W + x) * 4 + 3] > 200) {
        opaque++;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
        if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
    }
  }
  if (opaque < W * H * 0.02) return fail('캐릭터 영역을 찾지 못했어요.');
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;

  // 2) 피부색: 캐릭터 중앙 상단 창에서 가장 많이 나타나는 밝은 색
  const wx0 = Math.floor(bx0 + bw * 0.25), wx1 = Math.ceil(bx0 + bw * 0.75);
  const wy0 = Math.floor(by0 + bh * 0.12), wy1 = Math.ceil(by0 + bh * 0.62);
  const bins = new Map();
  for (let y = wy0; y <= wy1; y++) {
    for (let x = wx0; x <= wx1; x++) {
      const i = (y * W + x) * 4;
      if (img[i + 3] <= 200 || lum(i) < 140) continue;
      const key = ((img[i] >> 4) << 8) | ((img[i + 1] >> 4) << 4) | (img[i + 2] >> 4);
      let e = bins.get(key);
      if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; bins.set(key, e); }
      e.n++; e.r += img[i]; e.g += img[i + 1]; e.b += img[i + 2];
    }
  }
  if (!bins.size) return fail('피부색 후보를 찾지 못했어요.');
  let top = null;
  for (const e of bins.values()) if (!top || e.n > top.n) top = e;
  const s0 = [top.r / top.n, top.g / top.n, top.b / top.n];
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let y = wy0; y <= wy1; y++) {
    for (let x = wx0; x <= wx1; x++) {
      const i = (y * W + x) * 4;
      if (img[i + 3] <= 200) continue;
      if (Math.hypot(img[i] - s0[0], img[i + 1] - s0[1], img[i + 2] - s0[2]) < 30) {
        sr += img[i]; sg += img[i + 1]; sb += img[i + 2]; sn++;
      }
    }
  }
  const skin = [sr / sn, sg / sn, sb / sn];
  const skinL = 0.299 * skin[0] + 0.587 * skin[1] + 0.114 * skin[2];

  // 3) 피부색 영역 중 가장 큰 덩어리 = 얼굴
  const N = W * H;
  const mask = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    if (img[i + 3] > 200 && Math.hypot(img[i] - skin[0], img[i + 1] - skin[1], img[i + 2] - skin[2]) < 40) mask[p] = 1;
  }
  const comp = new Int32Array(N);
  const stack = new Int32Array(N);
  let bestId = 0, bestSize = 0, bestBox = null, id = 0;
  for (let p0 = 0; p0 < N; p0++) {
    if (!mask[p0] || comp[p0]) continue;
    id++;
    let sp = 0, size = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    stack[sp++] = p0; comp[p0] = id;
    while (sp) {
      const p = stack[--sp];
      const x = p % W, y = (p / W) | 0;
      size++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] && !comp[p - 1]) { comp[p - 1] = id; stack[sp++] = p - 1; }
      if (x < W - 1 && mask[p + 1] && !comp[p + 1]) { comp[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - W] && !comp[p - W]) { comp[p - W] = id; stack[sp++] = p - W; }
      if (y < H - 1 && mask[p + W] && !comp[p + W]) { comp[p + W] = id; stack[sp++] = p + W; }
    }
    if (size > bestSize) { bestSize = size; bestId = id; bestBox = [x0, y0, x1, y1]; }
  }
  if (!bestId || bestSize < bw * bh * 0.01) return fail('얼굴 피부 영역을 찾지 못했어요.');
  const [fx0, fy0, fx1, fy1] = bestBox;
  const fw = fx1 - fx0 + 1, fh = fy1 - fy0 + 1;
  if (fw < 20 || fh < 20) return fail('얼굴 영역이 너무 작아요.');

  // 4) 얼굴 영역 안에서 피부보다 확실히 어두운 픽셀 → 덩어리(8방향 연결)
  // 눈/입은 윤곽선이 피부 밝기의 절반 이하로 아주 어두운 편 → 이 '진한 선'만 기준으로 삼음.
  // (볼터치·밝은 머리카락은 이보다 밝아서 제외됨. 눈동자는 윤곽선과 붙어 있어 bbox에 포함됨)
  const coreMax = skinL * 0.5;
  const feat = new Uint8Array(N);
  for (let y = fy0; y <= fy1; y++) {
    for (let x = fx0; x <= fx1; x++) {
      const i = (y * W + x) * 4;
      if (img[i + 3] > 200 && lum(i) < coreMax) feat[y * W + x] = 1;
    }
  }
  const lab = new Int32Array(N);
  let blobs = [];
  for (let p0 = 0; p0 < N; p0++) {
    if (!feat[p0] || lab[p0]) continue;
    const bid = blobs.length + 1;
    let sp = 0, area = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    stack[sp++] = p0; lab[p0] = bid;
    while (sp) {
      const p = stack[--sp];
      const x = p % W, y = (p / W) | 0;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (feat[q] && !lab[q]) { lab[q] = bid; stack[sp++] = q; }
        }
      }
    }
    blobs.push({ x0, y0, x1, y1, area });
  }

  // 5-a) 병합 전에 얼굴 경계에 닿거나 너무 큰 덩어리(얼굴 테두리·머리카락)를 먼저 제외
  //       (고리 모양 덩어리의 bbox 안쪽에 있는 눈이 함께 병합되는 것을 방지)
  blobs = blobs.filter(b => {
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
    if (w > fw * 0.5 || h > fh * 0.45) return false;
    if (b.x0 <= fx0 || b.x1 >= fx1 || b.y0 <= fy0 || b.y1 >= fy1) return false;
    return true;
  });

  // 5-b) 서로 맞닿은 덩어리 병합 (눈동자·속눈썹·윤곽선이 한 눈으로 묶이도록)
  const GAP = 2;
  const parent = blobs.map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let a = 0; a < blobs.length; a++) {
    for (let b = a + 1; b < blobs.length; b++) {
      const A = blobs[a], B = blobs[b];
      if (A.x0 - GAP <= B.x1 && B.x0 - GAP <= A.x1 && A.y0 - GAP <= B.y1 && B.y0 - GAP <= A.y1) {
        parent[find(b)] = find(a);
      }
    }
  }
  const merged = new Map();
  blobs.forEach((bl, i) => {
    const r = find(i);
    const m = merged.get(r);
    if (!m) merged.set(r, { ...bl });
    else {
      m.x0 = Math.min(m.x0, bl.x0); m.y0 = Math.min(m.y0, bl.y0);
      m.x1 = Math.max(m.x1, bl.x1); m.y1 = Math.max(m.y1, bl.y1);
      m.area += bl.area;
    }
  });

  // 6) 후보 필터: 얼굴 안쪽 + 크기 적당 + 좌우가 피부로 둘러싸임(머리카락/윤곽 제외)
  const scanFace = (x, y, dir, maxD) => {
    for (let d = 1; d <= maxD; d++) {
      const nx = x + dir * d;
      if (nx < 0 || nx >= W) return false;
      if (comp[y * W + nx] === bestId) return true;
    }
    return false;
  };
  const maxD = Math.max(8, Math.round(fw * 0.3));
  const cands = [];
  for (const m of merged.values()) {
    const w = m.x1 - m.x0 + 1, h = m.y1 - m.y0 + 1;
    const cx = (m.x0 + m.x1) / 2, cy = (m.y0 + m.y1) / 2;
    if (m.area < 5) continue;
    if (w > fw * 0.5 || h > fh * 0.45) continue;
    if (m.x0 <= fx0 || m.x1 >= fx1 || m.y0 <= fy0 || m.y1 >= fy1) continue;
    const ry = (cy - fy0) / fh;
    if (ry < 0.12 || ry > 0.97) continue;
    const rows = [Math.round(cy), Math.round(m.y0 + h * 0.3), Math.round(m.y0 + h * 0.7)];
    const leftOK = rows.some(y => scanFace(m.x0, y, -1, maxD));
    const rightOK = rows.some(y => scanFace(m.x1, y, +1, maxD));
    if (!leftOK || !rightOK) continue;
    cands.push({ ...m, w, h, cx, cy });
  }
  if (cands.length < 2) return fail('눈 후보를 충분히 찾지 못했어요.');

  // 7) 눈 한 쌍: 높이가 비슷하고, 좌우로 떨어져 있고, 크기가 비슷한 후보 중 가장 큰 조합
  const faceCx = (fx0 + fx1) / 2;
  let bestPair = null, bestScore = 0;
  for (let a = 0; a < cands.length; a++) {
    for (let b = a + 1; b < cands.length; b++) {
      const P = cands[a], Q = cands[b];
      const dy = Math.abs(P.cy - Q.cy), dx = Math.abs(P.cx - Q.cx);
      if (dy > fh * 0.18) continue;
      if (dx < fw * 0.12 || dx > fw * 0.8) continue;
      const ratio = Math.min(P.area, Q.area) / Math.max(P.area, Q.area);
      if (ratio < 0.35) continue;
      const midX = (P.cx + Q.cx) / 2;
      if (Math.abs(midX - faceCx) > fw * 0.3) continue;
      const score = (P.area + Q.area) * (1 - 0.3 * dy / (fh * 0.18));
      if (score > bestScore) { bestScore = score; bestPair = [P, Q]; }
    }
  }
  if (!bestPair) return fail('좌우 눈 한 쌍을 찾지 못했어요.');
  const [eL, eR] = bestPair[0].cx <= bestPair[1].cx ? bestPair : [bestPair[1], bestPair[0]];
  const midX = (eL.cx + eR.cx) / 2;
  const eyeCy = (eL.cy + eR.cy) / 2;
  const eyeH = (eL.h + eR.h) / 2;

  // 8) 입: 눈 아래, 두 눈 사이 가운데 근처에서 가장 그럴듯한 덩어리
  let mouth = null, mScore = 0;
  for (const c of cands) {
    if (c === eL || c === eR) continue;
    if (c.cy < eyeCy + eyeH * 0.5) continue;
    const off = Math.abs(c.cx - midX);
    if (off > fw * 0.3) continue;
    const s = c.area * Math.exp(-off / (fw * 0.15));
    if (s > mScore) { mScore = s; mouth = c; }
  }
  let mouthGuessed = false;
  if (!mouth) {
    mouthGuessed = true;
    const gw = Math.max(6, (eL.w + eR.w) / 2 * 0.5), gh = Math.max(4, eyeH * 0.4);
    const gcy = eyeCy + fh * 0.16;
    mouth = { x0: midX - gw / 2, x1: midX + gw / 2, y0: gcy - gh / 2, y1: gcy + gh / 2, w: gw, h: gh, cx: midX, cy: gcy, area: 0 };
  }

  // 9) 박스(% 단위): 덩어리 bbox에 약간의 여유를 더함
  const toBox = (c, isMouth) => {
    // 눈: 안티앨리어싱 가장자리까지만 덮는 얇은 여유 / 입: 입 모양 4단계 크기의 기준이 되므로 여유를 더 줌
    const padX = isMouth ? 2 + c.w * 0.10 : 1.2 + c.w * 0.02;
    const padY = isMouth ? 2 + c.h * 0.20 : 1.2 + c.h * 0.02;
    const w = c.w + padX * 2, h = c.h + padY * 2;
    const r1 = (v) => Math.round(v * 10) / 10;
    return { x: r1(c.cx / W * 100), y: r1(c.cy / H * 100), w: r1(w / W * 100), h: r1(h / H * 100) };
  };
  return {
    ok: true,
    skin,
    eyeL: toBox(eL),
    eyeR: toBox(eR),
    mouth: toBox(mouth, true),
    mouthGuessed,
    face: { x0: fx0, y0: fy0, x1: fx1, y1: fy1 }
  };
}
