// detect.js — 눈/입 자동 감지 (DOM에 의존하지 않는 순수 함수)
//
// 원리
//  1) 캐릭터에서 '밝은 피부색'을 찾고, 피부/볼터치처럼 밝고 따뜻한 픽셀을 이어붙여 얼굴 영역을 만든다.
//  2) 얼굴 영역에 '닫기(closing)' 연산을 해서, 눈·입처럼 얼굴 안쪽으로 파고든 구멍/홈을 메운다.
//     메워진 부분 중 피부가 아닌 곳 = 눈·입·머리카락 끝 같은 이목구비 후보.
//     (눈 윗선이 앞머리와 붙어서 구멍이 열려 있어도 후보로 잡힌다)
//  3) 좌우 한 쌍(눈) + 그 아래 가운데(입)를 골라 박스로 만든다.
//     입이 너무 희미하면 눈 위치와 얼굴 크기로 추정한다.
//
// img: RGBA Uint8ClampedArray (W x H), 반환 좌표는 이미지 대비 % (rigBoxes와 같은 단위)

function detectFaceFeatures(img, W, H) {
  const N = W * H;
  const fail = (reason) => ({ ok: false, reason });
  const lumAt = (i) => 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------- 1) 캐릭터 영역 ----------
  let bx0 = W, by0 = H, bx1 = -1, by1 = -1, opaque = 0;
  const op = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (img[(y * W + x) * 4 + 3] > 200) {
        op[y * W + x] = 1; opaque++;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
        if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
    }
  }
  if (opaque < N * 0.02) return fail('캐릭터 영역을 찾지 못했어요.');
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;

  // ---------- 2) 피부색: 머리 쪽 창에서 '가장 밝은 쪽의 최빈색' ----------
  const wx0 = Math.floor(bx0 + bw * 0.2), wx1 = Math.ceil(bx0 + bw * 0.8);
  const wy0 = Math.floor(by0 + bh * 0.10), wy1 = Math.ceil(by0 + bh * 0.75);
  const hist = new Int32Array(256);
  let cntWin = 0;
  for (let y = wy0; y <= wy1; y++) for (let x = wx0; x <= wx1; x++) {
    const p = y * W + x; if (!op[p]) continue;
    hist[Math.min(255, Math.round(lumAt(p * 4)))]++; cntWin++;
  }
  if (cntWin < 200) return fail('얼굴 후보 영역이 너무 작아요.');
  let acc = 0, P = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= cntWin * 0.92) { P = v; break; } }
  const brightMin = 0.86 * P;
  const bins = new Map();
  for (let y = wy0; y <= wy1; y++) for (let x = wx0; x <= wx1; x++) {
    const p = y * W + x; if (!op[p]) continue;
    const i = p * 4; if (lumAt(i) < brightMin) continue;
    const key = ((img[i] >> 4) << 8) | ((img[i + 1] >> 4) << 4) | (img[i + 2] >> 4);
    let e = bins.get(key); if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; bins.set(key, e); }
    e.n++; e.r += img[i]; e.g += img[i + 1]; e.b += img[i + 2];
  }
  if (!bins.size) return fail('피부색 후보를 찾지 못했어요.');
  let top = null;
  for (const e of bins.values()) if (!top || e.n > top.n) top = e;
  const s0 = [top.r / top.n, top.g / top.n, top.b / top.n];
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let y = wy0; y <= wy1; y++) for (let x = wx0; x <= wx1; x++) {
    const p = y * W + x; if (!op[p]) continue;
    const i = p * 4; if (lumAt(i) < brightMin) continue;
    if (Math.hypot(img[i] - s0[0], img[i + 1] - s0[1], img[i + 2] - s0[2]) < 30) { sr += img[i]; sg += img[i + 1]; sb += img[i + 2]; sn++; }
  }
  const skin = [sr / sn, sg / sn, sb / sn];
  const skinL = 0.299 * skin[0] + 0.587 * skin[1] + 0.114 * skin[2];

  // ---------- 3) 피부/볼터치처럼 밝고 따뜻한 픽셀 → 얼굴 영역 ----------
  const warm = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    if (!op[p]) continue;
    const i = p * 4;
    const lum = lumAt(i), br = img[i + 2] - img[i];
    if (lum > 0.68 * skinL && br < 14) warm[p] = 1;                                        // 피부·연한 볼터치
    else if (img[i] > 0.85 * skin[0] && img[i] - img[i + 1] > 40 && lum > 0.5 * skinL && br < 14) warm[p] = 1;   // 진한 분홍/빨강 볼터치
  }
  const comp = new Int32Array(N);
  const stack = new Int32Array(N);
  const winCnt = [0], sumR = [0], sumG = [0], sumB = [0], cntAll = [0];
  let nComp = 0;
  for (let p0 = 0; p0 < N; p0++) {
    if (!warm[p0] || comp[p0]) continue;
    nComp++; let sp = 0, wc = 0, cr = 0, cg = 0, cb = 0, cn = 0;
    stack[sp++] = p0; comp[p0] = nComp;
    while (sp) {
      const p = stack[--sp]; const x = p % W, y = (p / W) | 0;
      if (x >= wx0 && x <= wx1 && y >= wy0 && y <= wy1) wc++;
      cr += img[p * 4]; cg += img[p * 4 + 1]; cb += img[p * 4 + 2]; cn++;
      if (x > 0 && warm[p - 1] && !comp[p - 1]) { comp[p - 1] = nComp; stack[sp++] = p - 1; }
      if (x < W - 1 && warm[p + 1] && !comp[p + 1]) { comp[p + 1] = nComp; stack[sp++] = p + 1; }
      if (y > 0 && warm[p - W] && !comp[p - W]) { comp[p - W] = nComp; stack[sp++] = p - W; }
      if (y < H - 1 && warm[p + W] && !comp[p + W]) { comp[p + W] = nComp; stack[sp++] = p + W; }
    }
    winCnt.push(wc); sumR.push(cr); sumG.push(cg); sumB.push(cb); cntAll.push(cn);
  }
  // 얼굴 = 창 안에 많이 걸쳐 있으면서 평균 색이 피부색에 가까운 덩어리.
  // (분홍·금발처럼 밝고 따뜻한 머리카락이 크기만으로 얼굴로 뽑히는 것을 방지)
  let faceId = 0, faceScore = 0;
  for (let c = 1; c <= nComp; c++) {
    if (winCnt[c] < 100) continue;
    const dist = Math.hypot(sumR[c] / cntAll[c] - skin[0], sumG[c] / cntAll[c] - skin[1], sumB[c] / cntAll[c] - skin[2]);
    const score = winCnt[c] * Math.exp(-dist / 35);
    if (score > faceScore) { faceScore = score; faceId = c; }
  }
  if (!faceId) return fail('얼굴 피부 영역을 찾지 못했어요.');
  const face = new Uint8Array(N);
  let fx0 = W, fy0 = H, fx1 = -1, fy1 = -1;
  for (let p = 0; p < N; p++) {
    if (comp[p] !== faceId) continue;
    face[p] = 1; const x = p % W, y = (p / W) | 0;
    if (x < fx0) fx0 = x; if (x > fx1) fx1 = x;
    if (y < fy0) fy0 = y; if (y > fy1) fy1 = y;
  }
  const fw = fx1 - fx0 + 1, fh = fy1 - fy0 + 1;
  if (fw < 24 || fh < 24) return fail('얼굴 영역이 너무 작아요.');

  // ---------- 4) 얼굴 영역 닫기(closing): 눈·입이 파고든 홈을 메움 ----------
  const R = clamp(Math.round(fw * 0.12), 6, 40);
  const closed = closeSquare(face, W, H, R);
  const holes = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (closed[p] && !warm[p] && op[p]) holes[p] = 1;

  // ---------- 5) 후보 덩어리 ----------
  const lab = new Int32Array(N);
  const blobs = [];
  for (let p0 = 0; p0 < N; p0++) {
    if (!holes[p0] || lab[p0]) continue;
    const id = blobs.length + 1;
    let sp = 0, area = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    stack[sp++] = p0; lab[p0] = id;
    while (sp) {
      const p = stack[--sp]; const x = p % W, y = (p / W) | 0;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (holes[q] && !lab[q]) { lab[q] = id; stack[sp++] = q; }
      }
    }
    blobs.push({ id, area, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
  }
  const cands = blobs.filter(b =>
    b.area >= 6 && b.w <= fw * 0.55 && b.h <= fh * 0.6 &&
    b.cx > fx0 && b.cx < fx1 && b.cy > fy0 + fh * 0.1 && b.cy < fy1 - fh * 0.02);
  if (cands.length < 2) return fail('눈 후보를 충분히 찾지 못했어요.');

  // ---------- 6) 눈 한 쌍 ----------
  const faceCx = (fx0 + fx1) / 2;
  let pair = null, best = 0;
  for (let a = 0; a < cands.length; a++) for (let b = a + 1; b < cands.length; b++) {
    const A = cands[a], B = cands[b];
    const hMax = Math.max(A.h, B.h), wMax = Math.max(A.w, B.w);
    const dy = Math.abs(A.cy - B.cy), dx = Math.abs(A.cx - B.cx);
    if (dy > 0.6 * hMax + 4) continue;
    if (dx < 0.9 * wMax || dx > fw * 0.9) continue;
    if (Math.min(A.area, B.area) / Math.max(A.area, B.area) < 0.3) continue;
    if (Math.abs((A.cx + B.cx) / 2 - faceCx) > fw * 0.3) continue;
    const score = (A.area + B.area) * (1 - 0.4 * dy / (0.6 * hMax + 4));
    if (score > best) { best = score; pair = [A, B]; }
  }
  if (!pair) return fail('좌우 눈 한 쌍을 찾지 못했어요.');
  const [eL, eR] = pair[0].cx <= pair[1].cx ? pair : [pair[1], pair[0]];

  // 눈 덩어리에 얇은 조각(머리카락 틈 등)이 대각선으로 붙어 박스가 늘어나는 것을 방지:
  // 3x3 침식 후 가장 큰 덩어리만 남겨 bbox를 다시 구한다. (너무 가는 선 눈이라 사라지면 원래 덩어리를 그대로 사용)
  const refineBlob = (e) => {
    const bw2 = e.w + 2, bh2 = e.h + 2;                 // 1px 여백 포함 로컬 마스크
    const m = new Uint8Array(bw2 * bh2);
    for (let y = e.y0; y <= e.y1; y++) for (let x = e.x0; x <= e.x1; x++) {
      if (lab[y * W + x] === e.id) m[(y - e.y0 + 1) * bw2 + (x - e.x0 + 1)] = 1;
    }
    const er = new Uint8Array(bw2 * bh2);
    for (let y = 1; y < bh2 - 1; y++) for (let x = 1; x < bw2 - 1; x++) {
      let ok = 1;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!m[(y + dy) * bw2 + x + dx]) { ok = 0; break; }
      er[y * bw2 + x] = ok;
    }
    const seen = new Uint8Array(bw2 * bh2); const st = [];
    let bestSz = 0, bb = null;
    for (let s = 0; s < er.length; s++) {
      if (!er[s] || seen[s]) continue;
      let size = 0, a0 = bw2, b0 = bh2, a1 = -1, b1 = -1; st.length = 0; st.push(s); seen[s] = 1;
      while (st.length) {
        const q = st.pop(); const qx = q % bw2, qy = (q / bw2) | 0; size++;
        if (qx < a0) a0 = qx; if (qx > a1) a1 = qx; if (qy < b0) b0 = qy; if (qy > b1) b1 = qy;
        for (const n of [q - 1, q + 1, q - bw2, q + bw2]) if (n >= 0 && n < er.length && er[n] && !seen[n]) { seen[n] = 1; st.push(n); }
      }
      if (size > bestSz) { bestSz = size; bb = [a0, b0, a1, b1]; }
    }
    if (!bb || bestSz < e.area * 0.2) return e;
    const nx0 = Math.max(e.x0, e.x0 + bb[0] - 2), nx1 = Math.min(e.x1, e.x0 + bb[2]);
    const ny0 = Math.max(e.y0, e.y0 + bb[1] - 2), ny1 = Math.min(e.y1, e.y0 + bb[3]);
    return { ...e, x0: nx0, x1: nx1, y0: ny0, y1: ny1, w: nx1 - nx0 + 1, h: ny1 - ny0 + 1, cx: (nx0 + nx1) / 2, cy: (ny0 + ny1) / 2 };
  };

  // 눈 윗선(속눈썹)은 닫기 범위 밖에 남을 수 있어서, 눈 바로 위의 '진한 선'만 위쪽으로 조금 확장.
  // 가로로는 넓히지 않고(옆 머리카락·윤곽선으로 번지는 것 방지), 세로도 눈 높이의 25%까지만 허용.
  const extendEye = (e) => {
    const upLimit = Math.max(2, Math.round(e.h * 0.25));
    const ey0 = e.y0 - upLimit;
    let ny0 = e.y0;
    const seen = new Uint8Array(N); let sp = 0;
    for (let y = e.y0; y <= e.y1; y++) for (let x = e.x0; x <= e.x1; x++) {
      const p = y * W + x; if (lab[p] === e.id) { seen[p] = 1; stack[sp++] = p; }
    }
    while (sp) {
      const p = stack[--sp]; const x = p % W, y = (p / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? -1 : k === 1 ? 1 : 0), ny = y + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (nx < e.x0 || nx > e.x1 || ny < ey0 || ny > e.y1 || ny < 0 || nx < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (seen[q] || !op[q] || warm[q]) continue;
        if (lumAt(q * 4) > 0.6 * skinL) continue;     // 진한 선만 (피부/밝은 머리카락은 제외)
        seen[q] = 1; stack[sp++] = q;
        if (ny < ny0) ny0 = ny;
      }
    }
    const h = e.y1 - ny0 + 1;
    return { ...e, y0: ny0, h, cy: (ny0 + e.y1) / 2 };
  };
  const EL = extendEye(refineBlob(eL)), ER = extendEye(refineBlob(eR));
  const midX = (EL.cx + ER.cx) / 2, span = Math.abs(ER.cx - EL.cx);
  const eyeCy = (EL.cy + ER.cy) / 2, eyeH = (EL.h + ER.h) / 2, eyeW = (EL.w + ER.w) / 2;
  const eyeBottom = Math.max(EL.y1, ER.y1);

  // ---------- 7) 입 ----------
  let mouth = null, mScore = 0;
  for (const c of cands) {
    if (c === eL || c === eR) continue;
    if (c.cy < eyeCy + eyeH * 0.4) continue;
    const off = Math.abs(c.cx - midX);
    if (off > span * 0.4 || c.w > eyeW * 1.1) continue;
    const s = c.area * Math.exp(-off / (span * 0.2));
    if (s > mScore) { mScore = s; mouth = c; }
  }
  if (!mouth) {
    // 희미한 입: 눈 아래·가운데 창에서 볼터치보다 확실히 어두운 점/선을 찾는다
    const mx0 = Math.round(midX - span * 0.3), mx1 = Math.round(midX + span * 0.3);
    const my0 = Math.round(eyeBottom + eyeH * 0.15), my1 = Math.min(fy1, Math.round(eyeBottom + fh * 0.35));
    const chinY = fy1 - fh * 0.12;   // 턱 윤곽선 근처에 걸친 덩어리는 입이 아님
    const mm = new Uint8Array(N);
    for (let y = my0; y <= my1; y++) for (let x = mx0; x <= mx1; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const p = y * W + x; if (op[p] && lumAt(p * 4) < 0.74 * skinL) mm[p] = 1;
    }
    const seen = new Uint8Array(N); let bestM = null, bestS = 0;
    for (let y = my0; y <= my1; y++) for (let x = mx0; x <= mx1; x++) {
      const p0 = y * W + x; if (!mm[p0] || seen[p0]) continue;
      let sp = 0, area = 0, a0 = W, b0 = H, a1 = -1, b1 = -1;
      stack[sp++] = p0; seen[p0] = 1;
      while (sp) {
        const p = stack[--sp]; const px = p % W, py = (p / W) | 0; area++;
        if (px < a0) a0 = px; if (px > a1) a1 = px; if (py < b0) b0 = py; if (py > b1) b1 = py;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx; if (mm[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
        }
      }
      const cx = (a0 + a1) / 2;
      const s = area * Math.exp(-Math.abs(cx - midX) / (span * 0.2));
      if (area >= 4 && b1 < chinY && a1 - a0 + 1 <= eyeW * 1.1 && s > bestS) {
        bestS = s; bestM = { x0: a0, x1: a1, y0: b0, y1: b1, w: a1 - a0 + 1, h: b1 - b0 + 1, cx, cy: (b0 + b1) / 2, area };
      }
    }
    mouth = bestM;
  }
  let mouthGuessed = false;
  if (!mouth) {
    mouthGuessed = true;
    const gw = Math.max(6, eyeW * 0.5), gh = Math.max(4, eyeH * 0.3);
    const gcy = clamp(eyeCy + (fy1 - eyeCy) * 0.5, eyeBottom + gh, fy1 - gh);
    mouth = { x0: midX - gw / 2, x1: midX + gw / 2, y0: gcy - gh / 2, y1: gcy + gh / 2, w: gw, h: gh, cx: midX, cy: gcy, area: 0 };
  }

  // ---------- 8) 박스(% 단위) ----------
  const toBox = (c, isMouth) => {
    const padX = isMouth ? 2 + c.w * 0.10 : 1.2 + c.w * 0.02;
    const padY = isMouth ? 2 + c.h * 0.20 : 1.2 + c.h * 0.02;
    const w = c.w + padX * 2, h = c.h + padY * 2;
    const r1 = (v) => Math.round(v * 10) / 10;
    return { x: r1(c.cx / W * 100), y: r1(c.cy / H * 100), w: r1(w / W * 100), h: r1(h / H * 100) };
  };
  return {
    ok: true,
    skin,
    eyeL: toBox(EL), eyeR: toBox(ER), mouth: toBox(mouth, true),
    mouthGuessed,
    face: { x0: fx0, y0: fy0, x1: fx1, y1: fy1 }
  };
}

// 정사각형 구조요소로 닫기(팽창 후 침식). 경계 밖은 침식 때 '채워진 것'으로 간주해 가장자리가 깎이지 않게 함.
function closeSquare(mask, W, H, r) {
  const sweep = (src, horizontal, wantMax, outside) => {
    const dst = new Uint8Array(W * H);
    const len = horizontal ? W : H, lines = horizontal ? H : W;
    for (let l = 0; l < lines; l++) {
      // 슬라이딩 윈도우 합으로 O(len): 팽창=윈도우 합>0, 침식=윈도우 합==윈도우 크기
      const at = (i) => {
        if (i < 0 || i >= len) return outside;
        return src[horizontal ? l * W + i : i * W + l];
      };
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += at(i);
      for (let i = 0; i < len; i++) {
        dst[horizontal ? l * W + i : i * W + l] = wantMax ? (sum > 0 ? 1 : 0) : (sum === 2 * r + 1 ? 1 : 0);
        sum += at(i + r + 1) - at(i - r);
      }
    }
    return dst;
  };
  let m = sweep(mask, true, true, 0);
  m = sweep(m, false, true, 0);
  m = sweep(m, true, false, 1);
  m = sweep(m, false, false, 1);
  return m;
}
