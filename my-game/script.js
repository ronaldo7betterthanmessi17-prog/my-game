// 🎯 기본 변수
let difficulty = "normal";
let score = 0;
let timeLeft = 120;

let gameInterval;
let timerInterval;

let spawnSpeed = 900;

let isGameRunning = false;
let isStarting = false;


// 🎮 난이도 선택
function setDifficulty(level) {
  if (isGameRunning) return;

  difficulty = level;

  document.querySelectorAll("#difficultyMenu button").forEach(btn => {
    btn.classList.remove("active");
  });

  document.getElementById(level + "Btn").classList.add("active");
}


// 🎬 카운트다운
function startCountdown() {
  if (isStarting) return;
  isStarting = true;

  let count = 5;
  const cd = document.getElementById("countdown");

  cd.innerText = count;

  const interval = setInterval(() => {
    count--;
    cd.innerText = count;

    if (count === 0) {
      clearInterval(interval);
      cd.innerText = "START!";

      setTimeout(() => {
        cd.innerText = "";
        isStarting = false;
        startGame();
      }, 1000);
    }
  }, 1000);
}


// 🎮 게임 시작
function startGame() {
  score = 0;
  timeLeft = 120;
  isGameRunning = true;

  clearGameArea();
  updateUI();

  // 💥 난이도 밸런스
  if (difficulty === "easy") spawnSpeed = 1200;
  else if (difficulty === "normal") spawnSpeed = 900;
  else if (difficulty === "hard") spawnSpeed = 650;
  else if (difficulty === "impossible") spawnSpeed = 400;

  gameInterval = setInterval(spawnTarget, spawnSpeed);
  timerInterval = setInterval(updateTimer, 1000);
}


// ⏱️ 타이머
function updateTimer() {
  timeLeft--;
  document.getElementById("timer").innerText = "시간: " + timeLeft;

  if (timeLeft <= 0) {
    endGame();
  }
}


// 🎯 타겟 생성
function spawnTarget() {
  if (!isGameRunning) return;

  const gameArea = document.getElementById("gameArea");

  let spawnCount = 1;

  if (difficulty === "easy") spawnCount = 1;
  if (difficulty === "normal") spawnCount = 2;
  if (difficulty === "hard") spawnCount = 3;
  if (difficulty === "impossible") spawnCount = 4;

  for (let i = 0; i < spawnCount; i++) {
    const target = createTarget(gameArea);
    gameArea.appendChild(target);

    let lifeTime = 900;

    if (difficulty === "easy") lifeTime = 1200;
    if (difficulty === "normal") lifeTime = 900;
    if (difficulty === "hard") lifeTime = 700;
    if (difficulty === "impossible") lifeTime = 550;

    setTimeout(() => {
      target.remove();
    }, lifeTime);
  }
}


// 🎯 타겟 생성 (단 하나만 존재)
function createTarget(gameArea) {
  const target = document.createElement("div");
  target.classList.add("target");

  target.style.left = x + "px";
  target.style.top = y + "px";

  // 🎲 랜덤 타입
  const rand = Math.random();
  let type;

  if (rand < 0.5) type = "mole";
  else if (rand < 0.7) type = "gold";
  else if (rand < 0.85) type = "diamond";
  else if (rand < 0.95) type = "emerald";
  else type = "creeper";

  target.dataset.type = type;

  // 🎨 이미지 (로컬)
  target.style.backgroundImage = `url('images/${type}.png')`;

  target.onclick = () => handleTargetClick(target);

  return target;
}


// 💥 클릭 처리 (단 하나만 존재)
function handleTargetClick(target) {
  if (!isGameRunning) return;

  const type = target.dataset.type;

  if (type === "mole") score += 1;
  else if (type === "gold") score += 2;
  else if (type === "diamond") score += 3;
  else if (type === "emerald") score += 4;
  else if (type === "creeper") {
    score -= 5;

    document.body.style.background = "red";
    setTimeout(() => {
      document.body.style.background = "#222";
    }, 100);
  }

  updateScore();

  target.onclick = null;
  target.remove();
}


// 📊 점수 업데이트
function updateScore() {
  document.getElementById("score").innerText = "점수: " + score;
}


// 🧹 게임 초기화
function clearGameArea() {
  document.getElementById("gameArea").innerHTML = "";
}


// 🖥️ UI 초기화
function updateUI() {
  document.getElementById("score").innerText = "점수: 0";
  document.getElementById("timer").innerText = "시간: 120";
}


// 🏁 게임 종료
function endGame() {
  isGameRunning = false;

  clearInterval(gameInterval);
  clearInterval(timerInterval);

  clearGameArea();

  alert("게임 종료! 점수: " + score);
}


// 📖 설명
function showInfo() {
  alert("좋은 타겟을 누르고, 나쁜 타겟은 피하세요!");
}


// 🚀 초기 실행
window.onload = () => {
  setDifficulty("normal");
};