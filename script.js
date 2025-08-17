// ====== ユーティリティ ======
const $ = s => document.querySelector(s);
const JA_RANGE = /[ぁ-んァ-ン一-龥]/;
const ONLY_JA = /[^\u3040-\u30FF\u4E00-\u9FFF・ー（）()\s、，]/g;
const ONLY_KO = /[^가-힣\s]/g;

function sanitizeItem(item){
  // 余計な数字・記号や次の語のくっつきを除去（読み込み時クリーン）
  let ko = String(item.word || item.kr || "").replace(/\d+/g,"").replace(ONLY_KO,"").trim();
  let ja = String(item.meaning || item.jp || "").replace(/\d+/g," ").replace(ONLY_JA," ").replace(/\s+/g," ").trim();
  // 先頭の日本語フレーズだけ残す（長文が混じる対策）
  if (ja.includes(" ")) {
    const parts = ja.split(/(?:\s{2,}|[、，])/).filter(t=>t && JA_RANGE.test(t));
    if (parts[0]) ja = parts[0];
  }
  return { word: ko, meaning: ja };
}

function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]] } return a; }

// ====== 状態 ======
let data = [];
let order = [];
let idx = 0;
let REVIEW = new Set();

let audioReady = false, cachedVoice=null, lastSpoken="", lastSpeakAt=0;

// ====== 音周り ======
function primeAudio(){
  try{
    const Ctx = window.AudioContext||window.webkitAudioContext;
    const ctx=new Ctx(), o=ctx.createOscillator(), g=ctx.createGain();
    g.gain.value=0; o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime+0.02);
  }catch{}
  if ('speechSynthesis' in window) cachedVoice = speechSynthesis.getVoices().find(v=>/ko|Korean|한국어/i.test((v.lang||"")+(v.name||"")))||null;
  audioReady = true;
}
function speakKo(text){
  if (!("speechSynthesis" in window)) return;
  const now=Date.now();
  if (text===lastSpoken && now-lastSpeakAt<600) return;
  lastSpoken=text; lastSpeakAt=now;
  try{ speechSynthesis.cancel(); }catch(_){}
  setTimeout(()=>{
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    if (cachedVoice){ u.voice=cachedVoice; u.lang=cachedVoice.lang; } else { u.lang="ko-KR"; }
    speechSynthesis.speak(u);
  }, 60);
}
function beep(type="ok"){
  try{
    const Ctx = window.AudioContext||window.webkitAudioContext; if(!Ctx) return;
    const ctx=new Ctx(), o=ctx.createOscillator(), g=ctx.createGain();
    o.type=(type==="ok"?"sine":"square");
    o.frequency.value=(type==="ok"?880:220);
    g.gain.setValueAtTime(0.0001,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25,ctx.currentTime+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+0.2);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime+0.22);
  }catch{}
}

// ====== 出題 ======
function currentPool(){
  if ($("#reviewOnly").checked && REVIEW.size){
    return Array.from(REVIEW).map(i=>data[i]);
  }
  return data;
}
function pickQuestion(){
  const pool=currentPool();
  if (!pool.length){ $("#word").textContent="（出題できる語がありません）"; return null; }
  // プールからランダム、実データindexへ戻す
  const q = pool[Math.floor(Math.random()*pool.length)];
  idx = data.indexOf(q);
  return q;
}
function showQuestion(){
  const q = pickQuestion();
  if (!q) return;
  $("#word").textContent = q.meaning; // 画面には日本語だけ
  $("#answer").value = "";
  $("#result").className="muted";
  $("#result").textContent = "Enter でも判定できます";
  $("#answer").focus();
}
function renderReview(){
  const ul=$("#review"); ul.innerHTML="";
  [...REVIEW].forEach(i=>{
    const li=document.createElement("div");
    li.innerHTML = `• ${data[i].meaning} → <b>${data[i].word}</b>`;
    ul.appendChild(li);
  });
  $("#reviewStats").textContent = `項目: ${REVIEW.size}`;
}

// ====== 判定 ======
function checkAnswer(){
  const q = data[idx]; if (!q) return;
  const ans = $("#answer").value.trim().normalize("NFC");
  const ok = ans && ans === q.word.normalize("NFC");

  if (ok){
    $("#result").textContent="⭕ 正解！"; $("#result").className="ok";
    if ($("#autoSpeak").checked && audioReady) speakKo(q.word); else if ($("#autoSpeak").checked) beep("ok");
    // 自動で次へ進まない（要望）: チェックON時のみ進む
    if ($("#autoNext").checked){ showQuestion(); }
  }else{
    $("#result").innerHTML=`❌ 不正解 → <b>${q.word}</b>`; $("#result").className="ng";
    beep("ng");
    REVIEW.add(idx); renderReview();
  }
}

// ====== 読み込み ======
async function loadLevel(file){
  $("#word").textContent="読み込み中…";
  try{
    const res = await fetch(file, {cache:"no-store"});
    const raw = await res.json();
    // 形式吸収（{word,meaning} 以外の {kr,jp} などもOK）
    data = raw.map(x=>sanitizeItem({word:x.word??x.kr, meaning:x.meaning??x.jp})).filter(x=>x.word && x.meaning);
    shuffle(data);
    order = data.map((_,i)=>i);
    REVIEW.clear(); renderReview();
    showQuestion();
  }catch(e){
    $("#word").textContent="読み込み失敗… パスとJSONを確認してください";
    console.error(e);
  }
}

// ====== イベント ======
window.addEventListener("load", ()=> loadLevel("data/level1.json"));
$("#loadLevel").addEventListener("click", ()=> loadLevel($("#levelSelect").value));
$("#checkBtn").addEventListener("click", checkAnswer);
$("#nextBtn").addEventListener("click", showQuestion);
$("#hintBtn").addEventListener("click", ()=>{ const q=data[idx]; if(q){ if(audioReady) speakKo(q.word); else beep("ok"); } });
$("#startReview").addEventListener("click", ()=>{ if(!REVIEW.size) return alert("復習リストは空です"); $("#reviewOnly").checked=true; showQuestion(); });
$("#clearReview").addEventListener("click", ()=>{ REVIEW.clear(); renderReview(); });
$("#answer").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); checkAnswer(); } });
$("#enableAudio").addEventListener("click", ()=>{ primeAudio(); alert("音声を有効化しました"); });
if ('speechSynthesis' in window){ speechSynthesis.onvoiceschanged = ()=>{ if(!cachedVoice){ cachedVoice = speechSynthesis.getVoices().find(v=>/ko|Korean|한국어/i.test((v.lang||"")+(v.name||""))); } }; }
