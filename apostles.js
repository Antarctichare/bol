// apostles.js
// data.js의 window.APX를 스무고개 게임 포맷(window.APOSTLE_DB)으로 변환합니다.
// ※ data.js는 반드시 이 파일보다 먼저 로드되어야 합니다.

(function () {
  const rawAPX = window.APX || {};
  if (Object.keys(rawAPX).length === 0) {
    console.error("[스무고개] window.APX가 비어 있습니다. data.js 로드 순서/경로를 확인하세요.");
  }

  // pe: 성격 코드 (0~4가 각각 27명 안팎으로 고르게 분포 → 성격 값으로 판단)
  const PERSONALITY = { 0: "순수", 1: "냉정", 2: "광기", 3: "활발", 4: "우울" };

  window.APOSTLE_DB = Object.keys(rawAPX).map(function (key) {
    const c = rawAPX[key];

    return {
      name: c.n || "이름없음",
      personality: PERSONALITY[c.pe] || "",
      // 데이터에 없는 항목은 빈 값으로 둡니다 (index.html이 빈 값 힌트는 자동 제외)
      race: "",
      row: "",
      role: "",
      attackType: c.at === 1 ? "물리" : c.at === 2 ? "마법" : "",
      grade: "",
      weapon: c.t || "",          // 사도 칭호
      favFood: "",
      hateFood: "",
      trait: c.d ? c.d.split("\n")[0].trim() : "",
      lowSkill: c.lo || "",       // 4학년 해금 스킬(SP 사용)
      highSkill: c.hi || "",      // 8학년 해금 스킬(쿨타임)
      aside: (c.ae && c.ae[0]) || "",
      colors: c.c ? ["#" + c.c, "#8B5CF6"] : ["#8B5CF6", "#C4B5FD"],
      quote: c.t || "",
      imageUrl: "img/" + key + ".png"
    };
  });

  console.log("[스무고개] 사도 데이터 변환 완료: 총 " + window.APOSTLE_DB.length + "명");
})();
