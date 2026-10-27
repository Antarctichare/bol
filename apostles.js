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
    const a1 = (c.a1 && c.a1.n) || "";
    const a2 = (c.a2 && c.a2.n) || "";
    const a3 = (c.a3 && c.a3.n) || "";
    const hasAside = Boolean(a1 || a2 || a3);

    return {
      name: c.n || "이름없음",
      personality: PERSONALITY[c.pe] || "",
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
      aside1: a1,
      aside2: a2,
      aside3: a3,
      hasAside: hasAside,        // 어사이드 보유 여부 플래그
      colors: c.c ? ["#" + c.c] : [],
      quote: c.t || "",
      imageUrl: "img/" + key + ".png"
    };
  });

  console.log("[스무고개] 사도 데이터 변환 완료: 총 " + window.APOSTLE_DB.length + "명");
})();
