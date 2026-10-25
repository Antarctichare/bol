// =========================================================================
// 1. 독립된 3개 파츠 좌표계 (왼눈 / 오른눈 / 입)
// =========================================================================
let sourceImage = createDefaultSampleCanvas();

let selectedPartKey = 'eyeL';
let skinColor = '#fff1eb';
let lineColor = '#463239';
let forceBlinkTest = false; // 눈감기 고정 테스트 플래그

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}

// 양쪽 눈과 입 사이의 삼각형 중심(콧대/미간)에서 피부색 자동 추출
function autoSampleColors(ctx) {
  const midX = Math.round(((rigBoxes.eyeL.x + rigBoxes.eyeR.x + rigBoxes.mouth.x) / 3 / 100) * CANV_SIZE);
  const midY = Math.round(((rigBoxes.eyeL.y + rigBoxes.mouth.y) / 2 / 100) * CANV_SIZE);
  const data = ctx.getImageData(midX - 2, midY - 2, 5, 5).data;
  let r = 0, g = 0, b = 0, c = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3] > 200) { r += data[i]; g += data[i+1]; b += data[i+2]; c++; }
  }
  if (c > 0) {
    skinColor = rgbToHex(r/c, g/c, b/c);
    document.getElementById('skin-picker').value = skinColor;
  }
}

// =========================================================================
// 피부 패치: 스마트 번짐(주변 피부 픽셀 보간) / 단색
// =========================================================================
let skinMode = 'smart';          // 'smart' = 주변 피부 보간, 'solid' = 단색
let normImgData = null;          // 현재 정규화 이미지의 픽셀 캐시 (rebuild마다 갱신)
const patchCache = new Map();    // 같은 박스 패치를 레이어마다 다시 계산하지 않기 위한 캐시

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 가장자리 샘플 배열의 빈칸(null)을 가까운 값으로 채우고 살짝 평균내어 줄무늬를 줄임
function smoothEdge(arr) {
  const n = arr.length;
  const valid = [];
  arr.forEach((v, i) => { if (v) valid.push(i); });
  if (!valid.length) return arr;
  const filled = arr.map((v, i) => {
    if (v) return v;
    let best = valid[0];
    for (const j of valid) if (Math.abs(j - i) < Math.abs(best - i)) best = j;
    return arr[best];
  });
  return filled.map((_, i) => {
    let r = 0, g = 0, b = 0, c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
      r += filled[j][0]; g += filled[j][1]; b += filled[j][2]; c++;
    }
    return [r / c, g / c, b / c];
  });
}

// 순수 계산 함수: 박스 바깥 4변의 피부 픽셀을 읽어 내부를 매끄럽게 보간한 RGBA 패치를 반환
function computeSmartPatch(img, W, H, cx, cy, w, h, skinRGB) {
  const F = 2;                    // 바깥쪽으로 번지는 가장자리 폭(px)
  const GAP = 2, BAND = 4;        // 박스에서 2px 떨어진 곳부터 4px 두께로 샘플링
  const TOL = 90;                 // 기준 피부색과 이 거리 이상 다른 픽셀(윤곽선/머리카락)은 제외
  const x0 = Math.floor(cx - w / 2), x1 = Math.ceil(cx + w / 2);
  const y0 = Math.floor(cy - h / 2), y1 = Math.ceil(cy + h / 2);
  const rw = Math.max(1, x1 - x0), rh = Math.max(1, y1 - y0);

  const sample = (pts) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (const [x, y] of pts) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = (y * W + x) * 4;
      if (img[i + 3] < 200) continue;
      if (Math.hypot(img[i] - skinRGB[0], img[i + 1] - skinRGB[1], img[i + 2] - skinRGB[2]) > TOL) continue;
      r += img[i]; g += img[i + 1]; b += img[i + 2]; n++;
    }
    return n ? [r / n, g / n, b / n] : null;
  };
  const edge = (len, at) => {
    const arr = [];
    for (let i = 0; i < len; i++) {
      const pts = [];
      for (let k = GAP; k < GAP + BAND; k++) pts.push(at(i, k));
      arr.push(sample(pts));
    }
    return smoothEdge(arr);
  };
  const Le = edge(rh, (i, k) => [x0 - k, y0 + i]);
  const Re = edge(rh, (i, k) => [x1 - 1 + k, y0 + i]);
  const Te = edge(rw, (i, k) => [x0 + i, y0 - k]);
  const Be = edge(rw, (i, k) => [x0 + i, y1 - 1 + k]);

  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const pw = rw + F * 2, ph = rh + F * 2;
  const out = new Uint8ClampedArray(pw * ph * 4);
  const rad = Math.min(w, h) * 0.35;
  const wH = rh * rh, wV = rw * rw; // 짧은 방향(더 가까운 가장자리)의 보간을 더 신뢰

  for (let py = 0; py < ph; py++) {
    for (let px = 0; px < pw; px++) {
      const gx = x0 - F + px + 0.5, gy = y0 - F + py + 0.5;
      // 둥근 사각형 마스크 (안쪽 100%, 바깥쪽 F px 동안 서서히 투명)
      const qx = Math.abs(gx - cx) - (w / 2 - rad), qy = Math.abs(gy - cy) - (h / 2 - rad);
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
      const a = d <= 0 ? 1 : Math.max(0, 1 - d / F);
      if (a <= 0) continue;

      const ix = Math.min(rw - 1, Math.max(0, Math.floor(gx - x0)));
      const iy = Math.min(rh - 1, Math.max(0, Math.floor(gy - y0)));
      const tx = (ix + 0.5) / rw, ty = (iy + 0.5) / rh;
      const Lc = Le[iy], Rc = Re[iy], Tc = Te[ix], Bc = Be[ix];
      const hc = (Lc && Rc) ? mix(Lc, Rc, tx) : (Lc || Rc);
      const vc = (Tc && Bc) ? mix(Tc, Bc, ty) : (Tc || Bc);
      let c;
      if (hc && vc) {
        const s = wH + wV;
        c = [0, 1, 2].map(k => (hc[k] * wH + vc[k] * wV) / s);
      } else {
        c = hc || vc || skinRGB;
      }
      const o = (py * pw + px) * 4;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = Math.round(a * 255);
    }
  }
  return { data: out, pw, ph, ox: x0 - F, oy: y0 - F };
}

// 피부색 패치 그리기 헬퍼 (눈/입을 덮을 때 사용)
function fillSmoothSkinPatch(ctx, px, py, pw, ph, expand = 1.05) {
  if (skinMode === 'smart' && normImgData) {
    const w = pw * expand, h = ph * expand;
    const key = [px, py, w, h, skinColor].join('|');
    let p = patchCache.get(key);
    if (!p) {
      const res = computeSmartPatch(normImgData.data, CANV_SIZE, CANV_SIZE, px, py, w, h, hexToRgb(skinColor));
      const c = document.createElement('canvas');
      c.width = res.pw; c.height = res.ph;
      c.getContext('2d').putImageData(new ImageData(res.data, res.pw, res.ph), 0, 0);
      p = { canvas: c, ox: res.ox, oy: res.oy };
      patchCache.set(key, p);
    }
    ctx.drawImage(p.canvas, p.ox, p.oy);
    return;
  }

  // 단색 모드 (기존 방식)
  ctx.save();
  ctx.fillStyle = skinColor;
  // 가장자리가 칼같이 잘리지 않도록 살짝의 그림자 블러 적용
  ctx.shadowColor = skinColor;
  ctx.shadowBlur = 3;
  ctx.beginPath();
  ctx.roundRect(
    px - (pw * expand) / 2,
    py - (ph * expand) / 2,
    pw * expand,
    ph * expand,
    Math.min(pw, ph) * 0.35
  );
  ctx.fill();
  ctx.restore();
}

// =========================================================================
// 2. 핵심 파츠 합성 엔진 (자연스러운 눈 깜빡임 & 소형 입 완벽 대응)
// =========================================================================
const normCanvas = document.createElement('canvas');
normCanvas.width = CANV_SIZE; normCanvas.height = CANV_SIZE;
const normCtx = normCanvas.getContext('2d');

function rebuildAllParts(autoSample = false) {
  // 1) 원본을 400x400 정규 캔버스에 렌더링
  normCtx.clearRect(0, 0, CANV_SIZE, CANV_SIZE);
  const scale = Math.min(CANV_SIZE / sourceImage.width, CANV_SIZE / sourceImage.height);
  const dw = sourceImage.width * scale;
  const dh = sourceImage.height * scale;
  normCtx.drawImage(sourceImage, (CANV_SIZE - dw)/2, (CANV_SIZE - dh)/2, dw, dh);
  normImgData = normCtx.getImageData(0, 0, CANV_SIZE, CANV_SIZE);
  patchCache.clear();

  if (autoSample) autoSampleColors(normCtx);

  // 픽셀 좌표 변환 헬퍼
  const toPx = (box) => ({
    cx: (box.x / 100) * CANV_SIZE,
    cy: (box.y / 100) * CANV_SIZE,
    w:  (box.w / 100) * CANV_SIZE,
    h:  (box.h / 100) * CANV_SIZE,
    left: ((box.x - box.w/2) / 100) * CANV_SIZE,
    top:  ((box.y - box.h/2) / 100) * CANV_SIZE
  });

  const L = toPx(rigBoxes.eyeL);
  const R = toPx(rigBoxes.eyeR);
  const M = toPx(rigBoxes.mouth);

  // 2) 에디터 프리뷰 캔버스 갱신
  drawEditorCanvas();

  // 3) [베이스 레이어] 생성:
  // 눈은 평소(뜬 상태)에 원본 퀄리티가 100% 유지되도록 지우지 않고, '입 영역'만 정밀하게 피부색으로 지움!
  const baseC = document.createElement('canvas');
  baseC.width = CANV_SIZE; baseC.height = CANV_SIZE;
  const bCtx = baseC.getContext('2d');
  bCtx.drawImage(normCanvas, 0, 0);
  fillSmoothSkinPatch(bCtx, M.cx, M.cy, M.w, M.h, 1.08);
  GENERATED.base = baseC.toDataURL('image/png');

  // 4) [눈 레이어] 생성기
  const createEyeLayer = (drawEyeFn) => {
    const c = document.createElement('canvas');
    c.width = CANV_SIZE; c.height = CANV_SIZE;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = lineColor;
    ctx.fillStyle = lineColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawEyeFn(ctx, L, R);
    return c.toDataURL('image/png');
  };

  // 4-1. 기본 뜬 눈: 원본 눈을 그대로 切り抜き(크롭)하여 말할 때 살짝 들썩일 수 있게 분리
  const openEyesURL = createEyeLayer((ctx, l, r) => {
    ctx.drawImage(normCanvas, l.left, l.top, l.w, l.h, l.left, l.top, l.w, l.h);
    ctx.drawImage(normCanvas, r.left, r.top, r.w, r.h, r.left, r.top, r.w, r.h);
  });

  // 4-2. 자연스러운 감은 눈 (피부색 패치로 눈동자를 덮고 + 트릭컬 특유의 도톰한 감은 속눈썹 렌더링)
  const closedEyesURL = createEyeLayer((ctx, l, r) => {
    fillSmoothSkinPatch(ctx, l.cx, l.cy, l.w, l.h, 1.06);
    fillSmoothSkinPatch(ctx, r.cx, r.cy, r.w, r.h, 1.06);

    const drawClosedArc = (eye) => {
      const yPos = eye.cy + eye.h * 0.12; // 눈꺼풀이 아래로 내려앉은 위치
      const halfW = eye.w * 0.44;
      ctx.lineWidth = Math.max(3, eye.h * 0.18);
      ctx.beginPath();
      ctx.moveTo(eye.cx - halfW, yPos - eye.h * 0.05);
      ctx.quadraticCurveTo(eye.cx, yPos + eye.h * 0.22, eye.cx + halfW, yPos - eye.h * 0.05);
      ctx.stroke();

      // 양끝 속눈썹 디테일 살짝 추가
      ctx.lineWidth = Math.max(2, eye.h * 0.12);
      ctx.beginPath();
      ctx.moveTo(eye.cx - halfW, yPos - eye.h * 0.05);
      ctx.lineTo(eye.cx - halfW * 1.08, yPos - eye.h * 0.18);
      ctx.moveTo(eye.cx + halfW, yPos - eye.h * 0.05);
      ctx.lineTo(eye.cx + halfW * 1.08, yPos - eye.h * 0.18);
      ctx.stroke();
    };
    drawClosedArc(l);
    drawClosedArc(r);
  });

  // 4-3. 해피 눈 (^ ^ 눈웃음)
  const happyEyesURL = createEyeLayer((ctx, l, r) => {
    fillSmoothSkinPatch(ctx, l.cx, l.cy, l.w, l.h, 1.06);
    fillSmoothSkinPatch(ctx, r.cx, r.cy, r.w, r.h, 1.06);

    const drawHappyArc = (eye) => {
      const halfW = eye.w * 0.42;
      ctx.lineWidth = Math.max(3.2, eye.h * 0.20);
      ctx.beginPath();
      ctx.moveTo(eye.cx - halfW, eye.cy + eye.h * 0.15);
      ctx.quadraticCurveTo(eye.cx, eye.cy - eye.h * 0.35, eye.cx + halfW, eye.cy + eye.h * 0.15);
      ctx.stroke();
    };
    drawHappyArc(l);
    drawHappyArc(r);
  });

  // 4-4. 당황 눈 (하얀 눈자위 + 작은 동공)
  const shockEyesURL = createEyeLayer((ctx, l, r) => {
    fillSmoothSkinPatch(ctx, l.cx, l.cy, l.w, l.h, 1.06);
    fillSmoothSkinPatch(ctx, r.cx, r.cy, r.w, r.h, 1.06);

    const drawShockEye = (eye) => {
      ctx.lineWidth = Math.max(2.5, eye.h * 0.14);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(eye.cx, eye.cy, eye.w * 0.38, eye.h * 0.42, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.arc(eye.cx, eye.cy, Math.max(2, eye.w * 0.09), 0, Math.PI * 2);
      ctx.fill();
    };
    drawShockEye(l);
    drawShockEye(r);
  });

  // 4-5. 버럭 눈 (원본 눈 + 사선 눈썹)
  const angryEyesURL = createEyeLayer((ctx, l, r) => {
    ctx.drawImage(normCanvas, l.left, l.top, l.w, l.h, l.left, l.top, l.w, l.h);
    ctx.drawImage(normCanvas, r.left, r.top, r.w, r.h, r.left, r.top, r.w, r.h);

    // 눈 위쪽을 피부색으로 살짝 깎아 매서운 눈매 연출
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.moveTo(l.left, l.top); ctx.lineTo(l.left + l.w, l.top); ctx.lineTo(l.left + l.w, l.top + l.h*0.35); ctx.closePath();
    ctx.moveTo(r.left, r.top); ctx.lineTo(r.left + r.w, r.top); ctx.lineTo(r.left, r.top + r.h*0.35); ctx.closePath();
    ctx.fill();

    ctx.lineWidth = Math.max(3.5, l.h * 0.18);
    ctx.beginPath();
    ctx.moveTo(l.cx - l.w*0.42, l.cy - l.h*0.38); ctx.lineTo(l.cx + l.w*0.42, l.cy - l.h*0.05);
    ctx.moveTo(r.cx + r.w*0.42, r.cy - r.h*0.38); ctx.lineTo(r.cx - r.w*0.42, r.cy - r.h*0.05);
    ctx.stroke();
  });

  // 5) [입 4단계 레이어] 생성 (사용자가 지정한 입 박스 크기 M.w, M.h에 비례하여 스케일링)
  const buildMouths = (mood) => {
    const makeM = (fn) => {
      const c = document.createElement('canvas');
      c.width = CANV_SIZE; c.height = CANV_SIZE;
      const ctx = c.getContext('2d');
      ctx.strokeStyle = lineColor;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      fn(ctx, M.cx, M.cy, M.w, M.h);
      return c.toDataURL('image/png');
    };

    // 0단계: 닫힌 입 (기본 표정은 원본 입 이미지를 그대로 사용하여 이질감 제로)
    let m0;
    if (mood === 'normal') {
      m0 = makeM((ctx) => {
        ctx.drawImage(normCanvas, M.left, M.top, M.w, M.h, M.left, M.top, M.w, M.h);
      });
    } else {
      m0 = makeM((ctx, x, y, w, h) => {
        ctx.lineWidth = Math.max(2.5, h * 0.22);
        const hw = w * 0.42;
        ctx.beginPath();
        if (mood === 'happy') {
          ctx.moveTo(x - hw, y - h*0.1); ctx.quadraticCurveTo(x, y + h*0.45, x + hw, y - h*0.1);
        } else if (mood === 'shock') {
          ctx.moveTo(x - hw, y + h*0.1); ctx.quadraticCurveTo(x - hw*0.5, y - h*0.25, x, y + h*0.1);
          ctx.quadraticCurveTo(x + hw*0.5, y + h*0.45, x + hw, y + h*0.1);
        } else {
          ctx.moveTo(x - hw, y + h*0.2); ctx.quadraticCurveTo(x, y - h*0.3, x + hw, y + h*0.2);
        }
        ctx.stroke();
      });
    }

    // 1단계: 작게 열림 (귀여운 소형 타원)
    const m1 = makeM((ctx, x, y, w, h) => {
      ctx.lineWidth = Math.max(2.2, h * 0.18);
      ctx.fillStyle = '#d65a5a';
      ctx.beginPath();
      ctx.ellipse(x, y + h*0.05, w * 0.28, h * 0.35, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    });

    // 2단계: 보통 열림 (반달형 + 분홍 혀)
    const m2 = makeM((ctx, x, y, w, h) => {
      const rw = w * 0.48;
      const rh = h * 0.65;
      ctx.lineWidth = Math.max(2.5, h * 0.18);
      ctx.fillStyle = '#c44545';
      ctx.beginPath();
      ctx.moveTo(x - rw, y - rh*0.3);
      ctx.quadraticCurveTo(x, y - rh*0.4, x + rw, y - rh*0.3);
      ctx.quadraticCurveTo(x + rw*1.05, y + rh, x, y + rh);
      ctx.quadraticCurveTo(x - rw*1.05, y + rh, x - rw, y - rh*0.3);
      ctx.closePath();
      ctx.fill(); ctx.stroke();

      // 클리핑 후 안쪽 혀 그리기
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#ff9a9e';
      ctx.beginPath();
      ctx.ellipse(x, y + rh * 0.75, rw * 0.75, rh * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.stroke();
    });

    // 3단계: 크게 열림 (와! 입모양)
    const m3 = makeM((ctx, x, y, w, h) => {
      const rw = w * 0.65;
      const rh = h * 0.95;
      ctx.lineWidth = Math.max(2.8, h * 0.20);
      ctx.fillStyle = '#b83b3b';
      ctx.beginPath();
      if (mood === 'shock' || mood === 'angry') {
        ctx.moveTo(x - rw*0.75, y - rh*0.35);
        ctx.quadraticCurveTo(x, y - rh*0.5, x + rw*0.75, y - rh*0.35);
        ctx.quadraticCurveTo(x + rw*1.1, y + rh, x, y + rh*0.9);
        ctx.quadraticCurveTo(x - rw*1.1, y + rh, x - rw*0.75, y - rh*0.35);
      } else {
        ctx.moveTo(x - rw, y - rh*0.25);
        ctx.quadraticCurveTo(x, y - rh*0.15, x + rw, y - rh*0.25);
        ctx.quadraticCurveTo(x + rw, y + rh*1.05, x, y + rh*1.05);
        ctx.quadraticCurveTo(x - rw, y + rh*1.05, x - rw, y - rh*0.25);
      }
      ctx.closePath();
      ctx.fill();

      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#ff9a9e';
      ctx.beginPath();
      ctx.ellipse(x, y + rh * 0.75, rw * 0.75, rh * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.stroke();
    });

    return [m0, m1, m2, m3];
  };

  // 6) 감정 이펙트 (오른쪽 눈 위치를 기준으로 땀방울/빠직 배치)
  const emptyFx = createEyeLayer(() => {});
  const happyFx = createEyeLayer((ctx, l, r) => {
    ctx.fillStyle = 'rgba(255, 105, 120, 0.38)';
    ctx.beginPath();
    ctx.ellipse(l.cx - l.w*0.2, l.cy + l.h*0.85, l.w*0.45, l.h*0.3, 0, 0, Math.PI*2);
    ctx.ellipse(r.cx + r.w*0.2, r.cy + r.h*0.85, r.w*0.45, r.h*0.3, 0, 0, Math.PI*2);
    ctx.fill();
  });
  const shockFx = createEyeLayer((ctx, l, r) => {
    const sx = r.cx + r.w * 0.65;
    const sy = r.cy - r.h * 0.5;
    ctx.fillStyle = '#74b9ff'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 9); ctx.quadraticCurveTo(sx + 8, sy + 5, sx, sy + 10);
    ctx.quadraticCurveTo(sx - 8, sy + 5, sx, sy - 9);
    ctx.fill(); ctx.stroke();
  });
  const angryFx = createEyeLayer((ctx, l, r) => {
    const ax = r.cx + r.w * 0.55;
    const ay = r.cy - r.h * 0.95;
    ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(ax-7, ay-9); ctx.quadraticCurveTo(ax, ay, ax-9, ay+2);
    ctx.moveTo(ax+7, ay-9); ctx.quadraticCurveTo(ax, ay, ax+9, ay+2);
    ctx.moveTo(ax-7, ay+9); ctx.quadraticCurveTo(ax, ay, ax-9, ay-2);
    ctx.moveTo(ax+7, ay+9); ctx.quadraticCurveTo(ax, ay, ax+9, ay-2);
    ctx.stroke();
  });

  GENERATED.normal = { blink: true,  eyesOpen: openEyesURL,  eyesClosed: closedEyesURL, fx: emptyFx, mouths: buildMouths('normal') };
  GENERATED.happy  = { blink: false, eyesOpen: happyEyesURL, eyesClosed: closedEyesURL, fx: happyFx, mouths: buildMouths('happy') };
  GENERATED.shock  = { blink: true,  eyesOpen: shockEyesURL, eyesClosed: closedEyesURL, fx: shockFx, mouths: buildMouths('shock') };
  GENERATED.angry  = { blink: true,  eyesOpen: angryEyesURL, eyesClosed: closedEyesURL, fx: angryFx, mouths: buildMouths('angry') };

  applyCustomParts();
  applyCurrentLayers();
  renderExportCards();
}

// =========================================================================
// 3. 인터랙티브 캔버스 드래그 & 리사이즈 구현
// =========================================================================
const rigCanvas = document.getElementById('rig-canvas');
const rigCtx = rigCanvas.getContext('2d');
let dragMode = null; // 'move' | 'resize' | null
let dragStart = { x: 0, y: 0, boxX: 0, boxY: 0, boxW: 0, boxH: 0 };

function drawEditorCanvas() {
  rigCtx.clearRect(0, 0, CANV_SIZE, CANV_SIZE);
  rigCtx.drawImage(normCanvas, 0, 0);

  ['eyeL', 'eyeR', 'mouth'].forEach(key => {
    const b = rigBoxes[key];
    const isSel = (key === selectedPartKey);
    const px = ((b.x - b.w/2) / 100) * CANV_SIZE;
    const py = ((b.y - b.h/2) / 100) * CANV_SIZE;
    const pw = (b.w / 100) * CANV_SIZE;
    const ph = (b.h / 100) * CANV_SIZE;

    rigCtx.save();
    rigCtx.strokeStyle = b.color;
    rigCtx.lineWidth = isSel ? 3 : 1.8;
    if (!isSel) rigCtx.setLineDash([4, 3]);
    rigCtx.strokeRect(px, py, pw, ph);

    rigCtx.fillStyle = b.color + (isSel ? '33' : '18');
    rigCtx.fillRect(px, py, pw, ph);

    // 라벨 태그
    rigCtx.fillStyle = b.color;
    rigCtx.font = 'bold 11px sans-serif';
    rigCtx.fillText(b.label, px + 3, py - 4);

    // 선택된 박스는 우측 하단에 크기 조절 핸들 표시
    if (isSel) {
      rigCtx.setLineDash([]);
      rigCtx.fillStyle = '#fff';
      rigCtx.strokeStyle = b.color;
      rigCtx.lineWidth = 2;
      rigCtx.beginPath();
      rigCtx.arc(px + pw, py + ph, 5.5, 0, Math.PI * 2);
      rigCtx.fill();
      rigCtx.stroke();
    }
    rigCtx.restore();
  });
}

function getCanvasMousePct(e) {
  const rect = rigCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: ((clientX - rect.left) / rect.width) * 100,
    y: ((clientY - rect.top) / rect.height) * 100
  };
}

rigCanvas.addEventListener('pointerdown', (e) => {
  if (eyedropMode) {
    const hex = pickColorAt(e);
    if (hex) { setSkinColor(hex); setHint('스포이드로 피부색 ' + hex + ' 을(를) 적용했어요.'); }
    setEyedropMode(false);
    return;
  }
  const pos = getCanvasMousePct(e);
  const curBox = rigBoxes[selectedPartKey];
  const brX = curBox.x + curBox.w / 2;
  const brY = curBox.y + curBox.h / 2;

  // 1) 현재 선택된 박스의 우측 하단 리사이즈 핸들 클릭 여부 확인
  if (Math.hypot(pos.x - brX, pos.y - brY) < 3.2) {
    dragMode = 'resize';
    dragStart = { x: pos.x, y: pos.y, boxW: curBox.w, boxH: curBox.h };
    rigCanvas.setPointerCapture(e.pointerId);
    return;
  }

  // 2) 작은 박스(입 등)가 우선 선택되도록 면적 작은 순으로 히트 테스트
  const order = ['mouth', 'eyeL', 'eyeR'];
  for (const key of order) {
    const b = rigBoxes[key];
    if (
      pos.x >= b.x - b.w/2 - 1 && pos.x <= b.x + b.w/2 + 1 &&
      pos.y >= b.y - b.h/2 - 1 && pos.y <= b.y + b.h/2 + 1
    ) {
      selectPart(key);
      dragMode = 'move';
      dragStart = { x: pos.x, y: pos.y, boxX: b.x, boxY: b.y };
      rigCanvas.setPointerCapture(e.pointerId);
      return;
    }
  }
});

rigCanvas.addEventListener('pointermove', (e) => {
  if (eyedropMode) { previewEyedrop(e); return; }
  if (!dragMode) return;
  const pos = getCanvasMousePct(e);
  const b = rigBoxes[selectedPartKey];

  if (dragMode === 'move') {
    b.x = Math.max(2, Math.min(98, +(dragStart.boxX + (pos.x - dragStart.x)).toFixed(1)));
    b.y = Math.max(2, Math.min(98, +(dragStart.boxY + (pos.y - dragStart.y)).toFixed(1)));
  } else if (dragMode === 'resize') {
    // 최소 크기 제한을 0.5%까지 완전히 해제!
    b.w = Math.max(0.5, Math.min(60, +(dragStart.boxW + (pos.x - dragStart.x) * 2).toFixed(1)));
    b.h = Math.max(0.5, Math.min(60, +(dragStart.boxH + (pos.y - dragStart.y) * 2).toFixed(1)));
  }
  syncSlidersFromBox();
  rebuildAllParts(false);
});

rigCanvas.addEventListener('pointerup', () => { dragMode = null; });

// 파츠 선택 및 슬라이더 양방향 동기화
function selectPart(partKey) {
  selectedPartKey = partKey;
  document.querySelectorAll('.part-sel-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.part === partKey);
  });
  syncSlidersFromBox();
  drawEditorCanvas();
}

function syncSlidersFromBox() {
  const b = rigBoxes[selectedPartKey];
  ['x', 'y', 'w', 'h'].forEach(k => {
    document.getElementById(`sl-${k}`).value = b[k];
    document.getElementById(`num-${k}`).value = b[k];
  });
}

['x', 'y', 'w', 'h'].forEach(k => {
  const sl = document.getElementById(`sl-${k}`);
  const num = document.getElementById(`num-${k}`);
  const updateVal = (val) => {
    const minVal = (k === 'w' || k === 'h') ? 0.5 : 0;
    const v = Math.max(minVal, Math.min(100, Number(val)));
    rigBoxes[selectedPartKey][k] = v;
    sl.value = v;
    num.value = v;
    rebuildAllParts(false);
  };
  sl.addEventListener('input', (e) => updateVal(e.target.value));
  num.addEventListener('change', (e) => updateVal(e.target.value));
});

document.getElementById('skin-picker').addEventListener('input', (e) => {
  skinColor = e.target.value;
  rebuildAllParts(false);
});
document.getElementById('line-picker').addEventListener('input', (e) => {
  lineColor = e.target.value;
  rebuildAllParts(false);
});

// =========================================================================
// 눈·입 자동 감지 (detect.js의 detectFaceFeatures 사용)
// =========================================================================
const detectHintEl = document.getElementById('detect-hint');
const undoDetectBtn = document.getElementById('undo-detect-btn');
let beforeDetect = null;   // 되돌리기용 { boxes, skin }

function runAutoDetect() {
  if (!normImgData) return false;
  const res = detectFaceFeatures(normImgData.data, CANV_SIZE, CANV_SIZE);
  if (!res.ok) {
    detectHintEl.textContent = '자동 감지 실패: ' + res.reason + ' 현재 박스 위치를 유지했어요. 박스를 직접 맞춰 주세요.';
    return false;
  }
  beforeDetect = { boxes: JSON.parse(JSON.stringify(rigBoxes)), skin: skinColor };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  ['eyeL', 'eyeR', 'mouth'].forEach(k => {
    const b = res[k];
    rigBoxes[k].x = clamp(b.x, 2, 98);
    rigBoxes[k].y = clamp(b.y, 2, 98);
    rigBoxes[k].w = clamp(b.w, 0.5, 60);
    rigBoxes[k].h = clamp(b.h, 0.5, 60);
  });
  skinColor = rgbToHex(res.skin[0], res.skin[1], res.skin[2]);
  document.getElementById('skin-picker').value = skinColor;
  syncSlidersFromBox();
  rebuildAllParts(false);
  undoDetectBtn.style.display = '';
  detectHintEl.textContent = res.mouthGuessed
    ? '눈 2개는 찾았지만 입은 찾지 못해 추정 위치에 뒀어요. 입 박스만 직접 맞춰 주세요. (피부색도 자동 갱신됨)'
    : '눈 2개와 입을 찾았어요. 어긋나 있으면 박스를 드래그해서 보정하세요. (피부색도 자동 갱신됨)';
  return true;
}

document.getElementById('auto-detect-btn').addEventListener('click', runAutoDetect);
undoDetectBtn.addEventListener('click', () => {
  if (!beforeDetect) return;
  ['eyeL', 'eyeR', 'mouth'].forEach(k => Object.assign(rigBoxes[k], beforeDetect.boxes[k]));
  skinColor = beforeDetect.skin;
  document.getElementById('skin-picker').value = skinColor;
  beforeDetect = null;
  undoDetectBtn.style.display = 'none';
  syncSlidersFromBox();
  rebuildAllParts(false);
  detectHintEl.textContent = '감지 전 위치로 되돌렸어요.';
});

// =========================================================================
// 피부색 도구: 스마트 번짐 모드 / 스포이드
// =========================================================================
const hintEl = document.getElementById('tool-hint');
function setHint(msg) { hintEl.textContent = msg || ''; }

function setSkinColor(hex) {
  skinColor = hex;
  document.getElementById('skin-picker').value = hex;
  rebuildAllParts(false);
}

document.getElementById('skin-mode').addEventListener('change', (e) => {
  skinMode = e.target.value;
  rebuildAllParts(false);
});

let eyedropMode = false;
const eyedropBtn = document.getElementById('eyedrop-btn');
const eyedropSwatch = document.getElementById('eyedrop-swatch');

function setEyedropMode(on) {
  eyedropMode = on;
  rigCanvas.style.cursor = on ? 'crosshair' : '';
  eyedropBtn.classList.toggle('active', on);
  eyedropSwatch.style.display = on ? 'inline-block' : 'none';
  if (on) setHint('캔버스에서 피부 부분을 클릭하세요. (Esc로 취소)');
}
eyedropBtn.addEventListener('click', () => setEyedropMode(!eyedropMode));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && eyedropMode) { setEyedropMode(false); setHint(''); }
});

// 클릭 지점 주변 3x3 픽셀의 평균색(투명 제외)을 원본 이미지에서 읽음 (박스 오버레이는 제외)
function pickColorAt(e) {
  const rect = rigCanvas.getBoundingClientRect();
  const x = Math.round((e.clientX - rect.left) / rect.width * CANV_SIZE);
  const y = Math.round((e.clientY - rect.top) / rect.height * CANV_SIZE);
  if (x < 0 || y < 0 || x >= CANV_SIZE || y >= CANV_SIZE) return null;
  const sx = Math.max(0, x - 1), sy = Math.max(0, y - 1);
  const d = normCtx.getImageData(sx, sy, Math.min(3, CANV_SIZE - sx), Math.min(3, CANV_SIZE - sy)).data;
  let r = 0, g = 0, b = 0, c = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; c++; }
  }
  return c ? rgbToHex(r / c, g / c, b / c) : null;
}
function previewEyedrop(e) {
  const hex = pickColorAt(e);
  if (hex) eyedropSwatch.style.background = hex;
}

// 브라우저 기본 EyeDropper API (Chrome/Edge): 화면 어디서든 색을 찍을 수 있음
const screenEyedropBtn = document.getElementById('screen-eyedrop-btn');
if ('EyeDropper' in window) {
  screenEyedropBtn.style.display = '';
  screenEyedropBtn.addEventListener('click', async () => {
    try {
      const res = await new EyeDropper().open();
      setSkinColor(res.sRGBHex);
      setHint('화면 스포이드로 피부색 ' + res.sRGBHex + ' 을(를) 적용했어요.');
    } catch (err) { /* 사용자가 취소 */ }
  });
}

// =========================================================================
// 8개 파츠 이미지 직접 업로드
// =========================================================================
// 정사각형이 아니면 투명 여백으로 정사각형을 맞춰 레이어 정렬이 어긋나지 않게 함
function fileToSquareDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const size = Math.max(img.width, img.height);
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        c.getContext('2d').drawImage(img, (size - img.width) / 2, (size - img.height) / 2);
        resolve(c.toDataURL('image/png'));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function assignCustomPart(key, file) {
  customParts[key] = await fileToSquareDataURL(file);
}
function refreshAfterUpload() {
  applyCustomParts();
  applyCurrentLayers();
  renderExportCards();
}

const slotInput = document.createElement('input');
slotInput.type = 'file'; slotInput.accept = 'image/*'; slotInput.hidden = true;
document.body.appendChild(slotInput);
let pendingSlotKey = null;
function pickFileForSlot(key) { pendingSlotKey = key; slotInput.value = ''; slotInput.click(); }
slotInput.addEventListener('change', async () => {
  const file = slotInput.files[0];
  if (!file || !pendingSlotKey) return;
  try {
    await assignCustomPart(pendingSlotKey, file);
    refreshAfterUpload();
    setHint('업로드 완료: ' + PART_SLOTS.find(s => s.key === pendingSlotKey).label);
  } catch (err) { setHint('이미지를 읽지 못했어요. PNG/WebP/JPG 파일인지 확인해 주세요.'); }
});

// 여러 장 한번에: 파일명이 01~08로 시작하면 해당 슬롯에, 아니면 남은 슬롯에 이름순으로 배정
const bulkInput = document.getElementById('bulk-input');
document.getElementById('bulk-upload-btn').addEventListener('click', () => { bulkInput.value = ''; bulkInput.click(); });
bulkInput.addEventListener('change', async () => {
  const files = [...bulkInput.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!files.length) return;
  const used = new Set(), leftover = [], jobs = [];
  files.forEach(f => {
    const m = f.name.match(/^0*([1-8])(?!\d)/);
    if (m && !used.has(+m[1])) { used.add(+m[1]); jobs.push([PART_SLOTS[+m[1] - 1].key, f]); }
    else leftover.push(f);
  });
  let skipped = 0;
  leftover.forEach(f => {
    const idx = PART_SLOTS.findIndex((s, i) => !used.has(i + 1));
    if (idx < 0) { skipped++; return; }
    used.add(idx + 1);
    jobs.push([PART_SLOTS[idx].key, f]);
  });
  try {
    await Promise.all(jobs.map(([k, f]) => assignCustomPart(k, f)));
    refreshAfterUpload();
    setHint(jobs.length + '장 업로드 완료' + (skipped ? ` (슬롯이 가득 차 ${skipped}장은 제외)` : '') + '. ★ 표시가 직접 올린 이미지예요.');
  } catch (err) { setHint('일부 이미지를 읽지 못했어요.'); }
});

document.getElementById('reset-custom-btn').addEventListener('click', () => {
  Object.keys(customParts).forEach(k => delete customParts[k]);
  rebuildAllParts(false);
  setHint('직접 올린 이미지를 모두 지우고 자동 생성으로 되돌렸어요.');
});

// 눈감기 고정 테스트 버튼 (깜빡일 때 위화감이 없는지 즉시 확인용)
const testBlinkBtn = document.getElementById('test-blink-btn');
testBlinkBtn.addEventListener('click', () => {
  forceBlinkTest = !forceBlinkTest;
  testBlinkBtn.style.background = forceBlinkTest ? '#00b894' : '#3a3a52';
  testBlinkBtn.textContent = forceBlinkTest ? '👁️ 눈감기 고정 중 (클릭해 해제)' : '👁️ 눈감기 상태 고정 테스트';
  applyCurrentLayers();
});

// =========================================================================
// 4. 아바타 렌더링 & 감정/입모양 프리뷰 & 마이크 연동
// =========================================================================
const avatarEl = document.getElementById('avatar');
const baseEl   = document.getElementById('part-base');
const eyesEl   = document.getElementById('part-eyes');
const mouthEl  = document.getElementById('part-mouth');
const fxEl     = document.getElementById('part-fx');
const toastEl  = document.getElementById('toast');

let currentExpKey = 'normal';
let currentMouthStep = 0;
let isBlinking = false;
let baseThreshold = 15;
let micGain = 1.0;
let smoothedVol = 0;
let toastTimer = null;

function applyCurrentLayers() {
  const exp = GENERATED[currentExpKey];
  baseEl.src  = GENERATED.base;
  fxEl.src    = exp.fx;
  const showClosed = forceBlinkTest || (isBlinking && exp.blink);
  eyesEl.src  = showClosed ? exp.eyesClosed : exp.eyesOpen;
  mouthEl.src = exp.mouths[currentMouthStep];
}

function setExpression(expKey) {
  if (!GENERATED[expKey]) return;
  currentExpKey = expKey;
  applyCurrentLayers();
  document.querySelectorAll('.exp-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.exp === expKey);
  });
  avatarEl.classList.remove('avatar-pop');
  void avatarEl.offsetWidth;
  avatarEl.classList.add('avatar-pop');
}

// 마이크를 켜지 않고도 0~3단계 입 모양 크기를 클릭해서 즉시 확인하는 기능
function previewMouthStep(step) {
  document.getElementById(`dot-${currentMouthStep}`).classList.remove('active');
  document.getElementById(`dot-${step}`).classList.add('active');
  currentMouthStep = step;
  applyCurrentLayers();
}

// 내보내기/업로드 슬롯 8개 (파일명 앞 번호 = 슬롯 번호)
const PART_SLOTS = [
  { key: 'base',       name: '01_base.png',        label: '베이스' },
  { key: 'eyesOpen',   name: '02_eyes_open.png',   label: '눈(뜸)' },
  { key: 'eyesClosed', name: '03_eyes_closed.png', label: '눈(감음)' },
  { key: 'eyesHappy',  name: '04_eyes_happy.png',  label: '눈(해피)' },
  { key: 'mouth0',     name: '05_mouth_0.png',     label: '입 0단계' },
  { key: 'mouth1',     name: '06_mouth_1.png',     label: '입 1단계' },
  { key: 'mouth2',     name: '07_mouth_2.png',     label: '입 2단계' },
  { key: 'mouth3',     name: '08_mouth_3.png',     label: '입 3단계' }
];
const customParts = {};   // 직접 업로드한 이미지 { slotKey: dataURL }

function slotUrl(key) {
  switch (key) {
    case 'base':       return GENERATED.base;
    case 'eyesOpen':   return GENERATED.normal.eyesOpen;
    case 'eyesClosed': return GENERATED.normal.eyesClosed;
    case 'eyesHappy':  return GENERATED.happy.eyesOpen;
    default:           return GENERATED.normal.mouths[+key.slice(5)];
  }
}

// 업로드한 이미지를 자동 생성 결과 위에 덮어씀 (눈 감음은 모든 표정 공용)
function applyCustomParts() {
  const c = customParts;
  if (c.base) GENERATED.base = c.base;
  if (c.eyesOpen) GENERATED.normal.eyesOpen = c.eyesOpen;
  if (c.eyesClosed) ['normal', 'happy', 'shock', 'angry'].forEach(k => { GENERATED[k].eyesClosed = c.eyesClosed; });
  if (c.eyesHappy) GENERATED.happy.eyesOpen = c.eyesHappy;
  for (let i = 0; i < 4; i++) {
    if (c['mouth' + i]) GENERATED.normal.mouths[i] = c['mouth' + i];
  }
}

let lastCardSig = '';
function renderExportCards() {
  const grid = document.getElementById('export-grid');
  // 내용이 그대로면 DOM을 다시 그리지 않음 (포커스 이동 중 버튼 클릭이 사라지는 것 방지)
  const sig = PART_SLOTS.map(s => (customParts[s.key] ? '*' : '') + slotUrl(s.key)).join('|');
  if (sig === lastCardSig && grid.childElementCount) return;
  lastCardSig = sig;
  grid.innerHTML = '';
  PART_SLOTS.forEach(slot => {
    const url = slotUrl(slot.key);
    const isCustom = !!customParts[slot.key];
    const card = document.createElement('div');
    card.className = 'part-card' + (isCustom ? ' custom' : '');
    card.innerHTML = `<img src="${url}" title="클릭하면 다운로드"><div>${slot.label}${isCustom ? ' ★' : ''}</div>`;
    card.querySelector('img').onclick = () => {
      const a = document.createElement('a');
      a.href = url; a.download = slot.name; a.click();
    };

    const actions = document.createElement('div');
    actions.className = 'part-actions';
    const upBtn = document.createElement('button');
    upBtn.textContent = '⬆ 업로드';
    upBtn.onclick = (e) => { e.stopPropagation(); pickFileForSlot(slot.key); };
    actions.appendChild(upBtn);
    if (isCustom) {
      const resetBtn = document.createElement('button');
      resetBtn.textContent = '↺';
      resetBtn.title = '자동 생성으로 되돌리기';
      resetBtn.onclick = (e) => { e.stopPropagation(); delete customParts[slot.key]; rebuildAllParts(false); };
      actions.appendChild(resetBtn);
    }
    card.appendChild(actions);
    grid.appendChild(card);
  });
}

// 자동 눈 깜빡임
function scheduleBlink() {
  setTimeout(() => {
    const exp = GENERATED[currentExpKey];
    if (exp.blink && !forceBlinkTest) {
      isBlinking = true;
      eyesEl.src = exp.eyesClosed;
      setTimeout(() => {
        isBlinking = false;
        eyesEl.src = GENERATED[currentExpKey].eyesOpen;
        scheduleBlink();
      }, 140);
    } else {
      scheduleBlink();
    }
  }, Math.random() * 3500 + 2500);
}
scheduleBlink();

// 탭 & 방송 모드 제어
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach((btn, idx) => {
    btn.classList.toggle('active', (tabName === 'rig' && idx === 0) || (tabName === 'mic' && idx === 1));
  });
  document.getElementById('tab-rig').classList.toggle('active', tabName === 'rig');
  document.getElementById('tab-mic').classList.toggle('active', tabName === 'mic');
}

function toggleStreamMode() {
  const isStream = document.body.classList.toggle('stream-mode');
  if (isStream) {
    clearTimeout(toastTimer);
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
  } else {
    toastEl.classList.remove('show');
  }
}

document.getElementById('avatar-box').addEventListener('dblclick', toggleStreamMode);
document.getElementById('bg-select').addEventListener('change', (e) => {
  document.body.classList.remove('bg-transparent', 'bg-green', 'bg-blue');
  document.body.classList.add(e.target.value);
});

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const keyMap = { '1': 'normal', '2': 'happy', '3': 'shock', '4': 'angry' };
  if (keyMap[e.key] && currentExpKey !== keyMap[e.key]) {
    setExpression(keyMap[e.key]);
  } else if (e.key.toLowerCase() === 'h' || e.key === 'ㅗ') {
    toggleStreamMode();
  }
});

// 이미지 업로드 핸들러
function handleImageFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      Object.keys(customParts).forEach(k => delete customParts[k]);
      rebuildAllParts(true);
      runAutoDetect();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

document.getElementById('file-input').addEventListener('change', (e) => handleImageFile(e.target.files[0]));
const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); });
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) handleImageFile(e.dataTransfer.files[0]);
});

// 초기 실행
syncSlidersFromBox();
rebuildAllParts(true);

// 마이크 오디오 루프
const thresholdSlider = document.getElementById('threshold-slider');
const gainSlider = document.getElementById('gain-slider');
const line1 = document.getElementById('line-1');
const line2 = document.getElementById('line-2');
const line3 = document.getElementById('line-3');

thresholdSlider.addEventListener('input', (e) => {
  baseThreshold = Number(e.target.value);
  document.getElementById('threshold-val').textContent = `${baseThreshold}%`;
  const remain = 100 - baseThreshold;
  line1.style.left = `${baseThreshold}%`;
  line2.style.left = `${baseThreshold + remain * 0.28}%`;
  line3.style.left = `${baseThreshold + remain * 0.60}%`;
});

gainSlider.addEventListener('input', (e) => {
  micGain = Number(e.target.value);
  document.getElementById('gain-val').textContent = `${micGain.toFixed(1)}x`;
});

document.getElementById('start-btn').addEventListener('click', async (e) => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } 
    });
    e.target.textContent = "✅ 마이크 작동 중";
    e.target.disabled = true;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const floatData = new Float32Array(analyser.fftSize);

    function updateLoop() {
      analyser.getFloatTimeDomainData(floatData);

      let sumSquares = 0;
      for (let i = 0; i < floatData.length; i++) sumSquares += floatData[i] * floatData[i];
      const rms = Math.sqrt(sumSquares / floatData.length);
      const rawVol = Math.min(100, Math.pow(rms * micGain * 4.5, 1.4) * 100);

      smoothedVol = (rawVol > smoothedVol)
        ? smoothedVol * 0.55 + rawVol * 0.45
        : smoothedVol * 0.82 + rawVol * 0.18;

      document.getElementById('volume-bar').style.width = `${smoothedVol}%`;
      document.getElementById('vol-num').textContent = `${Math.round(smoothedVol)}%`;

      const remain = 100 - baseThreshold;
      let targetStep = 0;
      if (smoothedVol >= baseThreshold + remain * 0.60) targetStep = 3;
      else if (smoothedVol >= baseThreshold + remain * 0.28) targetStep = 2;
      else if (smoothedVol >= baseThreshold) targetStep = 1;

      if (targetStep !== currentMouthStep) {
        previewMouthStep(targetStep);
      }

      if (currentMouthStep > 0) {
        const intensity = Math.min(1, (smoothedVol - baseThreshold) / 50);
        const lift = intensity * 4.5;
        const stretchX = 1 + intensity * 0.02;
        const squashY  = 1 - intensity * 0.018;

        baseEl.style.transform  = `translateY(-${lift * 0.5}px) scale(${stretchX}, ${squashY})`;
        eyesEl.style.transform  = `translateY(-${lift * 0.8}px)`;
        fxEl.style.transform    = `translateY(-${lift * 0.8}px)`;
        mouthEl.style.transform = `translateY(-${lift * 0.8}px) scale(${1 + intensity * 0.06})`;
      } else {
        baseEl.style.transform  = `translateY(0px) scale(1, 1)`;
        eyesEl.style.transform  = `translateY(0px)`;
        fxEl.style.transform    = `translateY(0px)`;
        mouthEl.style.transform = `translateY(0px) scale(1)`;
      }

      requestAnimationFrame(updateLoop);
    }

    updateLoop();
  } catch (err) {
    alert('마이크 권한을 허용해주세요: ' + err.message);
  }
});
