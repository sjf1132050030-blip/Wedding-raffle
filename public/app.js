const $ = (id) => document.getElementById(id);
const ROLE = window.LOTTERY_ROLE === "host" ? "host" : "guest";

const ui = {
  couple: $("couple"),
  title: $("title"),
  drawnStrip: $("drawnStrip"),
  eyebrow: $("eyebrow"),
  levelRibbon: $("levelRibbon"),
  hint: $("hint"),
  batchRow: $("batchRow"),
  actions: $("actions"),
  boardList: $("boardList"),
  xiWall: $("xiWall"),
  revealOverlay: $("revealOverlay"),
  revealNumbers: $("revealNumbers"),
  revealLevel: $("revealLevel"),
  revealPrize: $("revealPrize"),
  revealMeaning: $("revealMeaning"),
  revealContinue: $("revealContinue"),
  settings: $("settings"),
  scrim: $("scrim"),
  settingsForm: $("settingsForm"),
  prizeEditor: $("prizeEditor"),
  settingsNote: $("settingsNote"),
  toast: $("toast"),
  toggleSound: $("toggleSound"),
  winFlash: $("winFlash"),
  cover: $("cover"),
  coverCouple: $("coverCouple"),
  coverSub: $("coverSub"),
  coverCount: $("coverCount"),
  coverTicket: $("coverTicket"),
  coverTicketNum: $("coverTicketNum"),
  coverQr: $("coverQr"),
  claimClosed: $("claimClosed"),
  claimNumber: $("claimNumber"),
  enterLottery: $("enterLottery"),
  myTicket: $("myTicket"),
  myTicketNum: $("myTicketNum"),
  youWin: $("youWin"),
  youWinKicker: $("youWinKicker"),
  youWinNumber: $("youWinNumber"),
  youWinLevel: $("youWinLevel"),
  youWinPrize: $("youWinPrize"),
  youWinMeaning: $("youWinMeaning"),
  youWinClose: $("youWinClose"),
  hostGate: $("hostGate"),
  hostLogin: $("hostLogin"),
  hostGateErr: $("hostGateErr"),
  hostQrFloat: $("hostQrFloat"),
  hitOverlay: $("hitOverlay"),
  hitSeal: $("hitSeal"),
  hitNumber: $("hitNumber"),
};

let state = null;
let busy = false;
let rolling = false;
let toastTimer = 0;
let editLevels = [];
let editPrizes = [];
const confettiBits = [];
let myNumber = null;
let claiming = false;
let wsLive = false;
let youWinShownFor = "";
const playedDraws = new Set();

function makeClip(src, volume = 1) {
  const a = new Audio(src);
  a.preload = "auto";
  a.volume = volume;
  a.preservesPitch = true;
  a.webkitPreservesPitch = true;
  return a;
}

const sfx = {
  enabled: localStorage.getItem("lottery-sfx") !== "off",
  ready: false,
  clips: {},

  init() {
    if (this.clips.roll) return;
    this.clips = {
      roll: makeClip("/audio/roll.mp3", 0.9),
      drum: makeClip("/audio/drumroll.mp3", 0.58),
      intro: makeClip("/audio/intro.mp3", 0.82),
      hit: makeClip("/audio/hit.mp3", 1),
      ding: makeClip("/audio/ding.mp3", 0.95),
      win: makeClip("/audio/win.mp3", 0.96),
      fanfare: makeClip("/audio/fanfare.mp3", 0.96),
      applause: makeClip("/audio/applause.mp3", 0.84),
    };
  },

  async unlock() {
    this.init();
    if (!this.enabled) return;
    if (this.ready) return;
    const clips = Object.values(this.clips);
    await Promise.all(clips.map(async (a) => {
      try {
        a.muted = true;
        await a.play();
        a.pause();
        a.currentTime = 0;
        a.muted = false;
      } catch {
        /* 现场电脑可能拦截自动播放 */
      }
    }));
    this.ready = true;
  },

  live() {
    return this.enabled && this.ready;
  },

  stopClip(a) {
    if (!a) return;
    try {
      a.pause();
      a.currentTime = 0;
      a.playbackRate = 1;
    } catch { /* ignore */ }
  },

  playClip(a, { loop = false, volume, rate = 1, from = 0 } = {}) {
    if (!this.live() || !a) return;
    try {
      a.loop = loop;
      if (volume != null) a.volume = volume;
      a.playbackRate = rate;
      a.currentTime = from;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch { /* ignore */ }
  },

  stopAll(except = []) {
    for (const [name, a] of Object.entries(this.clips)) {
      if (except.includes(name)) continue;
      this.stopClip(a);
    }
  },

  tick() {},

  startRoll() {
    if (!this.live()) return;
    this.stopClip(this.clips.intro);
    this.stopClip(this.clips.win);
    this.stopClip(this.clips.fanfare);
    this.stopClip(this.clips.applause);
    this.playClip(this.clips.roll, { loop: true, volume: 0.9, rate: 1 });
    this.playClip(this.clips.drum, { loop: false, volume: 0.58, rate: 1 });
  },

  setRoll(progress) {
    if (!this.live()) return;
    const p = Math.max(0, Math.min(1, progress));
    if (this.clips.roll) this.clips.roll.playbackRate = 1 + p * 0.32;
    if (this.clips.drum) this.clips.drum.playbackRate = 1 + p * 0.2;
  },

  stopRoll() {
    this.stopClip(this.clips.roll);
    this.stopClip(this.clips.drum);
  },

  hit() {
    if (!this.live()) return;
    this.stopRoll();
    this.playClip(this.clips.ding, { volume: 0.95 });
    this.playClip(this.clips.hit, { volume: 1 });
  },

  win() {
    if (!this.live()) return;
    this.playClip(this.clips.win, { volume: 0.96 });
  },

  fanfare() {
    if (!this.live()) return;
    this.stopAll(["fanfare", "applause"]);
    this.playClip(this.clips.fanfare, { volume: 0.96 });
    this.playClip(this.clips.applause, { volume: 0.84 });
  },

  intro() {
    if (!this.live()) return;
    this.playClip(this.clips.intro, { volume: 0.82 });
  },
};

sfx.init();

function syncSoundButton() {
  if (!ui.toggleSound) return;
  ui.toggleSound.textContent = sfx.enabled ? "音乐 开" : "音乐 关";
  ui.toggleSound.classList.toggle("sound-off", !sfx.enabled);
}

function burstWinFlash() {
  const el = ui.winFlash;
  if (!el) return;
  el.classList.remove("hidden");
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
  clearTimeout(burstWinFlash.timer);
  burstWinFlash.timer = setTimeout(() => el.classList.add("hidden"), 780);
}

function showHitNumber(number) {
  const max = displayMaxOf(state);
  ui.hitNumber.textContent = pad(number, max);
  ui.hitSeal.classList.remove("out");
  ui.hitSeal.style.animation = "none";
  ui.hitOverlay.classList.remove("hidden");
  void ui.hitSeal.offsetWidth;
  ui.hitSeal.style.animation = "";
}

async function hideHitNumber() {
  ui.hitSeal.classList.add("out");
  await sleep(320);
  ui.hitOverlay.classList.add("hidden");
  ui.hitSeal.classList.remove("out");
}

function coverOpen() {
  return ui.cover && !ui.cover.classList.contains("hidden") && !ui.cover.classList.contains("leave");
}

function claimingOpen(s) {
  if (!s || !s.session) return true;
  if (s.claimingOpen != null) return Boolean(s.claimingOpen);
  return !s.session.started && s.session.phase === "idle";
}

function renderGuestQr(s) {
  if (ROLE !== "host") return;
  const open = claimingOpen(s);
  if (ui.coverQr) ui.coverQr.classList.toggle("hidden", !open);
  if (ui.hostQrFloat) ui.hostQrFloat.classList.toggle("hidden", !open || coverOpen());
  if (ROLE === "host" && ui.claimClosed) ui.claimClosed.classList.toggle("hidden", open);
  if (!open) return;
  const url = (s && s.guestUrl) || `${location.protocol}//${location.host}/`;
  for (const el of document.querySelectorAll("[data-qr-url]")) el.textContent = url;
  for (const img of document.querySelectorAll("[data-qr-img]")) {
    if (img.dataset.ready === url) continue;
    img.dataset.ready = url;
    img.src = "/api/qr.svg";
  }
}

function syncClaimUi(s) {
  const open = claimingOpen(s);
  const hasNum = myNumber != null;
  if (ROLE === "guest") {
    if (ui.claimNumber) {
      ui.claimNumber.classList.toggle("hidden", hasNum || !open);
      ui.claimNumber.disabled = hasNum || !open || claiming;
    }
    if (ui.claimClosed) ui.claimClosed.classList.toggle("hidden", hasNum || open);
    if (ui.enterLottery) ui.enterLottery.classList.toggle("hidden", !hasNum && open);
  }
}

async function enterLottery() {
  if (!coverOpen()) return;
  await sfx.unlock();
  sfx.intro();
  ui.cover.classList.add("leave");
  if (ui.hostQrFloat) ui.hostQrFloat.classList.toggle("hidden", !claimingOpen(state));
  await sleep(520);
  ui.cover.classList.add("hidden");
  if (ui.hostQrFloat) ui.hostQrFloat.classList.toggle("hidden", !claimingOpen(state));
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

function pad(n, max) {
  const width = String(max || state?.displayMax || state?.config?.numberMax || 150).length;
  return String(n).padStart(Math.max(3, width), "0");
}

function isWeChatMobile() {
  const ua = navigator.userAgent || "";
  if (!/MicroMessenger/i.test(ua)) return false;
  if (/WindowsWechat|MacWechat|WeChatForWindows|WeChatForMac/i.test(ua)) return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

function guestLocalId() {
  const key = "lottery-guest-id";
  try {
    let id = localStorage.getItem(key);
    if (!id || id.length < 8) {
      id = `g${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return `g${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  }
}

async function deviceFingerprint() {
  const parts = [
    navigator.userAgent,
    navigator.language,
    navigator.languages && navigator.languages.join(","),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    navigator.hardwareConcurrency || "",
    navigator.maxTouchPoints || "",
    navigator.platform || "",
    String(new Date().getTimezoneOffset()),
  ];
  try {
    const c = document.createElement("canvas");
    c.width = 220;
    c.height = 40;
    const ctx = c.getContext("2d");
    ctx.textBaseline = "top";
    ctx.font = "16px Arial";
    ctx.fillStyle = "#c2182c";
    ctx.fillText("囍-fingerprint", 4, 8);
    parts.push(c.toDataURL());
  } catch {
    /* ignore */
  }
  const raw = parts.join("|");
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return `fb${h.toString(16).padStart(16, "0")}${guestLocalId()}`;
}

function displayMaxOf(s) {
  return (s && (s.displayMax || s.config?.numberMax)) || 150;
}

function setMyNumber(n, max) {
  myNumber = n;
  const shown = pad(n, max || displayMaxOf(state));
  if (ui.coverTicketNum) ui.coverTicketNum.textContent = shown;
  if (ui.coverTicket) ui.coverTicket.classList.remove("hidden");
  if (ui.myTicket) {
    ui.myTicket.classList.remove("hidden");
    ui.myTicketNum.textContent = shown;
  }
  if (ui.claimNumber) ui.claimNumber.classList.add("hidden");
  if (ROLE === "guest" && ui.enterLottery) ui.enterLottery.classList.remove("hidden");
}

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.add("hidden"), 2400);
}

function setBusy(value) {
  busy = value;
  for (const btn of ui.actions.querySelectorAll("button")) btn.disabled = value || rolling;
}

function currentLevel(s) {
  return s.currentLevel || s.levels.find((l) => l.id === s.session.currentLevelId) || s.levels[0];
}

function wallNumbers(s) {
  const claimed = Array.isArray(s.claimedNumbers) ? s.claimedNumbers.slice() : [];
  const used = new Set(s.draws.map((d) => d.number));
  const batch = new Set(s.session.currentBatch || []);
  return claimed.filter((n) => !used.has(n) || batch.has(n));
}

function renderStrip(s) {
  const max = displayMaxOf(s);
  if (!s.draws.length) {
    ui.drawnStrip.innerHTML = '<span class="muted">暂无</span>';
    return;
  }
  ui.drawnStrip.innerHTML = s.draws
    .map((d) => {
      const cls = d.revealed ? "tag done" : "tag pending";
      const title = d.revealed ? `${d.levelName} · ${d.prizeName}` : "已抽出，待公布奖品";
      return `<span class="${cls}" title="${title}">${pad(d.number, max)}</span>`;
    })
    .join("");
}

function renderBoard(s) {
  const grouped = s.levels.map((level) => {
    const prizes = s.prizes.filter((p) => p.levelId === level.id);
    const items = prizes.map((prize) => {
      const related = s.draws.filter((d) => d.prizeId === prize.id);
      const revealed = related.length > 0 && related.every((d) => d.revealed);
      return { prize, related, revealed };
    });
    const need = prizes.reduce((n, p) => n + p.count, 0);
    const got = items.reduce((n, it) => n + it.related.length, 0);
    return { level, items, need, got };
  }).filter((g) => g.items.length);

  ui.boardList.innerHTML = grouped.map((g) => {
    const rows = g.items.map((it) => {
      const nums = it.related.map((d) => pad(d.number, displayMaxOf(s))).join("  ") || "待抽取";
      const cls = it.revealed ? "prize-line" : "prize-line pending";
      const name = it.revealed ? it.prize.name : "待公布";
      return `<div class="${cls}"><span class="name">${name} ×${it.prize.count}</span><span class="nums">${nums}</span></div>`;
    }).join("");
    return `<section class="level-block"><h3>${g.level.name}</h3><p class="progress">已抽 ${g.got} / ${g.need}</p>${rows}</section>`;
  }).join("");
}

function cardHtml(n, flipped, max) {
  return `<div class="xi-card${flipped ? " flipped" : ""}" data-num="${n}">
    <div class="xi-inner">
      <div class="xi-face xi-front">囍</div>
      <div class="xi-face xi-back">${pad(n, max)}</div>
    </div>
  </div>`;
}

let lastFitKey = "";
function fitWall(count) {
  const wall = ui.xiWall;
  const areaW = wall.clientWidth;
  const areaH = wall.clientHeight;
  if (areaW < 40 || areaH < 40 || count <= 0) return;
  const gap = areaW < 520 ? 4 : 6;
  const ratio = 0.76;
  let best = null;
  const maxCols = Math.min(count, Math.max(6, Math.floor(areaW / 26)));
  const minCols = 4;
  for (let cols = minCols; cols <= maxCols; cols++) {
    const rows = Math.ceil(count / cols);
    const cellW = (areaW - gap * (cols - 1)) / cols;
    const cellH = (areaH - gap * (rows - 1)) / rows;
    if (cellW < 22 || cellH < 28) continue;
    let w = Math.min(cellW, cellH * ratio);
    let h = w / ratio;
    if (h > cellH) {
      h = cellH;
      w = h * ratio;
    }
    if (w < 22 || h < 28) continue;
    const leftover = cols * rows - count;
    const usedW = w * cols + gap * (cols - 1);
    const usedH = h * rows + gap * (rows - 1);
    const fill = (usedW / areaW) * (usedH / areaH);
    const score = w * h * (0.75 + 0.25 * fill) - leftover * 30;
    if (!best || score > best.score) best = { cols, w, h, score };
  }
  if (!best) best = { cols: Math.min(count, 10), w: 36, h: 48 };
  const key = `${count}:${best.cols}:${best.w.toFixed(1)}:${best.h.toFixed(1)}:${gap}`;
  if (key === lastFitKey) return;
  lastFitKey = key;
  wall.style.setProperty("--card-w", `${best.w.toFixed(1)}px`);
  wall.style.setProperty("--card-h", `${best.h.toFixed(1)}px`);
  wall.style.setProperty("--gap", `${gap}px`);
}

function observeWall() {
  if (ui.xiWall.dataset.observed) return;
  ui.xiWall.dataset.observed = "1";
  const ro = new ResizeObserver(() => {
    const n = ui.xiWall.querySelectorAll(".xi-card").length;
    if (n) fitWall(n);
  });
  ro.observe(ui.xiWall);
}

function syncWall(s) {
  const nums = wallNumbers(s);
  const batch = new Set(s.session.currentBatch || []);
  const existing = [...ui.xiWall.querySelectorAll(".xi-card")].map((el) => Number(el.dataset.num));
  const same = existing.length === nums.length && existing.every((n, i) => n === nums[i]);
  if (!nums.length) {
    lastFitKey = "";
    ui.xiWall.innerHTML = '<div class="wall-empty">囍</div>';
    return;
  }
  if (!same) {
    lastFitKey = "";
    ui.xiWall.innerHTML = nums.map((n) => cardHtml(n, batch.has(n), displayMaxOf(s))).join("");
  } else if (!rolling) {
    for (const el of ui.xiWall.querySelectorAll(".xi-card")) {
      el.classList.toggle("flipped", batch.has(Number(el.dataset.num)));
      el.classList.remove("picked", "flash");
    }
  }
  for (const el of ui.xiWall.querySelectorAll(".xi-card")) {
    el.classList.toggle("mine", myNumber != null && Number(el.dataset.num) === myNumber);
  }
  observeWall();
  fitWall(nums.length);
  requestAnimationFrame(() => fitWall(nums.length));
}

function renderStage(s) {
  document.title = s.config.title || "新婚快乐 幸运大抽奖";
  ui.couple.textContent = s.config.couple;
  ui.title.textContent = s.config.title;
  if (ui.coverCouple) ui.coverCouple.textContent = s.config.couple;
  const level = currentLevel(s);
  const phase = s.session.phase;
  const prize = s.currentPrize;
  const max = displayMaxOf(s);
  if (ui.coverCount) ui.coverCount.textContent = `已有 ${s.claimedCount || 0} 人领取号码`;
  renderGuestQr(s);
  syncClaimUi(s);

  if (rolling) {
    ui.hint.textContent = "红包逐个闪过，好运降临…";
  } else if (phase === "idle") {
    ui.eyebrow.textContent = "翻开红包 · 喜从天降";
    ui.levelRibbon.textContent = level ? level.name : "准备开始";
    ui.hint.textContent = ROLE === "host"
      ? `已领取 ${s.claimedCount || 0} 个号码（设定 ${s.config.numberMin}–${s.config.numberMax}，超出顺延）${s.claimedCount ? "，可以开始" : "，等待宾客领号"}`
      : "请等待现场开始抽奖";
  } else if (phase === "level_done") {
    ui.eyebrow.textContent = "本轮奖项已全部抽出";
    ui.levelRibbon.textContent = `${level ? level.name : ""} 抽奖结束`;
    ui.hint.textContent = s.nextLevel ? `点击开始抽取${s.nextLevel.name}` : "全部奖项已抽完";
  } else if (phase === "all_done") {
    ui.eyebrow.textContent = "抽奖结束";
    ui.levelRibbon.textContent = "恭喜各位幸运嘉宾";
    ui.hint.textContent = "所有奖项已抽出，完整记录见右侧";
  } else {
    ui.eyebrow.textContent = "当前正在抽取";
    ui.levelRibbon.textContent = level ? level.name : "";
    if (prize) {
      ui.hint.textContent = `本轮共 ${prize.count} 个红包，已翻开 ${prize.drawn} 个，翻齐后公布奖品`;
    } else {
      ui.hint.textContent = "准备抽取";
    }
  }

  const batch = s.session.currentBatch || [];
  ui.batchRow.innerHTML = batch.map((n) => `<span class="tag done">${pad(n, max)}</span>`).join("");
  renderActions(s);
  if (!rolling) syncWall(s);
}

function renderActions(s) {
  if (ROLE !== "host") {
    ui.actions.innerHTML = `<p class="tiny">现场同步中 · 已领取 ${s.claimedCount || 0} 个号码</p>`;
    return;
  }
  const phase = s.session.phase;
  let html = "";
  if (phase === "idle") html = `<button class="btn gold" data-act="start">开始抽奖</button>`;
  if (phase === "drawing") html = `<button class="btn gold" data-act="draw">翻开红包</button>`;
  if (phase === "awaiting_reveal") html = `<button class="btn gold blink" data-act="reveal">公布奖品</button>`;
  if (phase === "revealed") html = `<button class="btn gold" data-act="continue">继续抽奖</button>`;
  if (phase === "level_done") {
    html = s.nextLevel
      ? `<button class="btn gold" data-act="continue">开始抽取${s.nextLevel.name}</button>`
      : `<button class="btn gold" data-act="continue">查看全部结果</button>`;
  }
  if (phase === "all_done") html = `<button class="btn outline" data-act="reset">重置抽奖（测试用）</button>`;
  ui.actions.innerHTML = html;
  for (const btn of ui.actions.querySelectorAll("button")) btn.disabled = busy || rolling;
}

function revealPayload(s) {
  if (s.revealed) return s.revealed;
  if (s.session.phase !== "revealed") return null;
  const related = s.draws.filter((d) => d.prizeId === s.session.currentPrizeId);
  if (!related.length) return null;
  const prize = s.prizes.find((p) => p.id === s.session.currentPrizeId);
  return {
    numbers: s.session.currentBatch,
    levelName: related[0].levelName,
    prizeName: related[0].prizeName,
    meaning: related[0].prizeMeaning || prize?.meaning || "",
  };
}

function showReveal(payload, withConfetti) {
  const max = displayMaxOf(state);
  ui.revealNumbers.innerHTML = payload.numbers.map((n) => `<span>${pad(n, max)}</span>`).join("");
  ui.revealLevel.textContent = `获得 ${payload.levelName}`;
  ui.revealPrize.textContent = payload.prizeName;
  ui.revealMeaning.textContent = payload.meaning ? `寓意：${payload.meaning}` : "";
  const wasHidden = ui.revealOverlay.classList.contains("hidden");
  ui.revealOverlay.classList.remove("hidden");
  if (withConfetti && wasHidden) burstConfetti();
}

function hideReveal() {
  ui.revealOverlay.classList.add("hidden");
}

function applyState(next, opts = {}) {
  state = next;
  if (ROLE === "guest" && myNumber != null && Array.isArray(next.claimedNumbers) && !next.claimedNumbers.includes(myNumber)) {
    myNumber = null;
    youWinShownFor = "";
    if (ui.myTicket) ui.myTicket.classList.add("hidden");
    if (ui.claimNumber) {
      ui.claimNumber.classList.remove("hidden");
      ui.claimNumber.disabled = false;
    }
    if (ui.enterLottery) ui.enterLottery.classList.add("hidden");
    if (ui.coverTicket) ui.coverTicket.classList.add("hidden");
    if (ui.youWin) ui.youWin.classList.add("hidden");
  }
  if (next && next.session && next.session.phase === "idle" && !next.draws.length) {
    playedDraws.clear();
  }
  renderStrip(state);
  renderBoard(state);
  if (!opts.skipStage) renderStage(state);
  const payload = revealPayload(state);
  if (payload) showReveal(payload, Boolean(opts.showReveal));
  else hideReveal();
  syncSettingsLock();
  syncYouWin(state);
}

async function refresh() {
  const next = await api("/api/state");
  if (rolling) {
    state = next;
    return;
  }
  applyState(next);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function scanDelay(i, n) {
  const t = n <= 1 ? 1 : i / (n - 1);
  return 38 + Math.pow(t, 2.8) * 520;
}

async function flashToWinner(number) {
  const cards = [...ui.xiWall.querySelectorAll(".xi-card:not(.flipped)")];
  const winner = ui.xiWall.querySelector(`.xi-card[data-num="${number}"]`);
  if (!winner) {
    await presentWin(number, null);
    return;
  }
  if (!cards.length) {
    winner.classList.add("flipped");
    await presentWin(number, winner);
    return;
  }
  const winIdx = Math.max(0, cards.indexOf(winner));
  const count = cards.length;
  const steps = Math.max(24, Math.min(40, Math.round(20 + count * 0.1)));
  const start = (winIdx - ((steps - 1) % count) + count * 8) % count;

  ui.xiWall.classList.add("scanning");
  sfx.startRoll();
  let prev = null;
  try {
    for (let i = 0; i < steps; i++) {
      const progress = steps <= 1 ? 1 : i / (steps - 1);
      const el = cards[(start + i) % count];
      if (prev && prev !== el) prev.classList.remove("flash");
      el.classList.add("flash");
      sfx.setRoll(progress);
      sfx.tick(progress);
      prev = el;
      await sleep(scanDelay(i, steps));
    }
  } finally {
    sfx.stopRoll();
    ui.xiWall.classList.remove("scanning");
  }
  if (prev && prev !== winner) prev.classList.remove("flash");
  await sleep(240);
  winner.classList.add("picked", "flash");
  await sleep(120);
  winner.classList.remove("flash");
  winner.classList.add("flipped");
  await presentWin(number, winner);
}

async function presentWin(number, winner) {
  sfx.hit();
  burstWinFlash();
  showHitNumber(number);
  await sleep(140);
  sfx.win();
  await sleep(1700);
  await hideHitNumber();
  if (winner) winner.classList.remove("picked");
}

function syncYouWin(s) {
  if (ROLE !== "guest" || myNumber == null || !ui.youWin) return;
  const hit = (s.draws || []).find((d) => d.number === myNumber);
  if (!hit) return;
  if (ui.myTicket) ui.myTicket.classList.add("won");
  const key = `${hit.number}:${hit.revealed ? "1" : "0"}`;
  if (youWinShownFor === key) return;
  youWinShownFor = key;
  const max = displayMaxOf(s);
  ui.youWinNumber.textContent = pad(hit.number, max);
  if (hit.revealed) {
    ui.youWinKicker.textContent = "恭喜你中奖了";
    ui.youWinLevel.textContent = `获得 ${hit.levelName}`;
    ui.youWinPrize.textContent = hit.prizeName;
    ui.youWinMeaning.textContent = hit.prizeMeaning ? `寓意：${hit.prizeMeaning}` : "";
  } else {
    ui.youWinKicker.textContent = "你的号码被抽中了";
    ui.youWinLevel.textContent = "奖品稍后公布";
    ui.youWinPrize.textContent = "";
    ui.youWinMeaning.textContent = "请留意现场大屏";
  }
  ui.youWin.classList.remove("hidden");
  sfx.unlock().then(() => sfx.fanfare()).catch(() => {});
}

let drawRunning = Promise.resolve();
function enqueueDraw(number, next) {
  if (number == null) return Promise.resolve();
  drawRunning = drawRunning.then(async () => {
    if (playedDraws.has(number)) {
      if (next && !rolling) applyState(next);
      return;
    }
    playedDraws.add(number);
    rolling = true;
    state = next || state;
    if (ui.hint) ui.hint.textContent = "红包逐个闪过，好运降临…";
    for (const btn of ui.actions.querySelectorAll("button")) btn.disabled = true;
    try {
      await flashToWinner(number);
    } finally {
      rolling = false;
    }
    applyState(next || state);
  }).catch(() => {});
  return drawRunning;
}

function connectWs() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${proto}//${location.host}/ws`);
  socket.onopen = () => { wsLive = true; };
  socket.onclose = () => {
    wsLive = false;
    setTimeout(connectWs, 1200);
  };
  socket.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (!msg || !msg.state) return;
    if (msg.type === "draw" && msg.justDrawn != null) {
      enqueueDraw(msg.justDrawn, msg.state);
      return;
    }
    if (msg.type === "reveal") {
      applyState(msg.state, { showReveal: true });
      sfx.fanfare();
      return;
    }
    if (rolling) {
      state = msg.state;
      return;
    }
    applyState(msg.state);
  };
}

async function restoreGuest() {
  if (ROLE !== "guest" || !isWeChatMobile()) return;
  try {
    const fp = await deviceFingerprint();
    const me = await api("/api/me", { fingerprint: fp, localId: guestLocalId() });
    if (me.number != null) setMyNumber(me.number, me.displayMax);
    if (ui.coverCount && me.claimedCount != null) {
      ui.coverCount.textContent = `已有 ${me.claimedCount} 人领取号码`;
    }
  } catch {
    /* 先显示首页 */
  }
}

async function claimMyNumber() {
  if (ROLE !== "guest" || claiming || myNumber != null) return;
  if (!claimingOpen(state)) {
    toast("抽奖已开始，停止领号");
    syncClaimUi(state);
    return;
  }
  if (!isWeChatMobile()) {
    document.documentElement.classList.add("need-wechat");
    toast("请使用微信扫码参加抽奖");
    return;
  }
  claiming = true;
  if (ui.claimNumber) ui.claimNumber.disabled = true;
  if (ui.coverTicket) ui.coverTicket.classList.remove("hidden");
  const max = state?.config?.numberMax || 150;
  const timer = setInterval(() => {
    if (ui.coverTicketNum) ui.coverTicketNum.textContent = pad(1 + Math.floor(Math.random() * max), max);
  }, 70);
  try {
    await sfx.unlock();
    const fp = await deviceFingerprint();
    const result = await api("/api/claim", { fingerprint: fp, localId: guestLocalId() });
    clearInterval(timer);
    setMyNumber(result.number, result.displayMax);
    sfx.playClip(sfx.clips.ding, { volume: 0.95 });
    if (result.already) toast("这个微信已经领过号码");
  } catch (err) {
    clearInterval(timer);
    toast(err.message);
    if (ui.claimNumber) ui.claimNumber.disabled = false;
    if (myNumber == null && ui.coverTicket) ui.coverTicket.classList.add("hidden");
  } finally {
    claiming = false;
  }
}

async function handleAction(act) {
  if (ROLE !== "host") return;
  if (busy || rolling) return;
  try {
    setBusy(true);
    if (act === "start") {
      await sfx.unlock();
      const next = await api("/api/start", {});
      if (!wsLive) applyState(next);
      return;
    }
    if (act === "draw") {
      await sfx.unlock();
      const next = await api("/api/draw", {});
      await enqueueDraw(next.justDrawn, next);
      return;
    }
    if (act === "reveal") {
      await sfx.unlock();
      const next = await api("/api/reveal", {});
      if (!wsLive) {
        applyState(next, { showReveal: true });
        sfx.fanfare();
      }
      return;
    }
    if (act === "continue") {
      hideReveal();
      const next = await api("/api/continue", {});
      if (!wsLive) applyState(next);
      return;
    }
    if (act === "reset") {
      if (!confirm("确定清空所有已抽号码并重新开始？奖项配置会保留。")) return;
      const next = await api("/api/reset", {});
      playedDraws.clear();
      if (!wsLive) applyState(next);
    }
  } catch (err) {
    toast(err.message);
    try { applyState(await api("/api/state")); } catch { /* ignore */ }
  } finally {
    setBusy(false);
  }
}

ui.actions.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (btn) handleAction(btn.dataset.act);
});
ui.revealContinue.addEventListener("click", () => handleAction("continue"));

window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" && e.code !== "Enter") return;
  if (e.target.matches("input, textarea, select")) return;
  e.preventDefault();
  if (coverOpen()) {
    if (ROLE === "guest") {
      if (myNumber == null && claimingOpen(state)) claimMyNumber();
      else enterLottery();
      return;
    }
    enterLottery();
    return;
  }
  if (ROLE !== "host") return;
  if (!ui.hitOverlay.classList.contains("hidden")) return;
  const btn = ui.revealOverlay.classList.contains("hidden")
    ? ui.actions.querySelector("button")
    : ui.revealContinue;
  if (btn) btn.click();
});

function openSettings() {
  if (!state) return;
  fillSettings(state);
  ui.settings.classList.remove("hidden");
  ui.scrim.classList.remove("hidden");
}
function closeSettings() {
  ui.settings.classList.add("hidden");
  ui.scrim.classList.add("hidden");
}
syncSoundButton();
if (ui.enterLottery) ui.enterLottery.addEventListener("click", () => enterLottery());
if (ui.claimNumber) ui.claimNumber.addEventListener("click", () => claimMyNumber());
if (ui.youWinClose) ui.youWinClose.addEventListener("click", () => ui.youWin.classList.add("hidden"));
if (ui.hostLogin) {
  ui.hostLogin.addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = String(new FormData(ui.hostLogin).get("password") || "");
    try {
      await api("/api/host/login", { password });
      ui.hostGate.classList.add("hidden");
      toast("控制台已解锁");
    } catch (err) {
      if (ui.hostGateErr) ui.hostGateErr.textContent = err.message;
      toast(err.message);
    }
  });
}
ui.toggleSound.addEventListener("click", async () => {
  sfx.enabled = !sfx.enabled;
  localStorage.setItem("lottery-sfx", sfx.enabled ? "on" : "off");
  syncSoundButton();
  if (sfx.enabled) {
    await sfx.unlock();
    sfx.playClip(sfx.clips.ding, { volume: 0.9 });
    toast("音乐已打开");
  } else {
    sfx.ready = false;
    sfx.stopAll();
    toast("音乐已关闭");
  }
});
$("openSettings").addEventListener("click", openSettings);
$("closeSettings").addEventListener("click", closeSettings);
$("scrim").addEventListener("click", closeSettings);

function fillSettings(s) {
  const form = ui.settingsForm;
  form.title.value = s.config.title;
  form.couple.value = s.config.couple;
  form.numberMin.value = s.config.numberMin;
  form.numberMax.value = s.config.numberMax;
  form.excluded.value = (s.config.excluded || []).join(", ");
  editLevels = s.levels.map((l) => ({ ...l }));
  editPrizes = s.prizes.map((p) => ({ ...p }));
  renderPrizeEditor();
  syncSettingsLock();
}

function syncSettingsLock() {
  const locked = Boolean(state && (state.session.started || state.draws.length));
  for (const el of ui.settingsForm.querySelectorAll("input, select, button#saveSettings, button#addLevel")) {
    if (el.id === "resetDraws" || el.id === "resetAll" || el.id === "closeSettings") continue;
    el.disabled = locked;
  }
  const claimed = state && state.claimedCount ? state.claimedCount : 0;
  ui.settingsNote.textContent = locked
    ? `抽奖已开始。已领取 ${claimed} 个号码。如需改奖项，请先重置抽奖记录。`
    : `保存后立即生效。宾客在首页领号，超过设定人数会自动顺延。当前已领取 ${claimed} 人。`;
  ui.prizeEditor.style.pointerEvents = locked ? "none" : "";
  ui.prizeEditor.style.opacity = locked ? "0.55" : "";
}

function renderPrizeEditor() {
  ui.prizeEditor.innerHTML = editLevels.map((level) => {
    const prizes = editPrizes.filter((p) => p.levelId === level.id);
    const rows = prizes.map((p) => `
      <div class="prize-block" data-prize="${p.id}">
        <div class="prize-row">
          <input value="${escapeAttr(p.name)}" data-field="name" placeholder="奖品名称" />
          <input type="number" min="1" max="99" value="${p.count}" data-field="count" />
          <button class="ghost" type="button" data-del-prize="${p.id}">删除</button>
        </div>
        <input value="${escapeAttr(p.meaning || "")}" data-field="meaning" placeholder="寓意，例如：温情常伴，热度不减" />
      </div>
    `).join("");
    return `
      <section class="level-editor" data-level="${level.id}">
        <header>
          <input value="${escapeAttr(level.name)}" data-field="levelName" />
          <button class="ghost" type="button" data-add-prize="${level.id}">添加</button>
          ${editLevels.length > 1 ? `<button class="ghost" type="button" data-del-level="${level.id}">删除</button>` : ""}
        </header>
        ${rows || '<p class="tiny">该等级暂无奖品，抽奖时会跳过</p>'}
      </section>
    `;
  }).join("");
}

function escapeAttr(value) {
  return String(value).replace(/"/g, "&quot;");
}

ui.prizeEditor.addEventListener("input", (e) => {
  const levelBox = e.target.closest("[data-level]");
  const prizeBox = e.target.closest("[data-prize]");
  if (prizeBox) {
    const prize = editPrizes.find((p) => p.id === prizeBox.dataset.prize);
    if (!prize) return;
    if (e.target.dataset.field === "name") prize.name = e.target.value;
    if (e.target.dataset.field === "count") prize.count = Number(e.target.value || 1);
    if (e.target.dataset.field === "meaning") prize.meaning = e.target.value;
  } else if (levelBox && e.target.dataset.field === "levelName") {
    const level = editLevels.find((l) => l.id === levelBox.dataset.level);
    if (level) level.name = e.target.value;
  }
});

ui.prizeEditor.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add-prize]");
  const delP = e.target.closest("[data-del-prize]");
  const delL = e.target.closest("[data-del-level]");
  if (add) {
    editPrizes.push({
      id: `p_${Math.random().toString(16).slice(2, 8)}`,
      levelId: add.dataset.addPrize,
      name: "新奖品",
      count: 1,
      meaning: "百年好合，喜乐安康",
    });
    renderPrizeEditor();
  }
  if (delP) {
    editPrizes = editPrizes.filter((p) => p.id !== delP.dataset.delPrize);
    renderPrizeEditor();
  }
  if (delL) {
    const id = delL.dataset.delLevel;
    editLevels = editLevels.filter((l) => l.id !== id);
    editPrizes = editPrizes.filter((p) => p.levelId !== id);
    renderPrizeEditor();
  }
});

$("addLevel").addEventListener("click", () => {
  const id = `lv_${Math.random().toString(16).slice(2, 8)}`;
  editLevels.push({ id, name: "新奖项" });
  renderPrizeEditor();
});

ui.settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = ui.settingsForm;
  const excluded = String(form.excluded.value || "")
    .split(/[,，\s]+/)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
  try {
    const next = await api("/api/setup", {
      config: {
        title: form.title.value,
        couple: form.couple.value,
        numberMin: Number(form.numberMin.value),
        numberMax: Number(form.numberMax.value),
        excluded,
      },
      levels: editLevels,
      prizes: editPrizes,
    });
    applyState(next);
    toast("配置已保存");
    closeSettings();
  } catch (err) {
    toast(err.message);
  }
});

$("resetDraws").addEventListener("click", async () => {
  if (!confirm("清空全部已抽号码，保留当前奖项和号码区间？")) return;
  try {
    applyState(await api("/api/reset", {}));
    fillSettings(state);
    toast("抽奖记录已重置");
  } catch (err) {
    toast(err.message);
  }
});

$("resetAll").addEventListener("click", async () => {
  if (!confirm("恢复默认奖项（三等奖到特等奖）并清空抽奖记录和已领号码？")) return;
  try {
    applyState(await api("/api/reset", { defaults: true }));
    playedDraws.clear();
    fillSettings(state);
    toast("已恢复默认配置");
  } catch (err) {
    toast(err.message);
  }
});

const resetGuestsBtn = $("resetGuests");
if (resetGuestsBtn) {
  resetGuestsBtn.addEventListener("click", async () => {
    if (!confirm("清空全部宾客已领号码？抽奖记录也会一并清空。")) return;
    try {
      applyState(await api("/api/reset", { guests: true }));
      playedDraws.clear();
      fillSettings(state);
      toast("已清空已领号码");
    } catch (err) {
      toast(err.message);
    }
  });
}

const releaseHostBtn = $("releaseHost");
if (releaseHostBtn) {
  releaseHostBtn.addEventListener("click", async () => {
    if (!confirm("释放控制台后，其他设备可以用密码重新进入。确定吗？")) return;
    try {
      await api("/api/host/release", {});
      location.reload();
    } catch (err) {
      toast(err.message);
    }
  });
}

function sparkles() {
  const canvas = $("sparkles");
  const ctx = canvas.getContext("2d");
  const dots = [];
  function resize() {
    const w = Math.max(1, canvas.clientWidth || innerWidth);
    const h = Math.max(1, canvas.clientHeight || innerHeight);
    canvas.width = w;
    canvas.height = h;
  }
  function spawn() {
    dots.push({
      x: Math.random() * canvas.width,
      y: canvas.height + 8,
      r: Math.random() * 2 + 0.6,
      a: Math.random() * 0.55 + 0.25,
      s: Math.random() * 0.55 + 0.18,
    });
  }
  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (dots.length < 90) spawn();
    for (const d of dots) {
      d.y -= d.s;
      d.a -= 0.0012;
      ctx.fillStyle = `rgba(255,213,106,${Math.max(d.a, 0)})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = dots.length - 1; i >= 0; i--) {
      if (dots[i].y < -4 || dots[i].a <= 0) dots.splice(i, 1);
    }
    ctx.fillStyle = "rgba(255,213,106,0.95)";
    for (let i = confettiBits.length - 1; i >= 0; i--) {
      const b = confettiBits[i];
      b.x += b.vx;
      b.y += b.vy;
      b.vy += 0.22;
      b.life -= 1;
      ctx.fillRect(b.x, b.y, 4, 8);
      if (b.life <= 0) confettiBits.splice(i, 1);
    }
    requestAnimationFrame(tick);
  }
  addEventListener("resize", resize);
  resize();
  tick();
}

function burstConfetti() {
  const canvas = $("sparkles");
  for (let i = 0; i < 100; i++) {
    confettiBits.push({
      x: canvas.width / 2,
      y: canvas.height * 0.38,
      vx: (Math.random() - 0.5) * 16,
      vy: Math.random() * -11 - 4,
      life: 70 + Math.random() * 30,
    });
  }
}

sparkles();

async function bootHost() {
  if (ROLE !== "host" || !ui.hostGate) return;
  try {
    const session = await api("/api/host/session");
    if (session.ok) {
      ui.hostGate.classList.add("hidden");
      return;
    }
    ui.hostGate.classList.remove("hidden");
    if (session.locked && ui.hostGateErr) {
      ui.hostGateErr.textContent = "控制台已被占用，无法进入";
    }
  } catch (err) {
    if (ui.hostGateErr) ui.hostGateErr.textContent = err.message;
  }
}

async function boot() {
  await bootHost();
  if (ROLE === "guest") await restoreGuest();
  connectWs();
  await refresh();
}

boot().catch((err) => toast(err.message));
setInterval(() => {
  if (!wsLive && !busy && !rolling && document.visibilityState === "visible") {
    refresh().catch(() => {});
  }
}, 2500);
