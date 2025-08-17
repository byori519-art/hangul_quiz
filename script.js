const $ = sel => document.querySelector(sel);

let data = [];
let idx = 0;
let REVIEW = new Set();
let cachedVoice = null;
let lastSpoken = "", lastSpeakAt = 0;

window.addEventListener("load", ()=>{
  loadLevel("data/level1.json");

  $("#checkBtn").addEventListener("click", checkAnswer);
  $("#hintBtn").addEventListener("click", ()=> speakKo(data[idx].word));
  $("#loadLevel").addEventListener("click", ()=>{
    loadLevel("data/"+$("#levelSelect").value);
  });
  $("#btnStartReview").addEventListener("click", ()=>{
    if (!REVIEW.size) { alert("復習リストは空です"); return; }
    $("#reviewOnly").checked = true;
    idx = 0;
    nextQuestion(true);
  });
  $("#clearReview").addEventListener("click", ()=>{
    REVIEW.clear();
    renderReview();
  });
});

function loadLevel(file){
  fetch(file).then(r=>r.json()).then(json=>{
    data = json;
    idx = 0;
    nextQuestion();
  });
}

function nextQuestion(fromReview=false){
  let pool = $("#reviewOnly").checked ? Array.from(REVIEW).map(i=>data[i]) : data;
  if (!pool.length) { $("#word").textContent="---"; return; }
  let q = pool[Math.floor(Math.random()*pool.length)];
  idx = data.indexOf(q);
  $("#word").textContent = q.meaning; // 日本語表示
  $("#answer").value="";
  $("#result").textContent="";
}

function checkAnswer(){
  let ans = $("#answer").value.trim();
  if (!data[idx]) return;
  if (ans === data[idx].word){
    $("#result").textContent="⭕ 正解!";
    beep("success");
    speakKo(data[idx].word);
  } else {
    $("#result").textContent=`❌ 不正解 → ${data[idx].word}`;
    beep("fail");
    REVIEW.add(idx);
    renderReview();
  }
  nextQuestion();
}

function beep(type){
  const ctx = new (window.AudioContext||window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  osc.type="square";
  osc.frequency.value = (type==="fail")?220:880;
  osc.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime+0.2);
}

function renderReview(){
  $("#review").innerHTML="";
  for (let i of REVIEW){
    let li=document.createElement("li");
    li.textContent=`${data[i].meaning} → ${data[i].word}`;
    $("#review").appendChild(li);
  }
}

function speakKo(text){
  if (!("speechSynthesis" in window)) return;
  const now = Date.now();
  if (text === lastSpoken && now - lastSpeakAt < 600) return;
  lastSpoken = text; lastSpeakAt = now;

  try { speechSynthesis.cancel(); } catch(_){}
  setTimeout(()=>{
    const u = new SpeechSynthesisUtterance(text);
    u.rate=0.95;
    if (cachedVoice){ u.voice=cachedVoice; u.lang=cachedVoice.lang; }
    else u.lang="ko-KR";
    speechSynthesis.speak(u);
  },60);
}
