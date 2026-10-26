// apostles.js
// data.js의 APX 데이터를 스무고개 게임 포맷으로 자동 변환합니다.

(function() {
  const rawAPX = window.APX || {};
  
  // 성격 코드 매핑 (data.js의 g 배열 두 번째 값 기준)
  // 0: 순수, 1: 광기, 2: 우울, 3: 활발, 4: 냉정 등
  const personalityMap = { 0: "순수", 1: "광기", 2: "우울", 3: "활발", 4: "냉정", 5: "순수" };

  window.APOSTLE_DB = Object.keys(rawAPX).map(key => {
    const char = rawAPX[key];
    
    // 성격 추출
    const pIndex = (Array.isArray(char.g) && char.g.length > 1) ? char.g[1] : 0;
    const personality = personalityMap[pIndex] || "순수";

    // 등급 판정 (엘다인 여부 등)
    let grade = "3성";
    if (char.at === 5 || (char.sk && char.sk.length > 3)) {
      grade = "엘다인";
    }

    // 공격 타입 (1: 물리, 2: 마법)
    const attackType = char.at === 1 ? "물리" : "마법";

    // 색상
    let colors = ["#8B5CF6", "#C4B5FD"];
    if (char.c) {
      colors = [`#${char.c}`, `#8B5CF6`];
    }

    return {
      name: char.n || "이름없음",
      personality: personality,
      race: "수인", // 기본 종족
      row: "중열",  // 기본 배치 열
      role: "딜러", // 역할군
      attackType: attackType,
      grade: grade,
      weapon: char.t || "", // 칭호
      favFood: "",
      hateFood: "",
      trait: char.d ? char.d.split("\n")[0] : "", // 설명 첫 줄
      lowSkill: (char.sk && char.sk[0]) ? char.sk[0][1] : "",
      highSkill: (char.sk && char.sk[2]) ? char.sk[2][1] : "",
      aside: (char.ae && char.ae[0]) ? char.ae[0][0] : "",
      colors: colors,
      quote: char.t || "엘리아스의 사도입니다.",
      // 초상화 이미지 경로 (기존 계산기 폴더 구조에 맞춤, 없으면 빈값)
      imageUrl: `img/${key}.png`
    };
  });

  console.log(`[스무고개] 사도 데이터 변환 완료: 총 ${window.APOSTLE_DB.length}명`);
})();