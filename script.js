/* =========================================================
   집중력 두더지 - script.js
   1순위: 이미지 없이 도형/색으로 처음~끝까지 플레이 가능한 버전
   (이미지 경로는 미리 잡아두고, 파일이 없으면 색상 블록으로 대체됨)
========================================================= */

/* ---------- Firebase 초기화 (온라인 랭킹) ---------- */
/* 이 블록이 실패해도(광고차단/네트워크 문제 등) 게임 자체는 계속 동작하도록
   반드시 try/catch로 감싸고, 실패 시 db를 null로 두어 이후 코드에서 방어적으로 처리함 */
const firebaseConfig = {
  apiKey: "AIzaSyCBL6ZusKbNFXyK0RL-iukpl6z1F2dU0MQ",
  authDomain: "mymolegame.firebaseapp.com",
  projectId: "mymolegame",
  storageBucket: "mymolegame.firebasestorage.app",
  messagingSenderId: "1001599850545",
  appId: "1:1001599850545:web:50c6d04e40b359985e1d10",
  measurementId: "G-Z6NHPZ8630",
};

let db = null;
try {
  if (typeof firebase !== "undefined") {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
  } else {
    console.warn("Firebase SDK를 불러오지 못했습니다. 랭킹 기능이 비활성화됩니다.");
  }
} catch (err) {
  console.warn("Firebase 초기화 실패. 랭킹 기능이 비활성화됩니다.", err);
  db = null;
}

/* ---------- DOM 참조 (다른 모든 코드보다 먼저 정의되어야 함) ---------- */
const $ = (id) => document.getElementById(id);
const screens = {
  main: $("screen-main"),
  difficulty: $("screen-difficulty"),
  math: $("screen-math"),
  countdown: $("screen-countdown"),
  game: $("screen-game"),
  result: $("screen-result"),
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.remove("active"));
  screens[name].classList.add("active");
}

// Firestore 문서 ID로 쓸 수 있게 닉네임을 정리 ('/' 금지, 길이 제한, 빈 값 방지)
// 중복 판정은 대소문자/공백 차이를 무시해야 하므로, ID를 만들 때는 소문자로 통일하고
// 내부의 연속 공백도 하나로 합침 (실제 화면에 보여줄 닉네임 표기는 원본 그대로 별도 저장됨)
function sanitizeNicknameForDocId(nickname) {
  let id = (nickname || "익명").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 60);
  id = id.replace(/\//g, "_");
  if (!id) id = "익명";
  if (id === "." || id === "..") id = "_" + id;
  return id;
}

// 난이도별 컬렉션에 점수 저장. 닉네임을 문서 ID로 사용해 같은 난이도 내에서는
// 같은 닉네임이 항상 최고 점수 하나만 남도록 함(기록 갱신 시에만 덮어씀).
async function saveScoreToFirebase(difficulty, nickname, score, firstMathTime, secondMathTime) {
  if (!db) return null; // Firebase 사용 불가 시 조용히 건너뜀 (게임 진행에는 영향 없음)
  const safeFirst = Number.isFinite(firstMathTime) ? Number(firstMathTime.toFixed(2)) : 0;
  const safeSecond = Number.isFinite(secondMathTime) ? Number(secondMathTime.toFixed(2)) : 0;
  const safeScore = Number.isFinite(score) ? score : 0;
  const docId = sanitizeNicknameForDocId(nickname);
  const docRef = db.collection(`scores_${difficulty}`).doc(docId);

  try {
    let effectiveScore = safeScore;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const prevScore = snap.exists ? snap.data().score : null;
      if (prevScore !== null && prevScore >= safeScore) {
        effectiveScore = prevScore; // 기존 기록이 더 높으면 그대로 유지
        return;
      }
      tx.set(docRef, {
        nickname: nickname || "익명",
        score: safeScore,
        firstMathTime: safeFirst,
        secondMathTime: safeSecond,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    return effectiveScore; // 최종적으로 랭킹에 반영된(최고) 점수
  } catch (err) {
    console.error("랭킹 저장 실패:", err);
    return null;
  }
}

// 특정 점수가 난이도별 랭킹에서 몇 등인지 계산 (자신보다 점수가 높은 사람 수 + 1)
async function getRankForScore(difficulty, score) {
  if (!db) return null;
  try {
    const snap = await db.collection(`scores_${difficulty}`).where("score", ">", score).get();
    return snap.size + 1;
  } catch (err) {
    console.error("순위 계산 실패:", err);
    return null;
  }
}

// 랭킹 페이지네이션 상태
const rankingState = {
  difficulty: "easy",
  pageIndex: 0,       // 0부터 시작
  pageSize: 10,
  cursors: [null],    // cursors[i] = i번째 페이지의 시작 지점(이전 페이지 마지막 문서), [0]=null(첫 페이지)
  lastDocOfPage: null, // 현재 페이지의 마지막 문서(다음 페이지 커서로 사용)
  hasNextPage: false,
};

async function loadRankingPage(difficulty, pageIndex) {
  const body = $("ranking-body");

  // pageIndex가 어떤 이유로든 숫자가 아니게 들어와도(0으로) 안전하게 보정
  const safePageIndex = Number.isFinite(Number(pageIndex)) ? Number(pageIndex) : 0;
  if (safePageIndex !== pageIndex) {
    console.warn("loadRankingPage: pageIndex가 숫자가 아니어서 0으로 보정됨:", pageIndex);
  }
  pageIndex = safePageIndex;

  if (!db) {
    body.innerHTML = `<p class="muted">랭킹 기능을 사용할 수 없습니다. (네트워크 또는 광고 차단 확장 프로그램을 확인해주세요)</p>`;
    updateRankingPagerButtons();
    return;
  }

  body.innerHTML = `<p class="muted">불러오는 중...</p>`;
  rankingState.difficulty = difficulty;
  rankingState.pageIndex = pageIndex;

  try {
    let query = db.collection(`scores_${difficulty}`).orderBy("score", "desc").limit(rankingState.pageSize);
    const cursor = rankingState.cursors[pageIndex];
    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();

    if (snapshot.empty && pageIndex === 0) {
      body.innerHTML = `<p class="muted">아직 기록이 없습니다.</p>`;
      $("ranking-page-label").textContent = `1페이지`;
      rankingState.hasNextPage = false;
      updateRankingPagerButtons();
      return;
    }

    let html = `<ol class="ranking-list" start="${pageIndex * rankingState.pageSize + 1}">`;
    let rankCounter = pageIndex * rankingState.pageSize; // 이 페이지 시작 전까지의 순위 개수
    const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };
    snapshot.forEach((doc) => {
      // 주의: Firestore의 snapshot.forEach는 일반 배열 forEach와 달리 인덱스를 넘겨주지 않는다.
      // (doc, i) 형태로 i를 받으면 i는 항상 undefined가 되어 NaN의 원인이 되므로 직접 카운터를 센다.
      rankCounter++;
      const d = doc.data();
      const safeScore = safeNumber(d.score);
      const safeFirst = safeNumber(d.firstMathTime);
      const safeSecond = safeNumber(d.secondMathTime);
      const topClass = rankCounter <= 3 ? ` rank-top rank-top-${rankCounter}` : "";
      const medal = medals[rankCounter] ? `${medals[rankCounter]} ` : "";
      html += `<li class="ranking-item${topClass}">
        <span class="rank-num">${medal}${rankCounter}</span>
        <span class="rank-name">${escapeHtml(d.nickname ?? "익명")}</span>
        <span class="rank-score">${safeScore}점</span>
        <span class="rank-math">문제풀이 ${safeFirst}s → ${safeSecond}s</span>
      </li>`;
    });
    html += `</ol>`;
    body.innerHTML = html;

    // 다음 페이지 존재 여부 확인 (페이지 크기만큼 꽉 찼으면 다음 페이지가 있을 수 있음)
    rankingState.lastDocOfPage = snapshot.docs[snapshot.docs.length - 1] || null;
    rankingState.hasNextPage = snapshot.docs.length === rankingState.pageSize;
    if (rankingState.hasNextPage && !rankingState.cursors[pageIndex + 1]) {
      rankingState.cursors[pageIndex + 1] = rankingState.lastDocOfPage;
    }

    $("ranking-page-label").textContent = `${pageIndex + 1}페이지`;
    updateRankingPagerButtons();
  } catch (err) {
    console.error("랭킹 조회 실패:", err);
    body.innerHTML = `<p class="muted">랭킹을 불러오지 못했습니다.</p>`;
  }
}

function updateRankingPagerButtons() {
  $("btn-rank-prev").disabled = rankingState.pageIndex === 0;
  $("btn-rank-next").disabled = !rankingState.hasNextPage;
}

$("btn-rank-prev").addEventListener("click", () => {
  if (rankingState.pageIndex > 0) {
    loadRankingPage(rankingState.difficulty, rankingState.pageIndex - 1);
  }
});
$("btn-rank-next").addEventListener("click", () => {
  if (rankingState.hasNextPage) {
    loadRankingPage(rankingState.difficulty, rankingState.pageIndex + 1);
  }
});

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : "-";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ---------- 전역 상태 ---------- */
const state = {
  nickname: "",
  difficulty: "normal",
  score: 0,
  timeLeft: 60,
  timerId: null,
  spawnTimerId: null,
  isPaused: false,
  isMuted: false,
  goldActive: false,   // 다음 점수 2배 여부
  logoClickCount: 0,
  impossibleUnlocked: false,
  firstMathTime: null,  // 1차 수학문제 풀이 시간(초)
  secondMathTime: null, // 2차 수학문제 풀이 시간(초)
  mathAnswer: 0,
  mathStartTs: 0,
  mathPhase: "first",   // "first" | "second"
  mathSpeedBonus: 0,    // 1차 수학 문제를 빠르게 풀었을 때 받는 시작 점수 보너스
  zombieBlurActive: false,  // 좀비 클릭 후 3초간 화면 블러 상태인지
  zombieViolated: false,    // 블러 상태에서 다른 곳을 클릭했는지(위반)
  clicksBlocked: false,     // 위반 페널티로 클릭 자체가 무시되는 상태인지
  endermanActive: false,    // 엔더맨 효과(모든 득점/감점 반전 + 보라색 화면)가 활성 중인지
  isMobile: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent),
};

/* ---------- 난이도별 세부 수치 (PC 기준, 임시값 - 추후 조정) ---------- */
const DIFFICULTY_CONFIG = {
  easy:       { spawnInterval: 1400, maxOnScreen: 5,  lifeTime: 1500 },
  normal:     { spawnInterval: 1100, maxOnScreen: 8,  lifeTime: 1200 },
  hard:       { spawnInterval: 1000, maxOnScreen: 11, lifeTime: 1060 },
  impossible: { spawnInterval: 550,  maxOnScreen: 20, lifeTime: 500 },
};

/* ---------- 목표 종류별 점수/확률/스폰가중치 ---------- */
const TARGET_TYPES = [
  { key: "mole",       weight: 32, className: "target-mole",       image: "images/mole.png" },
  { key: "diamond",    weight: 12, className: "target-diamond",    image: "images/diamond.png" },
  { key: "emerald",    weight: 12, className: "target-emerald",    image: "images/emerald.png" },
  { key: "creeper",    weight: 12, className: "target-creeper",    image: "images/creeper.png" },
  { key: "silverfish", weight: 8,  className: "target-silverfish", image: "images/silverfish.png" },
  { key: "gold",       weight: 4,  className: "target-gold",       image: "images/gold.png" },
  { key: "tnt",        weight: 8,  className: "target-tnt",        image: "images/tnt.png" },
  { key: "zombie",     weight: 8,  className: "target-zombie",     image: "images/zombie.png" },
  { key: "enderman",   weight: 4,  className: "target-enderman",   image: "images/enderman.png" },
];
const TOTAL_WEIGHT = TARGET_TYPES.reduce((s, t) => s + t.weight, 0);
const EMERALD_SUCCESS_RATE = 0.85; // 80% -> 85%로 상향 (TNT/좀비 추가에 따른 밸런스 보정)

/* ---------- 등급 구간 (PC 기준, 모바일은 난이도별 페널티 적용 — 높은 등급일수록 간격이 점점 넓어짐) ---------- */
const GRADES_NORMAL = [
  { name: "벤치급", min: 0 },
  { name: "날강두급", min: 20 },
  { name: "런닝머신두급", min: 45 },
  { name: "중롱도르급", min: 75 },
  { name: "호날두급", min: 115 },
  { name: "킹갓두급", min: 165 },
  { name: "챔스의사나이급", min: 225 },
  { name: "5발롱5챔스의전설월드컵6회연속출전및연속득점킹갓Cristiano Ronaldo dos Santos Aveiro급", min: 300 },
];
const GRADES_IMPOSSIBLE = [
  { name: "강등위기닭집급", min: 0 },
  { name: "17년무관급", min: 20 },
  { name: "PK실축급", min: 45 },
  { name: "아우디컵우승급", min: 75 },
  { name: "챔피언스리그우승급", min: 110 },
  { name: "탄소기반유기체역사상유일무이언터져블대체불가. 룩셈부로크의 제앙, 산마리노를 박살내 교황청을 경악하게 한 자. 리히텐슈타인의 사형집행인, 지브롤터에 절망을 선사하는 자, 페로제도의 폭풍을 몰고 오는 자. 에스토니아에 진노의 일곱 대접을 쏟아붓는 자, 아르메니아에 멸망의 계시록을 낭독하는 자, 몰도바를 심연으로 가라앉히는 자. 우즈베키스탄을 찢어버리는 자, 안도라에 6골 폭격을 퍼붓는 자, 카자흐스탄을 중앙아시아에서 가장 불행한 나라로 만든 카자흐 파멸자. 몰타를 국제전에서 박살낸 몰타 학살귀, 키프로스를 완전 관광시킨 키프로스 파멸자, 리투아니아를 7골로 울음바다 만든 리투아니아 학살자, 말뫼 FF를 파괴해 즐라탄의 분노를 사는 자. 갈라타사라이 팬들의 눈물로 해수면 상승을 일으키는 자, 전 세계 팬들의 뜨거운 열기로 지구온난화를 일으키는 자. 그러나, 콩고민주공화국에게는 압도적인 강자로서 자비를 베푸는 킹갓호날두급", min: 150 },
];
// 등급 이미지 파일명 매핑 (end_images/n1.png ~ n8.png, i1.png ~ i6.png)
const GRADE_IMAGE_MAP_NORMAL = ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"];
const GRADE_IMAGE_MAP_IMPOSSIBLE = ["i1", "i2", "i3", "i4", "i5", "i6"];

const GOOD_END_CUT = { easy: 115, normal: 115, hard: 115, impossible: 75 };
// 모바일은 손가락으로 여러 표적을 동시에 터치하기 쉬워 점수를 얻기 유리하므로, 같은 등급을 받으려면 PC보다 더 높은 점수가 필요함
// impossible은 이미 극악한 난이도라 다른 난이도보다는 페널티를 완화함(20~30점대)
const MOBILE_BONUS = { easy: 45, normal: 45, hard: 45, impossible: 35 };

/* =========================================================
   사운드 (Web Audio API로 카운트다운 비프음 생성, 나머지는 미리 로드해둔 버퍼로 즉시 재생)
========================================================= */
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playBeep(freq = 440, duration = 0.15) {
  if (state.isMuted) return;
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = "sine";
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

const SOUND_FILES = {
  bad: "sounds/bad.mp3",
  badend: "sounds/badend.mp3",
  diamond: "sounds/diamond.mp3",
  explosion: "sounds/explosion.mp3",
  firework: "sounds/firework.mp3",
  goodend: "sounds/goodend.mp3",
  thunder: "sounds/thunder.mp3",
  zombie: "sounds/zombie.mp3",
  enderman: "sounds/enderman.mp3",
};
const SOUND_VOLUME = {
  bad: 1,
  badend: 1,
  diamond: 0.5,
  explosion: 1,
  firework: 1.6, // 1.0 초과 = Web Audio GainNode로 증폭
  goodend: 1,
  thunder: 0.5,
  zombie: 1,
  enderman: 1,
};

// 클릭 순간 파일을 새로 불러오면 디코딩 지연이 생기므로, 미리 디코딩된 AudioBuffer로 캐싱해둔다.
const soundBuffers = {};
let soundsPreloaded = false;

async function preloadSounds() {
  if (soundsPreloaded) return;
  soundsPreloaded = true;
  const ctx = getAudioCtx();
  await Promise.all(
    Object.entries(SOUND_FILES).map(async ([key, src]) => {
      try {
        const res = await fetch(src);
        const arrayBuffer = await res.arrayBuffer();
        soundBuffers[key] = await ctx.decodeAudioData(arrayBuffer);
      } catch (err) {
        console.warn(`사운드 사전 로드 실패: ${key}`, err);
      }
    })
  );
}

function playSound(key, volumeOverride) {
  if (state.isMuted) return;
  const buffer = soundBuffers[key];
  const volume = volumeOverride ?? SOUND_VOLUME[key] ?? 1;

  if (buffer) {
    // 사전 로드된 버퍼가 있으면 지연 없이 즉시 재생 (GainNode로 볼륨도 함께 조절)
    const ctx = getAudioCtx();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gainNode = ctx.createGain();
    gainNode.gain.value = volume;
    source.connect(gainNode).connect(ctx.destination);
    source.start(0);
    return;
  }

  // 사전 로드가 아직 안 됐거나 실패한 경우의 대비책(기존 방식)
  const src = SOUND_FILES[key];
  if (!src) return;
  const audio = new Audio(src);
  audio.volume = Math.min(volume, 1);
  audio.play().catch(() => {});
}

/* =========================================================
   1. 메인 화면
========================================================= */
$("logo").addEventListener("click", () => {
  state.logoClickCount++;
  if (state.logoClickCount >= 7 && !state.impossibleUnlocked) {
    state.impossibleUnlocked = true;
    $("btn-impossible").classList.remove("hidden");
    $("btn-impossible-info").classList.remove("hidden");
    $("ranking-tab-impossible").classList.remove("hidden"); // 랭킹에서도 해제 후에만 노출
  }
});

$("btn-start").addEventListener("click", () => {
  const name = $("nickname-input").value.trim();
  state.nickname = name || "익명";
  showScreen("difficulty");
});

/* ---------- 게임 설명 모달 (등급컷은 실제 데이터 기반으로 자동 생성, 히든 해금 시 내용 확장) ---------- */
const HOWTO_BASE_TEXT = `[게임 목표]
60초 동안 화면에 무작위로 나타나는 표적을 클릭해 최대한 높은 점수를 만드세요.
표적은 완전히 랜덤한 위치에 나타났다가 일정 시간 뒤 사라지며, 종류에 따라 점수와 효과가 다릅니다.

[목표 종류]
두더지: 클릭 시 +1점 (가장 흔하게 등장)
다이아몬드 블록: 클릭 시 +3점
에메랄드 블록: 클릭 시 85% 확률로 +5점, 15% 확률로 -3점 (하이리스크 하이리턴)
크리퍼: 클릭 시 -3점, 폭발 파티클과 함께 화면이 강하게 흔들림
좀벌레: 클릭 시 -2점, 클릭한 위치 근처에만 거미줄이 생겨 그 영역은 시야가 가려지고 클릭도 막힘
금 블록: 클릭해도 점수 변화는 없지만, 그 다음 클릭에서 얻는 점수(또는 잃는 점수)가 2배로 적용됩니다. 단, 아무 목표나 한 번 클릭하는 순간 효과가 사라지니 타이밍이 중요합니다. 허공을 클릭해도 효과는 유지됩니다.
TNT: 클릭 시 -5점, 강렬한 폭발 이펙트와 함께 화면이 매우 크게 흔들리며, 근처에 있던 크리퍼가 연쇄적으로 함께 터집니다
좀비: 클릭 시 -2점과 함께 3초간 화면이 흐려집니다. 이 3초 동안 다른 곳을 클릭하면 위반으로 간주되어, 효과가 끝난 뒤 추가로 3초간 클릭 자체가 인식되지 않습니다
엔더맨: 클릭하면 점수 변화는 없지만, 이후 일정 시간 동안 모든 표적의 득점/감점이 완전히 반전되고 화면이 보라색으로 물듭니다 (허공 클릭의 -1점은 반전되지 않음)
허공 클릭(빗나감): -1점

[진행 순서]
1. 2자리 수 덧셈/뺄셈 문제 풀기 (게임 전 집중력 측정용, 틀리면 다시 풀어야 하고 오답마다 +0.5초 페널티)
2. 3초 카운트다운 (1, 2, 3, START!)
3. 60초 동안 본게임 플레이
4. 게임 종료 후 같은 방식으로 수학 문제 다시 풀기
5. 결과 확인: 최종 점수, 등급, 그리고 게임 전후 수학 문제 풀이 시간 변화(집중력 향상 여부)를 보여줍니다

[난이도]
easy / normal / hard 세 가지 난이도 중 선택할 수 있습니다.
난이도가 높을수록 표적이 더 자주, 더 많이, 더 빨리 나타났다 사라집니다.`;

// 등급표(min 배열)를 기반으로 "0~19점: 벤치급" 같은 구간 설명을 자동 생성 (숫자를 바꿔도 설명이 항상 실제 값과 일치함)
function buildGradeRangeText(table) {
  return table
    .map((g, i) => {
      const min = g.min;
      const max = table[i + 1] ? table[i + 1].min - 1 : null;
      const rangeStr = max !== null ? `${min}~${max}점` : `${min}점 이상`;
      const shortName = g.name.length > 30 ? g.name.slice(0, 30) + "…(최상위 등급)" : g.name;
      return `  ${rangeStr} → ${shortName}`;
    })
    .join("\n");
}

function renderHowtoBody() {
  let text = HOWTO_BASE_TEXT;

  text += `\n\n[등급컷 안내 — easy / normal / hard 공통, PC 기준]
점수가 높을수록 더 높은 등급을 받으며, 등급 사이의 점수 간격은 위로 갈수록 점점 더 벌어집니다 (상위 등급일수록 올라가기 어려워짐).
${GOOD_END_CUT.normal}점 이상이면 굿엔드, 미만이면 배드엔드 연출과 함께 결과가 표시됩니다.
모바일(터치)은 손가락으로 여러 표적을 동시에 스치듯 눌러 점수를 얻기 유리하기 때문에, 같은 등급을 받으려면 PC보다 정확히 +${MOBILE_BONUS.normal}점이 필요합니다.

[등급 점수 구간 — easy / normal / hard]
${buildGradeRangeText(GRADES_NORMAL)}

[온라인 랭킹]
게임이 끝나면 자동으로 난이도별 온라인 랭킹에 닉네임과 점수, 수학 문제 풀이 시간이 기록됩니다.
메인 화면의 '랭킹' 버튼에서 난이도별로 전체 순위를 확인할 수 있습니다.`;

  $("howto-body").textContent = text;
  const hintEl = document.createElement("p");
  hintEl.className = "howto-hint";
  hintEl.textContent = "그의 등번호는 두 자릿수가 아니다. 문을 두드리고 싶다면, 문장 부호처럼 그 숫자만큼 반복하라.";
  $("howto-body").appendChild(hintEl);
}

renderHowtoBody();

$("btn-howto").addEventListener("click", () => {
  $("howto-modal").classList.remove("hidden");
});
$("btn-howto-close").addEventListener("click", () => $("howto-modal").classList.add("hidden"));

/* ---------- IMPOSSIBLE 난이도 전용 정보 (해금 후에만 버튼으로 열람 가능) ---------- */
function renderImpossibleInfoBody() {
  const impCfg = DIFFICULTY_CONFIG.impossible;
  const text = `[IMPOSSIBLE 난이도 정보]
이름 그대로, 사람이 실시간으로 반응하기 버거운 속도와 밀도로 표적이 쏟아집니다.
표적 등장 간격 ${(impCfg.spawnInterval / 1000).toFixed(2)}초, 동시 최대 ${impCfg.maxOnScreen}개, 표적 유지 시간 ${(impCfg.lifeTime / 1000).toFixed(2)}초로 다른 모든 난이도보다 훨씬 빡빡하게 설정되어 있습니다.

[등급컷 안내]
${GOOD_END_CUT.impossible}점 이상이면 굿엔드, 미만이면 배드엔드입니다.
모바일(터치)은 다른 난이도와 마찬가지로 유리하지만, IMPOSSIBLE은 난이도 자체가 매우 높은 점을 감안해 페널티를 완화했습니다: 같은 등급을 받으려면 PC보다 정확히 +${MOBILE_BONUS.impossible}점이 필요합니다.

[IMPOSSIBLE 등급 점수 구간]
${buildGradeRangeText(GRADES_IMPOSSIBLE)}`;

  $("impossible-info-body").textContent = text;
}

$("btn-impossible-info").addEventListener("click", () => {
  renderImpossibleInfoBody();
  $("impossible-info-modal").classList.remove("hidden");
});
$("btn-impossible-info-close").addEventListener("click", () => $("impossible-info-modal").classList.add("hidden"));


/* ---------- 랭킹 모달 (Firebase 연동, 페이지네이션 포함) ---------- */
$("btn-ranking").addEventListener("click", () => {
  $("ranking-modal").classList.remove("hidden");
  const activeTab = document.querySelector("#ranking-tabs .tab-btn.active") || document.querySelector("#ranking-tabs .tab-btn");
  rankingState.cursors = [null];
  loadRankingPage(activeTab.dataset.diff, 0);
});
$("btn-ranking-close").addEventListener("click", () => $("ranking-modal").classList.add("hidden"));
document.querySelectorAll("#ranking-tabs .tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#ranking-tabs .tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    rankingState.cursors = [null];
    loadRankingPage(btn.dataset.diff, 0);
  });
});

/* =========================================================
   2. 난이도 선택
========================================================= */
document.querySelectorAll(".diff-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.difficulty = btn.dataset.diff;
    startFirstMath();
  });
});
$("btn-back-main").addEventListener("click", () => showScreen("main"));

/* =========================================================
   3. 수학 문제 (1차 / 2차 공용)
========================================================= */
// 1차 수학 문제를 빠르게 풀수록 본게임 시작 점수에 유의미한 보너스를 부여
function calcMathSpeedBonus(elapsedSec) {
  if (elapsedSec <= 1.5) return 15;
  if (elapsedSec <= 3) return 8;
  if (elapsedSec <= 5) return 3;
  return 0;
}

function genMathQuestion() {
  let a = Math.floor(Math.random() * 90) + 10; // 10~99
  let b = Math.floor(Math.random() * 90) + 10;
  const ops = ["+", "-"];
  const op = ops[Math.floor(Math.random() * ops.length)];
  // 뺄셈일 때 답이 음수가 되면 모바일 숫자 키패드에 마이너스(-) 키가 없어 입력 자체가 불가능해지므로,
  // 항상 큰 수에서 작은 수를 빼서 답이 0 이상이 되도록 함
  if (op === "-" && a < b) {
    [a, b] = [b, a];
  }
  const answer = op === "+" ? a + b : a - b;
  return { text: `${a} ${op} ${b}`, answer };
}

function startFirstMath() {
  state.mathPhase = "first";
  showMathScreen();
}
function startSecondMath() {
  state.mathPhase = "second";
  showMathScreen();
}
function showMathScreen() {
  const q = genMathQuestion();
  state.mathAnswer = q.answer;
  state.mathSubmitLocked = false; // 짧은 시간 내 중복 제출 방지용
  state.mathWrongPenalty = 0; // 이번 문제에서 누적된 오답 페널티(초)
  state.mathStartTs = performance.now(); // 최초 시도 시작 시각(오답 재시도해도 유지)
  $("math-question").textContent = q.text;
  $("math-answer").value = "";
  $("math-feedback").textContent = "";
  $("math-feedback").className = "feedback";
  $("math-label").textContent =
    state.mathPhase === "first" ? "게임 시작 전 문제를 풀어주세요" : "게임이 끝났어요! 다시 풀어볼까요?";
  showScreen("math");
  setTimeout(() => $("math-answer").focus(), 100);
}

function submitMath() {
  if (state.mathSubmitLocked) return; // 버튼+Enter 동시입력 등으로 인한 중복 제출 방지
  state.mathSubmitLocked = true;
  setTimeout(() => { state.mathSubmitLocked = false; }, 300);

  const userVal = parseInt($("math-answer").value, 10);
  const isCorrect = userVal === state.mathAnswer;

  if (isCorrect) {
    const elapsedSec = (performance.now() - state.mathStartTs) / 1000 + state.mathWrongPenalty;

    if (state.mathPhase === "first") {
      const bonus = calcMathSpeedBonus(elapsedSec);
      state.mathSpeedBonus = bonus;
      $("math-feedback").textContent =
        bonus > 0
          ? `정답! (${elapsedSec.toFixed(2)}초) — 빠른 풀이 보너스 +${bonus}점!`
          : `정답! (${elapsedSec.toFixed(2)}초)`;
      $("math-feedback").className = "feedback";
      state.firstMathTime = elapsedSec;
      setTimeout(() => startCountdown(), 900);
    } else {
      $("math-feedback").textContent = `정답! (${elapsedSec.toFixed(2)}초)`;
      $("math-feedback").className = "feedback";
      state.secondMathTime = elapsedSec;
      setTimeout(() => showResult(), 700);
    }
  } else {
    // 오답: 진행하지 않고 새 문제로 재시도, 페널티 +0.5초 누적
    state.mathWrongPenalty += 0.5;
    $("math-feedback").textContent = `오답! 다시 풀어주세요 (오답 페널티 +0.5초 누적: ${state.mathWrongPenalty.toFixed(1)}초)`;
    $("math-feedback").className = "feedback wrong";

    const q = genMathQuestion();
    state.mathAnswer = q.answer;
    $("math-question").textContent = q.text;
    $("math-answer").value = "";
    $("math-answer").focus();
  }
}
$("btn-math-submit").addEventListener("click", submitMath);
$("math-answer").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitMath();
});


/* =========================================================
   4. 카운트다운
========================================================= */
function startCountdown() {
  showScreen("countdown");
  const seq = ["1", "2", "3", "START!"];
  let i = 0;
  const el = $("countdown-text");

  function step() {
    if (i >= seq.length) {
      startGame();
      return;
    }
    el.textContent = seq[i];
    el.style.animation = "none";
    void el.offsetWidth; // reflow to restart animation
    el.style.animation = "pop 0.9s ease";
    playBeep(i < 3 ? 440 : 880, i < 3 ? 0.15 : 0.3);
    i++;
    setTimeout(step, 800);
  }
  step();
}

/* =========================================================
   5. 본게임
========================================================= */
let activeTargets = [];

function startGame() {
  clearInterval(state.timerId);
  clearInterval(state.spawnTimerId);
  clearTimeout(zombieBlurTimeout);
  clearTimeout(zombieBlockClicksTimeout);
  clearTimeout(endermanTimeout);
  state.score = state.mathSpeedBonus || 0; // 1차 수학 문제를 빠르게 풀었다면 그 보너스로 시작
  state.timeLeft = 60;
  state.goldActive = false;
  state.isPaused = false;
  state.isGameOver = false;
  state.zombieBlurActive = false;
  state.zombieViolated = false;
  state.clicksBlocked = false;
  state.endermanActive = false;
  $("game-field").classList.remove("zombie-blur");
  $("enderman-overlay").classList.add("hidden");
  activeTargets = [];
  $("game-field").innerHTML = "";
  updateHUD();
  showScreen("game");

  const cfg = DIFFICULTY_CONFIG[state.difficulty];

  state.timerId = setInterval(() => {
    if (state.isPaused) return;
    state.timeLeft--;
    updateHUD();
    if (state.timeLeft <= 0) {
      endGame();
    }
  }, 1000);

  scheduleSpawn(cfg);
}

function scheduleSpawn(cfg) {
  // 매 웨이브마다 부족한 만큼을 한꺼번에(동시에) 채워 넣음
  spawnWave(cfg);
  state.spawnTimerId = setInterval(() => {
    if (state.isPaused) return;
    spawnWave(cfg);
  }, cfg.spawnInterval);
}

function spawnWave(cfg) {
  const needed = cfg.maxOnScreen - activeTargets.length;
  for (let i = 0; i < needed; i++) {
    spawnTarget(cfg);
  }
}

function isOverlapping(x, y, size, minGap) {
  return activeTargets.some((el) => {
    const ex = parseFloat(el.style.left);
    const ey = parseFloat(el.style.top);
    return Math.abs(x - ex) < size + minGap && Math.abs(y - ey) < size + minGap;
  });
}

function pickTargetType() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const t of TARGET_TYPES) {
    if (r < t.weight) return t;
    r -= t.weight;
  }
  return TARGET_TYPES[0];
}

function spawnTarget(cfg) {
  const type = pickTargetType();
  const field = $("game-field");
  const fw = field.clientWidth;
  const fh = field.clientHeight;
  const size = 64;
  const minGap = 12; // 표적 간 최소 간격

  let x, y, tries = 0;
  do {
    x = Math.random() * (fw - size - 20) + 10;
    y = Math.random() * (fh - size - 100) + 80; // HUD 영역 피하기
    tries++;
  } while (tries < 8 && isOverlapping(x, y, size, minGap));

  const el = document.createElement("div");
  el.className = `target ${type.className}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.innerHTML = `<img src="${type.image}" alt="${type.key}" draggable="false" />`;
  el.dataset.type = type.key;

  const removeTimer = setTimeout(() => removeTarget(el), cfg.lifeTime);
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    clearTimeout(removeTimer);
    handleTargetClick(type.key, el, e.clientX, e.clientY);
  });
  el.addEventListener(
    "touchstart",
    (e) => {
      e.stopPropagation();
      e.preventDefault();
      clearTimeout(removeTimer);
      const touch = e.touches[0];
      handleTargetClick(type.key, el, touch.clientX, touch.clientY);
    },
    { passive: false }
  );

  field.appendChild(el);
  activeTargets.push(el);
}

function removeTarget(el) {
  if (el.parentNode) el.parentNode.removeChild(el);
  activeTargets = activeTargets.filter((t) => t !== el);
}

function handleTargetClick(typeKey, el, clientX, clientY) {
  if (state.clicksBlocked) return; // 좀비 위반 페널티로 클릭 자체가 무시되는 상태

  // 좀비 블러가 떠 있는 도중에 아무 곳이나 클릭하면 위반으로 기록 (효과 자체는 아래에서 정상 처리됨)
  if (state.zombieBlurActive) state.zombieViolated = true;

  let delta = 0;
  let isGoldTriggerConsuming = typeKey !== "gold";
  const center = getTargetCenter(el);

  switch (typeKey) {
    case "mole":
      delta = 1;
      break;
    case "diamond":
      delta = 3;
      playSound("diamond");
      break;
    case "emerald":
      if (Math.random() < EMERALD_SUCCESS_RATE) {
        delta = 5;
        playSound("firework");
      } else {
        delta = -3;
        playSound("thunder");
      }
      break;
    case "creeper":
      delta = -3;
      playSound("explosion");
      spawnExplosionParticles(center.x, center.y, CREEPER_PARTICLE_COLORS, 48);
      showScreenFlash();
      shakeLinear(26, 14);
      break;
    case "silverfish":
      delta = -2;
      playSound("bad");
      showWebOverlay(clientX, clientY);
      break;
    case "gold":
      activateGold();
      removeTarget(el);
      return; // 점수 변동 없음, 골드 효과만 활성화
    case "tnt":
      delta = -5;
      playSound("explosion", 1.9); // 크리퍼 폭발음 재사용, 볼륨만 훨씬 크게
      spawnExplosionParticles(center.x, center.y, TNT_PARTICLE_COLORS, 48);
      showScreenFlash();
      shakeExplosive(48, 650); // 초반에 강하게 터졌다가 빠르게 감쇠 (보스몹 느낌)
      triggerNearbyCreeperChain(center.x, center.y, 150);
      break;
    case "zombie":
      delta = -2;
      playSound("zombie");
      startZombieBlur();
      break;
    case "enderman":
      playSound("enderman");
      activateEndermanReversal();
      removeTarget(el);
      return; // 점수 변동 없음, 반전 효과만 활성화
  }

  if (state.endermanActive) {
    delta = -delta; // 엔더맨 효과 중에는 모든 득점/감점이 반전됨 (허공 클릭은 별도 경로라 영향 없음)
  }

  if (state.goldActive && isGoldTriggerConsuming) {
    delta *= 2;
    deactivateGold();
  }

  applyScore(delta, clientX, clientY);
  removeTarget(el);
}

function getTargetCenter(el) {
  const size = 64; // 표적 스폰 시 사용한 기준 크기
  return {
    x: parseFloat(el.style.left) + size / 2,
    y: parseFloat(el.style.top) + size / 2,
  };
}

function activateGold() {
  state.goldActive = true;
  $("gold-indicator").classList.remove("hidden");
}
function deactivateGold() {
  state.goldActive = false;
  $("gold-indicator").classList.add("hidden");
}

function applyScore(delta, x, y) {
  state.score += delta;
  updateHUD();
  showScorePopup(delta, x, y);
}

function showScorePopup(delta, x, y) {
  const popup = document.createElement("div");
  popup.className = `score-popup ${delta >= 0 ? "plus" : "minus"}`;
  popup.textContent = delta >= 0 ? `+${delta}` : `${delta}`;
  popup.style.left = `${x - 15}px`;
  popup.style.top = `${y - 20}px`;
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 800);
}

/* ---------- 폭발 이펙트 (TNT / 크리퍼 공용, 색상만 다름) ---------- */
const TNT_PARTICLE_COLORS = ["#e8452c", "#ff7a1a", "#ffcc33", "#fff2c4", "#8a1f12"];
const CREEPER_PARTICLE_COLORS = ["#3b8f3b", "#5fbf5f", "#1f5f1f", "#a8e6a1", "#0f2f0f"];

function spawnExplosionParticles(x, y, colors, count) {
  const field = $("game-field");
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    const size = 3 + Math.random() * 7;
    p.className = "explosion-particle";
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    field.appendChild(p);

    const angle = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * 90;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist;

    p.animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: `translate(${tx}px, ${ty}px) scale(0.2)`, opacity: 0 },
      ],
      { duration: 500 + Math.random() * 300, easing: "cubic-bezier(0.2,0.8,0.3,1)" }
    ).onfinish = () => p.remove();
  }
}

function showScreenFlash() {
  const flash = document.createElement("div");
  flash.className = "screen-flash";
  document.body.appendChild(flash);
  requestAnimationFrame(() => flash.classList.add("fade"));
  setTimeout(() => flash.remove(), 400);
}

// 크리퍼: 일정한 속도로 감쇠하는 흔들림
function shakeLinear(amplitude, frameCount) {
  const field = $("game-field");
  let frame = 0;
  const interval = setInterval(() => {
    frame++;
    const decay = 1 - frame / frameCount;
    const dx = (Math.random() - 0.5) * amplitude * decay;
    const dy = (Math.random() - 0.5) * amplitude * decay;
    field.style.transform = `translate(${dx}px, ${dy}px)`;
    if (frame >= frameCount) {
      clearInterval(interval);
      field.style.transform = "translate(0,0)";
    }
  }, 30);
}

// TNT: 초반에 강하게 터졌다가 지수적으로 빠르게 감쇠하는 흔들림 (보스몹 느낌)
function shakeExplosive(maxAmplitude, totalMs) {
  const field = $("game-field");
  const start = performance.now();
  const tau = totalMs / 4.5;
  function tick(now) {
    const elapsed = now - start;
    if (elapsed >= totalMs) {
      field.style.transform = "translate(0,0)";
      return;
    }
    const amp = maxAmplitude * Math.exp(-elapsed / tau);
    const dx = (Math.random() - 0.5) * amp;
    const dy = (Math.random() - 0.5) * amp;
    field.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// TNT 근처에 있는 크리퍼를 강제로 클릭된 것처럼 처리해 연쇄 폭발을 일으킴
function triggerNearbyCreeperChain(cx, cy, radius) {
  const nearbyCreepers = activeTargets.filter((t) => {
    if (t.dataset.type !== "creeper") return false;
    const center = getTargetCenter(t);
    const dx = center.x - cx;
    const dy = center.y - cy;
    return Math.sqrt(dx * dx + dy * dy) <= radius;
  });
  nearbyCreepers.forEach((el) => {
    setTimeout(() => {
      if (!el.parentNode) return; // 그 사이 이미 사라졌으면 무시
      const center = getTargetCenter(el);
      handleTargetClick("creeper", el, center.x, center.y);
    }, 80 + Math.random() * 140);
  });
}

/* ---------- 좀비: 클릭 시 화면 블러 + 위반 시 클릭 차단 페널티 ---------- */
let zombieBlurTimeout = null;
let zombieBlockClicksTimeout = null;

function startZombieBlur() {
  state.zombieBlurActive = true;
  state.zombieViolated = false;
  $("game-field").classList.add("zombie-blur");

  clearTimeout(zombieBlurTimeout);
  zombieBlurTimeout = setTimeout(() => {
    state.zombieBlurActive = false;
    $("game-field").classList.remove("zombie-blur");

    if (state.zombieViolated) {
      state.clicksBlocked = true;
      clearTimeout(zombieBlockClicksTimeout);
      zombieBlockClicksTimeout = setTimeout(() => {
        state.clicksBlocked = false;
      }, 3000);
    }
  }, 3000);
}

/* ---------- 엔더맨: 모든 득점/감점 반전 + 화면 보라색 연출 ---------- */
let endermanTimeout = null;
const ENDERMAN_DURATION = 5000;

function activateEndermanReversal() {
  state.endermanActive = true;
  $("enderman-overlay").classList.remove("hidden");

  clearTimeout(endermanTimeout);
  endermanTimeout = setTimeout(() => {
    state.endermanActive = false;
    $("enderman-overlay").classList.add("hidden");
  }, ENDERMAN_DURATION);
}

function showWebOverlay(x, y) {
  const web = document.createElement("div");
  web.className = "web-overlay";
  const size = 220; // 거미줄이 덮는 영역 지름(px)
  web.style.left = `${x - size / 2}px`;
  web.style.top = `${y - size / 2}px`;
  web.style.width = `${size}px`;
  web.style.height = `${size}px`;

  // 거미줄이 덮인 영역은 그 아래 표적을 클릭/터치할 수 없도록 이벤트를 가로채서 막음
  const block = (e) => { e.stopPropagation(); e.preventDefault(); };
  web.addEventListener("click", block);
  web.addEventListener("touchstart", block, { passive: false });

  document.body.appendChild(web);
  // 일정 시간 유지 후 서서히 사라짐 (fade-out), 사라지는 동안에도 클릭은 계속 막힘
  setTimeout(() => {
    web.classList.add("fade-out");
    setTimeout(() => web.remove(), 800);
  }, 900);
}

/* ---------- 허공 클릭 (빗나감) — 엔더맨 반전 효과의 영향을 받지 않고 항상 -1점 ---------- */
$("game-field").addEventListener("click", (e) => {
  if (state.isPaused) return;
  if (state.clicksBlocked) return;
  if (state.zombieBlurActive) state.zombieViolated = true;
  applyScore(-1, e.clientX, e.clientY);
});
$("game-field").addEventListener(
  "touchstart",
  (e) => {
    if (state.isPaused) return;
    if (state.clicksBlocked) return;
    if (e.target.id === "game-field") {
      if (state.zombieBlurActive) state.zombieViolated = true;
      const touch = e.touches[0];
      applyScore(-1, touch.clientX, touch.clientY);
    }
  },
  { passive: true }
);

function updateHUD() {
  const m = Math.floor(state.timeLeft / 60);
  const s = state.timeLeft % 60;
  $("hud-time").textContent = `${m}:${s.toString().padStart(2, "0")}`;
  $("hud-score").textContent = `점수 ${state.score}`;
}

/* ---------- 음소거 ---------- */
$("btn-mute").addEventListener("click", () => {
  state.isMuted = !state.isMuted;
  $("btn-mute").textContent = state.isMuted ? "🔇" : "🔊";
});

/* ---------- 일시정지 ---------- */
function pauseGame() {
  state.isPaused = true;
  $("pause-overlay").classList.remove("hidden");
}
function resumeGame() {
  state.isPaused = false;
  $("pause-overlay").classList.add("hidden");
}
$("btn-pause").addEventListener("click", pauseGame);
$("btn-resume").addEventListener("click", resumeGame);

// PC에서 ESC 키로 본게임 중 일시정지/재개 토글
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!screens.game.classList.contains("active")) return; // 본게임 화면일 때만 동작
  if (state.isPaused) {
    resumeGame();
  } else {
    pauseGame();
  }
});

function endGame() {
  if (state.isGameOver) return; // 중복 호출 방지 (수학 문제 반복 생성 버그 수정)
  state.isGameOver = true;
  clearInterval(state.timerId);
  clearInterval(state.spawnTimerId);
  state.timerId = null;
  state.spawnTimerId = null;
  activeTargets.forEach(removeTarget);
  deactivateGold();
  startSecondMath();
}

/* =========================================================
   6. 결과 화면
========================================================= */
function getGradeInfo(score, difficulty, isMobile) {
  const mobileBonus = MOBILE_BONUS[difficulty] ?? 45;
  const adjustedScore = isMobile ? score - mobileBonus : score; // 모바일은 난이도별 보너스만큼 낮춰서 비교 => 같은 등급을 받으려면 PC보다 더 높은 점수가 필요
  const isImpossible = difficulty === "impossible";
  const table = isImpossible ? GRADES_IMPOSSIBLE : GRADES_NORMAL;
  const imageMap = isImpossible ? GRADE_IMAGE_MAP_IMPOSSIBLE : GRADE_IMAGE_MAP_NORMAL;

  let idx = 0;
  for (let i = 0; i < table.length; i++) {
    if (adjustedScore >= table[i].min) idx = i;
  }
  const goodCut = GOOD_END_CUT[difficulty] + (isMobile ? mobileBonus : 0);
  const isGoodEnd = score >= goodCut;

  return {
    name: table[idx].name,
    image: `end_images/${imageMap[idx]}.png`,
    isGoodEnd,
  };
}

function showResult() {
  const grade = getGradeInfo(state.score, state.difficulty, state.isMobile);
  const diffSec = (state.secondMathTime - state.firstMathTime).toFixed(2);
  const diffText =
    diffSec < 0
      ? `수학 문제 풀이 시간 ${Math.abs(diffSec)}초 단축!`
      : diffSec > 0
      ? `수학 문제 풀이 시간 ${diffSec}초 증가`
      : `수학 문제 풀이 시간 변화 없음`;

  $("result-score").textContent = `최종 점수 ${state.score}`;
  $("result-grade").textContent = grade.name;
  $("result-mathdiff").textContent = diffText;
  $("result-rank").classList.add("hidden");
  $("result-rank").textContent = "";

  const bg = $("result-bg");
  bg.style.backgroundImage = `url('${grade.image}')`;
  bg.style.backgroundColor = grade.isGoodEnd ? "#2a4d2a" : "#4d2a2a"; // 이미지 없을 때 대비 색

  playSound(grade.isGoodEnd ? "goodend" : "badend");
  showScreen("result");

  // 온라인 랭킹에 기록 저장 후, 저장이 반영된 점수 기준으로 실시간 순위를 계산해 바로 보여줌
  saveScoreToFirebase(state.difficulty, state.nickname, state.score, state.firstMathTime, state.secondMathTime).then(
    async (effectiveScore) => {
      if (effectiveScore === null) return; // Firebase 사용 불가 등으로 저장 실패 시 조용히 넘어감
      const rank = await getRankForScore(state.difficulty, effectiveScore);
      if (rank === null) return;
      const rankEl = $("result-rank");
      rankEl.textContent =
        effectiveScore === state.score
          ? `현재 순위 ${rank}위`
          : `현재 순위 ${rank}위 (기존 최고 기록 ${effectiveScore}점 유지)`;
      rankEl.classList.remove("hidden");
    }
  );
}

$("btn-retry").addEventListener("click", () => {
  startFirstMath();
});
$("btn-mainmenu").addEventListener("click", () => {
  showScreen("main");
});

/* =========================================================
   초기화
========================================================= */
showScreen("main");

// 브라우저는 사용자 조작 이전에 오디오 재생/디코딩을 제한하므로,
// 첫 클릭(또는 터치) 시점에 모든 사운드를 미리 로드해 이후 지연 없이 재생되게 함
function preloadSoundsOnce() {
  preloadSounds();
  document.removeEventListener("click", preloadSoundsOnce);
  document.removeEventListener("touchstart", preloadSoundsOnce);
}
document.addEventListener("click", preloadSoundsOnce, { once: true });
document.addEventListener("touchstart", preloadSoundsOnce, { once: true });
