// ====== ユーティリティ ======
const $ = s => document.querySelector(s);
const JA_RANGE = /[ぁ-んァ-ン一-龥]/;
const ONLY_JA = /[^\u3040-\u30FF\u4E00-\u9FFF・ー（）()\s、，]/g;
const ONLY_KO = /[^가-힣\s]/g;

function sanitizeItem(item){
  let ko = String(item.word || item.kr || "").replace(/\d+/g,"").replace(ONLY_KO,"").trim();
  let ja = String(item.meaning || item.jp || "").replace(/\d+/g," ").replace(ONLY_JA," ").replace(/\s+/g," ").trim();
  if (ja.includes(" ")) {
    const parts = ja.split(/(?:\s{2,}|[、，])/).filter(t=>t && JA_RANGE.test(t));
    if (parts[0]) ja = parts[0];
  }
  return { word: ko, meaning: ja };
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]] } return a; }

// ====== 行が「左列+右列」くっつきの場合を2件に展開 ======
function explodeRow(item) {
  const koRaw = String(item.word ?? item.kr ?? "").trim();
  const jaRaw = String(item.meaning ?? item.jp ?? "").trim();

  // 韓国語は連続ハングルだけを抽出して配列化
  const koList = (koRaw.match(/[가-힣]+/g) || []).filter(Boolean);

  // 日本語は「2個以上の半角/全角スペース」で列分割（表の左右列を想定）
  let jaList = jaRaw.split(/[ 　]{2,}/).map(s => s.trim()).filter(Boolean);
  if (jaList.length === 0) jaList = [jaRaw];

  const out = [];
  for (let i = 0; i < koList.length; i++) {
    const ko = koList[i];
    const ja = jaList[Math.min(i, jaList.length - 1)];
    out.push(sanitizeItem({ word: ko, meaning: ja }));
  }
  return out.length ? out : [sanitizeItem({ word: koRaw, meaning: jaRaw })];
}

// ====== 状態 ======
let data = [];
let idx = 0;
let REVIEW = new Set();

let audioReady = false, cachedVoice=null, lastSpoken="", lastSpeakAt=0;

// ====== 音まわり（強化版） ======
function resumeSafe(){ try{ speechSynthesis.cancel(); speechSynthesis.resume(); }catch(_){} }

function waitVoices(timeout=1500){
  return new Promise(resolve=>{
    let done=false;
    const finish = ()=>{ if(done) return; done=true; resolve(speechSynthesis.getVoices()||[]); };
    const timer = setTimeout(finish, timeout);
    const handler = ()=>{
      clearTimeout(timer);
      speechSynthesis.onvoiceschanged = null;
      finish();
    };
    const vs = speechSynthesis.getVoices();
    if (vs && vs.length){ clearTimeout(timer); done=true; resolve(vs); return; }
    speechSynthesis.onvoiceschanged = handler;
  });
}

async function primeAudio(){
  try{
    const Ctx = window.AudioContext||window.webkitAudioContext;
    const ctx=new Ctx(), o=ctx.createOscillator(), g=ctx.createGain();
    g.gain.value=0; o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime+0.02);
  }catch{}

  if ('speechSynthesis' in window){
    resumeSafe();
    const vs = await waitVoices();
    cachedVoice = vs.find(v=>/ko|Korean|한국어/i.test((v.lang||"")+(v.name||""))) || null;

    // クリック同一ハンドラ内テスト発声（iOS対策）
    try{
      const test = new SpeechSynthesisUtterance("가");
      test.rate = 0.95;
      if (cachedVoice){ test.voice=cachedVoice; test.lang=cachedVoice.lang; } else { test.lang="ko-KR"; }
      speechSynthesis.speak(test);
    }catch(_){}
  }
  audioReady = true;
}
window.addEventListener('pointerdown', ()=>{ if(!audioReady) primeAudio(); }, {once:true});

function speakKo(text){
  if (!("speechSynthesis" in window)) return;
  const now = Date.now();
  if (text === lastSpoken && now - lastSpeakAt < 600) return;
  lastSpoken = text; lastSpeakAt = now;

  resumeSafe();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  if (cachedVoice){ u.voice = cachedVoice; u.lang = cachedVoice.lang; } else { u.lang = "ko-KR"; }
  speechSynthesis.speak(u);
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
  const q = pool[Math.floor(Math.random()*pool.length)];
  idx = data.indexOf(q);
  return q;
}
function showQuestion(){
  const q = pickQuestion();
  if (!q) return;
  $("#word").textContent = q.meaning;
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

// ====== 判定（正解でも自動で次へ行かない） ======
function checkAnswer(){
  const q = data[idx]; if (!q) return;
  const ans = $("#answer").value.trim().normalize("NFC");
  const ok = ans && ans === q.word.normalize("NFC");

  if (ok){
    $("#result").textContent="⭕ 正解！"; $("#result").className="ok";
    if ($("#autoSpeak").checked && audioReady) speakKo(q.word); else if ($("#autoSpeak").checked) beep("ok");
    if ($("#autoNext").checked){ showQuestion(); } // 自動進行したい場合のみON
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

    // ★ 1行→2語の展開＋クリーニング
    const normalized = [];
    raw.forEach(x => { normalized.push(...explodeRow(x)); });
    data = normalized.filter(x => x.word && x.meaning);

    shuffle(data);
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

// 音声を有効化（テスト発声つき）
$("#enableAudio").addEventListener("click", () => { primeAudio(); });

// 遅延ロード環境向け
if ('speechSynthesis' in window){
  speechSynthesis.onvoiceschanged = ()=>{
    if(!cachedVoice){
      const vs = speechSynthesis.getVoices();
      cachedVoice = vs.find(v=>/ko|Korean|한국어/i.test((v.lang||"")+(v.name||""))) || cachedVoice;
    }
  };
}
