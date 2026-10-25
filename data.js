// data.js — 기본 샘플 이미지 + 초기 설정값 (script.js보다 먼저 로드해야 함)
// =========================================================================
// 0. 기본 내장 샘플 캐릭터 (반측면 구도의 트릭컬 네르 스타일)
// =========================================================================
function createDefaultSampleCanvas() {
  const c = document.createElement('canvas');
  c.width = 400; c.height = 400;
  const ctx = c.getContext('2d');
  const line = '#463239';

  // 베일 및 몸통
  ctx.fillStyle = '#57586b'; ctx.strokeStyle = line; ctx.lineWidth = 4.5;
  ctx.beginPath(); ctx.arc(195, 195, 115, Math.PI*0.85, Math.PI*0.15, false); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#4e5266';
  ctx.beginPath(); ctx.moveTo(135, 235); ctx.quadraticCurveTo(185, 220, 235, 235);
  ctx.lineTo(255, 370); ctx.lineTo(115, 370); ctx.closePath(); ctx.fill(); ctx.stroke();

  // 볼살 얼굴
  ctx.fillStyle = '#fff1eb';
  ctx.beginPath();
  ctx.moveTo(105, 165); ctx.quadraticCurveTo(175, 120, 245, 165);
  ctx.quadraticCurveTo(275, 210, 235, 232); ctx.quadraticCurveTo(170, 242, 110, 232);
  ctx.quadraticCurveTo(70, 210, 105, 165); ctx.closePath(); ctx.fill(); ctx.stroke();

  // 볼터치
  ctx.fillStyle = 'rgba(255, 130, 130, 0.55)';
  ctx.beginPath(); ctx.ellipse(106, 206, 22, 13, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(216, 206, 22, 13, 0, 0, Math.PI*2); ctx.fill();

  // 앞머리
  ctx.fillStyle = '#f3dcc3';
  ctx.beginPath();
  ctx.moveTo(95, 162); ctx.quadraticCurveTo(175, 105, 255, 162);
  ctx.lineTo(235, 155); ctx.lineTo(205, 162); ctx.lineTo(165, 155); ctx.lineTo(125, 162);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // 반측면 눈 (왼눈과 오른눈 크기가 다름)
  const drawSampleEye = (ex, ey, ew, eh) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.roundRect(ex - ew/2, ey - eh/2, ew, eh, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8c96c8';
    ctx.beginPath(); ctx.arc(ex, ey + 2, eh*0.42, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#5c434c';
    ctx.fillRect(ex - ew/2, ey - eh/2, ew, eh*0.42);
    ctx.strokeRect(ex - ew/2, ey - eh/2, ew, eh);
  };
  drawSampleEye(132, 184, 34, 22);
  drawSampleEye(202, 184, 38, 22);

  // 작고 오밀조밀한 입 (정중앙에서 살짝 왼쪽으로 치우침)
  ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.arc(166, 203, 5, 0.15*Math.PI, 0.85*Math.PI); ctx.stroke();
  return c;
}

// =========================================================================
// 초기 설정 데이터
// =========================================================================
const CANV_SIZE = 400;

// 올려주신 트릭컬 네르 이미지의 실제 이목구비 좌표에 맞춘 초기값 (%)
const rigBoxes = {
  eyeL:  { x: 33.0, y: 46.0, w: 9.5,  h: 6.5, color: '#0984e3', label: 'L' },
  eyeR:  { x: 50.5, y: 46.0, w: 10.5, h: 6.5, color: '#00b894', label: 'R' },
  mouth: { x: 41.5, y: 51.0, w: 4.5,  h: 3.2, color: '#ff7675', label: 'M' }
};

const GENERATED = {
  base: '',
  normal: { blink: true,  eyesOpen: '', eyesClosed: '', fx: '', mouths: [] },
  happy:  { blink: false, eyesOpen: '', eyesClosed: '', fx: '', mouths: [] },
  shock:  { blink: true,  eyesOpen: '', eyesClosed: '', fx: '', mouths: [] },
  angry:  { blink: true,  eyesOpen: '', eyesClosed: '', fx: '', mouths: [] }
};
