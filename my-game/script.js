/* =========================================================
   집중력 두더지 - script.js
   1순위: 이미지 없이 도형/색으로 처음~끝까지 플레이 가능한 버전
   (이미지 경로는 미리 잡아두고, 파일이 없으면 색상 블록으로 대체됨)
========================================================= */

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
  easy:       { spawnInterval: 1200, maxOnScreen: 2, lifeTime: 1400 },
  normal:     { spawnInterval: 900,  maxOnScreen: 3, lifeTime: 1000 },
  hard:       { spawnInterval: 600,  maxOnScreen: 4, lifeTime: 700 },
  impossible: { spawnInterval: 400,  maxOnScreen: 5, lifeTime: 500 },
};

/* ---------- 목표 종류별 점수/확률/스폰가중치 ---------- */
const TARGET_TYPES = [
  { key: "mole",       weight: 40, className: "target-mole",       emoji: "🐹" },
  { key: "diamond",    weight: 15, className: "target-diamond",    emoji: "◆" },
  { key: "emerald",    weight: 15, className: "target-emerald",    emoji: "■" },
  { key: "creeper",    weight: 15, className: "target-creeper",    emoji: "▲" },
  { key: "silverfish", weight: 10, className: "target-silverfish", emoji: "●" },
  { key: "gold",       weight: 5,  className: "target-gold",       emoji: "★" },
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
  { name: "킹갓제너럴두급", min: 80 },
];
// 등급 이미지 파일명 매핑 (end_images/n1.png ~ n8.png, i1.png ~ i6.png)
const GRADE_IMAGE_MAP_NORMAL = ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"];
const GRADE_IMAGE_MAP_IMPOSSIBLE = ["i1", "i2", "i3", "i4", "i5", "i6"];

const GOOD_END_CUT = { easy: 65, normal: 65, hard: 65, impossible: 45 };
const MOBILE_BONUS = 20;

/* ---------- DOM 참조 ---------- */
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

/* =========================================================
   사운드 (Web Audio API로 카운트다운 비프음 생성, 나머지는 파일 재생)
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
function playSound(key) {
  if (state.isMuted) return;
  const src = SOUND_FILES[key];
  if (!src) return;
  const audio = new Audio(src);
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
에메랄드 블록: 80% 확률 +5점 / 20% 확률 -5점
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

/* ---------- 랭킹 모달 (자리만, Firebase는 4순위) ---------- */
$("btn-ranking").addEventListener("click", () => $("ranking-modal").classList.remove("hidden"));
$("btn-ranking-close").addEventListener("click", () => $("ranking-modal").classList.add("hidden"));
document.querySelectorAll("#ranking-tabs .tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#ranking-tabs .tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
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
  $("math-question").textContent = q.text;
  $("math-answer").value = "";
  $("math-feedback").textContent = "";
  $("math-feedback").className = "feedback";
  $("math-label").textContent =
    state.mathPhase === "first" ? "게임 시작 전 문제를 풀어주세요" : "게임이 끝났어요! 다시 풀어볼까요?";
  showScreen("math");
  state.mathStartTs = performance.now();
  setTimeout(() => $("math-answer").focus(), 100);
}

function submitMath() {
  const userVal = parseInt($("math-answer").value, 10);
  const elapsedSec = (performance.now() - state.mathStartTs) / 1000;

  if (userVal === state.mathAnswer) {
    $("math-feedback").textContent = `정답! (${elapsedSec.toFixed(2)}초)`;
    $("math-feedback").className = "feedback";
  } else {
    $("math-feedback").textContent = `오답 (정답: ${state.mathAnswer}) - ${elapsedSec.toFixed(2)}초`;
    $("math-feedback").className = "feedback wrong";
  }

  if (state.mathPhase === "first") {
    state.firstMathTime = elapsedSec;
    setTimeout(() => startCountdown(), 700);
  } else {
    state.secondMathTime = elapsedSec;
    setTimeout(() => showResult(), 700);
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
  state.score = 0;
  state.timeLeft = 60;
  state.goldActive = false;
  state.isPaused = false;
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
  state.spawnTimerId = setInterval(() => {
    if (state.isPaused) return;
    if (activeTargets.length < cfg.maxOnScreen) {
      spawnTarget(cfg);
    }
  }, cfg.spawnInterval);
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
  const x = Math.random() * (fw - size - 20) + 10;
  const y = Math.random() * (fh - size - 100) + 80; // HUD 영역 피하기

  const el = document.createElement("div");
  el.className = `target ${type.className}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.textContent = type.emoji;
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
        delta = -5;
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
  setTimeout(() => web.remove(), 1500);
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
  clearInterval(state.timerId);
  clearInterval(state.spawnTimerId);
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
