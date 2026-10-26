// apostles.js
// data.js의 window.APX를 스무고개 게임 포맷(window.APOSTLE_DB)으로 변환합니다.
// ※ data.js는 반드시 이 파일보다 먼저 로드되어야 합니다.

(function () {
  const rawAPX = window.APX || {};
  if (Object.keys(rawAPX).length === 0) {
    console.error("[스무고개] window.APX가 비어 있습니다. data.js 로드 순서/경로를 확인하세요.");
  }

  // pe: 성격 코드 (나무위키 성격별 목록과 135명 전원 일치 확인)
  const PERSONALITY = { 0: "순수", 1: "냉정", 2: "광기", 3: "활발", 4: "우울", 5: "공명" };

  window.APOSTLE_DB = Object.keys(rawAPX).map(function (key) {
    const c = rawAPX[key];

    return {
      name: c.n || "이름없음",
      personality: PERSONALITY[c.pe] || "",
      // 데이터에 없는 항목은 빈 값으로 둡니다 (index.html이 빈 값 힌트는 자동 제외)
      race: c.r || "",
      row: c.rw || "",
      role: c.rl || "",
      attackType: c.at === 1 ? "물리" : c.at === 2 ? "마법" : "",
      grade: c.gr || "",
      release: c.rel || "",
      weapon: c.t || "",          // 사도 칭호
      favFood: c.fv || "",         // 매우 좋아함 (취향표의 업그레이드 요리명)
      hateFood: (c.fh || []).join(" / "), // 싫어함 2종
      trait: c.d ? c.d.split("\n")[0].trim() : "",
      lowSkill: c.lo || "",       // 저학년 스킬 (SP로 발동)
      highSkill: c.hi || "",     // 고학년 스킬 (쿨타임)
      aside: (c.ae && c.ae[0]) || "",
      // 실제 데이터(c)에 있는 대표 색상만 사용. 없으면 빈 배열 → 힌트가 "미입력"으로 표시됨
      colors: c.c ? ["#" + c.c] : [],
      quote: c.t || "",
      imageUrl: "img/" + key + ".png" // 코페는 key가 "kope" → 실제 사도 ID로 맞추세요
    };
  });

  console.log("[스무고개] 사도 데이터 변환 완료: 총 " + window.APOSTLE_DB.length + "명");
})();
