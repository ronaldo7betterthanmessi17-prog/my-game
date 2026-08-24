
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
 
// 난이도별 컬렉션에 점수 저장 (닉네임, 점수, 1차/2차 수학 풀이 시간 포함)
async function saveScoreToFirebase(difficulty, nickname, score, firstMathTime, secondMathTime) {
  if (!db) return; // Firebase 사용 불가 시 조용히 건너뜀 (게임 진행에는 영향 없음)
  const safeFirst = Number.isFinite(firstMathTime) ? Number(firstMathTime.toFixed(2)) : 0;
  const safeSecond = Number.isFinite(secondMathTime) ? Number(secondMathTime.toFixed(2)) : 0;
  const safeScore = Number.isFinite(score) ? score : 0;
  try {
    await db.collection(`scores_${difficulty}`).add({
      nickname: nickname || "익명",
      score: safeScore,
      firstMathTime: safeFirst,
      secondMathTime: safeSecond,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("랭킹 저장 실패:", err);
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
    snapshot.forEach((doc, i) => {
      const d = doc.data();
      const rankNum = pageIndex * rankingState.pageSize + i + 1; // 항상 정상적인 정수만 나오는 계산
      const safeScore = safeNumber(d.score);
      const safeFirst = safeNumber(d.firstMathTime);
      const safeSecond = safeNumber(d.secondMathTime);
      html += `<li class="ranking-item">
        <span class="rank-num">${rankNum}</span>
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
  isMobile: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent),
};
 
/* ---------- 난이도별 세부 수치 (PC 기준, 임시값 - 추후 조정) ---------- */
const DIFFICULTY_CONFIG = {
  easy:       { spawnInterval: 1400, maxOnScreen: 5,  lifeTime: 1500 },
  normal:     { spawnInterval: 1100, maxOnScreen: 8,  lifeTime: 1200 },
  hard:       { spawnInterval: 950,  maxOnScreen: 11, lifeTime: 1000 },
  impossible: { spawnInterval: 800,  maxOnScreen: 14, lifeTime: 850 },
};
 
/* ---------- 목표 종류별 점수/확률/스폰가중치 ---------- */
const TARGET_TYPES = [
  { key: "mole",       weight: 40, className: "target-mole",       image: "images/mole.png" },
  { key: "diamond",    weight: 15, className: "target-diamond",    image: "images/diamond.png" },
  { key: "emerald",    weight: 15, className: "target-emerald",    image: "images/emerald.png" },
  { key: "creeper",    weight: 15, className: "target-creeper",    image: "images/creeper.png" },
  { key: "silverfish", weight: 10, className: "target-silverfish", image: "images/silverfish.png" },
  { key: "gold",       weight: 5,  className: "target-gold",       image: "images/gold.png" },
];
const TOTAL_WEIGHT = TARGET_TYPES.reduce((s, t) => s + t.weight, 0);
 
/* ---------- 등급 구간 (PC 기준, 모바일은 +20점) ---------- */
const GRADES_NORMAL = [
  { name: "벤치급", min: 0 },
  { name: "날강두급", min: 20 },
  { name: "런닝머신두급", min: 35 },
  { name: "중롱도르급", min: 50 },
  { name: "호날두급", min: 65 },
  { name: "킹갓두급", min: 80 },
  { name: "챔스의사나이급", min: 95 },
  { name: "5발롱5챔스의전설월드컵6회연속출전및연속득점킹갓Cristiano Ronaldo dos Santos Aveiro급", min: 110 },
];
const GRADES_IMPOSSIBLE = [
  { name: "강등위기닭집급", min: 0 },
  { name: "17년무관급", min: 15 },
  { name: "PK실축급", min: 30 },
  { name: "아우디컵우승급", min: 45 },
  { name: "챔피언스리그우승급", min: 60 },
  { name: "탄소기반유기체역사상유일무이언터져블대체불가. 룩셈부로크의 제앙, 산마리노를 박살내 교황청을 경악하게 한 자. 리히텐슈타인의 사형집행인, 지브롤터에 절망을 선사하는 자, 페로제도의 폭풍을 몰고 오는 자. 에스토니아에 진노의 일곱 대접을 쏟아붓는 자, 아르메니아에 멸망의 계시록을 낭독하는 자, 몰도바를 심연으로 가라앉히는 자. 우즈베키스탄을 찢어버리는 자, 안도라에 6골 폭격을 퍼붓는 자, 카자흐스탄을 중앙아시아에서 가장 불행한 나라로 만든 카자흐 파멸자. 몰타를 국제전에서 박살낸 몰타 학살귀, 키프로스를 완전 관광시킨 키프로스 파멸자, 리투아니아를 7골로 울음바다 만든 리투아니아 학살자, 말뫼 FF를 파괴해 즐라탄의 분노를 사는 자. 갈라타사라이 팬들의 눈물로 해수면 상승을 일으키는 자, 전 세계 팬들의 뜨거운 열기로 지구온난화를 일으키는 자. 그러나, 콩고민주공화국에게는 압도적인 강자로서 자비를 베푸는 킹갓호날두급", min: 80 },
];
// 등급 이미지 파일명 매핑 (end_images/n1.png ~ n8.png, i1.png ~ i6.png)
const GRADE_IMAGE_MAP_NORMAL = ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"];
const GRADE_IMAGE_MAP_IMPOSSIBLE = ["i1", "i2", "i3", "i4", "i5", "i6"];
 
const GOOD_END_CUT = { easy: 65, normal: 65, hard: 65, impossible: 45 };
const MOBILE_BONUS = 20;
 
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
};
const SOUND_VOLUME = {
  bad: 1,
  badend: 1,
  diamond: 0.5,
  explosion: 1,
  firework: 1.6, // 1.0 초과 = Web Audio GainNode로 증폭
  goodend: 1,
  thunder: 0.5,
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
 
function playSound(key) {
  if (state.isMuted) return;
  const buffer = soundBuffers[key];
  const volume = SOUND_VOLUME[key] ?? 1;
 
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
    $("ranking-tab-impossible").classList.remove("hidden"); // 랭킹에서도 해제 후에만 노출
  }
});
 
$("btn-start").addEventListener("click", () => {
  const name = $("nickname-input").value.trim();
  state.nickname = name || "익명";
  showScreen("difficulty");
});
 
/* ---------- 게임 설명 모달 ---------- */
const HOWTO_TEXT = `[목표 종류]
두더지: +1점
다이아몬드 블록: +3점
에메랄드 블록: 80% 확률 +5점 / 20% 확률 -3점
크리퍼: -3점 (클릭 시 화면 흔들림)
좀벌레: -2점 (클릭 시 거미줄로 잠깐 시야 방해)
금 블록: 다음에 받는 점수가 2배! (다른 목표를 클릭하면 효과 종료)
허공 클릭(빗나감): -1점
 
[진행 순서]
수학 문제 → 카운트다운 → 60초 본게임 → 수학 문제 → 결과 확인
 
[난이도]
easy / normal / hard 중 선택 가능
숨겨진 난이도도... 있다던데?`;
 
$("howto-body").textContent = HOWTO_TEXT;
const hintEl = document.createElement("p");
hintEl.className = "howto-hint";
hintEl.textContent = "ronaldo7";
$("howto-body").appendChild(hintEl);
 
$("btn-howto").addEventListener("click", () => $("howto-modal").classList.remove("hidden"));
$("btn-howto-close").addEventListener("click", () => $("howto-modal").classList.add("hidden"));
 
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
function genMathQuestion() {
  const a = Math.floor(Math.random() * 90) + 10; // 10~99
  const b = Math.floor(Math.random() * 90) + 10;
  const ops = ["+", "-"];
  const op = ops[Math.floor(Math.random() * ops.length)];
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
    $("math-feedback").textContent = `정답! (${elapsedSec.toFixed(2)}초)`;
    $("math-feedback").className = "feedback";
 
    if (state.mathPhase === "first") {
      state.firstMathTime = elapsedSec;
      setTimeout(() => startCountdown(), 700);
    } else {
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
  state.score = 0;
  state.timeLeft = 60;
  state.goldActive = false;
  state.isPaused = false;
  state.isGameOver = false;
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
  let delta = 0;
  let isGoldTriggerConsuming = typeKey !== "gold";
 
  switch (typeKey) {
    case "mole":
      delta = 1;
      break;
    case "diamond":
      delta = 3;
      playSound("diamond");
      break;
    case "emerald":
      if (Math.random() < 0.8) {
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
      shakeScreen();
      break;
    case "silverfish":
      delta = -2;
      playSound("bad");
      showWebOverlay();
      break;
    case "gold":
      activateGold();
      removeTarget(el);
      return; // 점수 변동 없음, 골드 효과만 활성화
  }
 
  if (state.goldActive && isGoldTriggerConsuming) {
    delta *= 2;
    deactivateGold();
  }
 
  applyScore(delta, clientX, clientY);
  removeTarget(el);
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
 
function shakeScreen() {
  const field = $("game-field");
  field.classList.remove("shake");
  void field.offsetWidth;
  field.classList.add("shake");
}
 
function showWebOverlay() {
  const web = document.createElement("div");
  web.className = "web-overlay";
  document.body.appendChild(web);
  // 일정 시간 유지 후 서서히 사라짐 (fade-out)
  setTimeout(() => {
    web.classList.add("fade-out");
    setTimeout(() => web.remove(), 800);
  }, 900);
}
 
/* ---------- 허공 클릭 (빗나감) ---------- */
$("game-field").addEventListener("click", (e) => {
  if (state.isPaused) return;
  applyScore(-1, e.clientX, e.clientY);
});
$("game-field").addEventListener(
  "touchstart",
  (e) => {
    if (state.isPaused) return;
    if (e.target.id === "game-field") {
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
$("btn-pause").addEventListener("click", () => {
  state.isPaused = true;
  $("pause-overlay").classList.remove("hidden");
});
$("btn-resume").addEventListener("click", () => {
  state.isPaused = false;
  $("pause-overlay").classList.add("hidden");
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
  const adjustedScore = isMobile ? score - MOBILE_BONUS : score; // 모바일 등급컷 +20점 => 같은 등급 받으려면 더 높아야 함 => 비교시 -20 보정
  const isImpossible = difficulty === "impossible";
  const table = isImpossible ? GRADES_IMPOSSIBLE : GRADES_NORMAL;
  const imageMap = isImpossible ? GRADE_IMAGE_MAP_IMPOSSIBLE : GRADE_IMAGE_MAP_NORMAL;
 
  let idx = 0;
  for (let i = 0; i < table.length; i++) {
    if (adjustedScore >= table[i].min) idx = i;
  }
  const goodCut = GOOD_END_CUT[difficulty] + (isMobile ? MOBILE_BONUS : 0);
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
 
  const bg = $("result-bg");
  bg.style.backgroundImage = `url('${grade.image}')`;
  bg.style.backgroundColor = grade.isGoodEnd ? "#2a4d2a" : "#4d2a2a"; // 이미지 없을 때 대비 색
 
  playSound(grade.isGoodEnd ? "goodend" : "badend");
  showScreen("result");
 
  // 온라인 랭킹에 기록 저장 (난이도별 컬렉션)
  saveScoreToFirebase(state.difficulty, state.nickname, state.score, state.firstMathTime, state.secondMathTime);
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
