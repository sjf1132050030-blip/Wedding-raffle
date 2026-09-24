const $ = (id) => document.getElementById(id);
const ROLE = window.LOTTERY_ROLE === "host" || window.LOTTERY_ROLE === "control"
  ? "control"
  : window.LOTTERY_ROLE === "screen"
    ? "screen"
    : "guest";
const CAN_CONTROL = ROLE === "control";

function onEl(el, ev, fn) {
  if (el) el.addEventListener(ev, fn);
}

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
  shareQr: $("shareQr"),
  shareQrCaption: $("shareQrCaption"),
  claimedList: $("claimedList"),
  claimedSummary: $("claimedSummary"),
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

const DEFAULT_AUDIO_CDN = Array.isArray(window.LOTTERY_AUDIO_CDN)
  ? window.LOTTERY_AUDIO_CDN
  : (window.LOTTERY_AUDIO_CDN
    ? [window.LOTTERY_AUDIO_CDN]
    : [
      "https://cdn.jsdmirror.com/gh/sjf1132050030-blip/Wedding-raffle@main/public",
      "https://cdn.jsdelivr.net/gh/sjf1132050030-blip/Wedding-raffle@main/public",
    ]);

const BGM_TRACKS = [
  { file: "bgm-carefree.mp3", volume: 0.42 },
  { file: "bgm-canon.mp3", volume: 0.38 },
  { file: "bgm-story.mp3", volume: 0.42 },
  { file: "bgm-lemon.mp3", volume: 0.4 },
];

const SFX_CLIP_DEFS = {
  roll: { file: "roll.mp3", volume: 0.9 },
  drum: { file: "drumroll.mp3", volume: 0.58 },
  hit: { file: "hit.mp3", volume: 1 },
  ding: { file: "ding.mp3", volume: 0.95 },
  win: { file: "win.mp3", volume: 0.96 },
  fanfare: { file: "fanfare.mp3", volume: 0.96 },
  applause: { file: "applause.mp3", volume: 0.84 },
};

function joinAudioUrl(base, file) {
  const name = String(file || "").replace(/^\/+/, "");
  const b = String(base || "").replace(/\/$/, "");
  if (!b) return `/audio/${name}`;
  if (/\/audio$/i.test(b)) return `${b}/${name}`;
  return `${b}/audio/${name}`;
}

function normalizeAudioCdn(bases) {
  const list = bases == null ? DEFAULT_AUDIO_CDN : bases;
  const arr = Array.isArray(list) ? list : [list];
  const out = [];
  for (const item of arr) {
    const b = String(item || "").trim().replace(/\/$/, "");
    if (b && out.indexOf(b) < 0) out.push(b);
  }
  return out;
}

function audioUrlsFor(file) {
  const urls = [];
  if (sfx.base) urls.push(joinAudioUrl(sfx.base, file));
  const local = joinAudioUrl("", file);
  if (urls.indexOf(local) < 0) urls.push(local);
  return urls;
}

function bindAudioSources(el, file) {
  el._audioFile = file;
  el._audioUrlIndex = 0;
  if (!el._audioFallbackBound) {
    el._audioFallbackBound = true;
    el.addEventListener("error", () => {
      const urls = audioUrlsFor(el._audioFile);
      if (el._audioUrlIndex + 1 >= urls.length) return;
      el._audioUrlIndex += 1;
      el.src = urls[el._audioUrlIndex];
      try { el.load(); } catch { /* ignore */ }
      const wantPlay = sfx.bgm && el === sfx.bgm.el && sfx.bgm.wanted && sfx.live() && !rolling;
      if (wantPlay) {
        const p = el.play();
        if (p && p.catch) p.catch(() => {});
      }
    });
  }
  const urls = audioUrlsFor(file);
  el.src = urls[0] || "";
  return el;
}

function probeAudioUrl(url, timeoutMs) {
  return new Promise((resolve) => {
    const a = new Audio();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        a.removeAttribute("src");
        a.load();
      } catch { /* ignore */ }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    a.addEventListener("error", () => finish(false));
    a.addEventListener("canplay", () => finish(true));
    a.preload = "auto";
    try {
      a.src = url;
    } catch {
      finish(false);
    }
  });
}

function firstOk(promises) {
  return new Promise((resolve, reject) => {
    const n = promises.length;
    if (!n) {
      reject(new Error("empty"));
      return;
    }
    let failed = 0;
    let settled = false;
    for (const p of promises) {
      Promise.resolve(p).then((value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      }, () => {
        failed += 1;
        if (!settled && failed >= n) reject(new Error("all failed"));
      });
    }
  });
}

async function pickAudioBase(bases, timeoutMs = 1200) {
  const list = normalizeAudioCdn(bases);
  if (!list.length) return "";
  try {
    return await firstOk(list.map(async (base) => {
      const ok = await probeAudioUrl(joinAudioUrl(base, "ding.mp3"), timeoutMs);
      if (!ok) throw new Error("cdn miss");
      return base;
    }));
  } catch {
    return "";
  }
}

function makeClip(file, volume = 1) {
  const a = new Audio();
  a.preload = "none";
  a.volume = volume;
  a.preservesPitch = true;
  a.webkitPreservesPitch = true;
  bindAudioSources(a, file);
  return a;
}

const sfx = {
  enabled: ROLE === "control" ? false : localStorage.getItem("lottery-sfx") !== "off",
  ready: false,
  clips: {},
  base: "",
  _baseKey: null,
  _baseGen: 0,
  _basePromise: null,
  bgm: {
    tracks: BGM_TRACKS.map((t) => ({ file: t.file, volume: t.volume })),
    index: 0,
    wanted: false,
    el: null,
    resumeTimer: 0,
  },

  prepare(bases) {
    if (ROLE === "control") {
      this.base = "";
      this._baseKey = "";
      this._basePromise = Promise.resolve("");
      return this._basePromise;
    }
    const list = normalizeAudioCdn(bases == null ? DEFAULT_AUDIO_CDN : bases);
    const key = list.join("|");
    if (this._basePromise && this._baseKey === key) return this._basePromise;
    this._baseKey = key;
    const gen = ++this._baseGen;
    this._basePromise = pickAudioBase(list).then((base) => {
      if (gen !== this._baseGen) return this.base;
      this.base = base;
      return base;
    });
    return this._basePromise;
  },

  init() {
    if (this.clips.roll) return;
    this.clips = {};
    for (const [name, def] of Object.entries(SFX_CLIP_DEFS)) {
      this.clips[name] = makeClip(def.file, def.volume);
    }
    const first = this.bgm.tracks[0];
    this.bgm.el = makeClip(first.file, first.volume);
    this.bgm.el.addEventListener("ended", () => this.bgmNext());
    this.bgm.el.addEventListener("timeupdate", () => this.maybePreloadNextBgm());
  },

  async unlock() {
    if (!this.enabled) return;
    if (!this._basePromise) this.prepare();
    try { await this._basePromise; } catch { /* 用自己网站上的音频 */ }
    this.init();
    if (this.ready) return;
    const clips = [...Object.values(this.clips), this.bgm.el].filter(Boolean);
    await Promise.all(clips.map(async (a) => {
      try {
        a.muted = true;
        a.preload = "auto";
        await Promise.race([
          a.play().catch(() => {}),
          new Promise((r) => setTimeout(r, 400)),
        ]);
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

  pauseBgm() {
    clearTimeout(this.bgm.resumeTimer);
    const a = this.bgm.el;
    if (!a) return;
    try { a.pause(); } catch { /* ignore */ }
  },

  maybePreloadNextBgm() {
    const a = this.bgm.el;
    if (!a || !a.duration || !isFinite(a.duration)) return;
    if (a.currentTime < Math.max(15, a.duration - 30)) return;
    this.preloadNextBgm();
  },

  preloadNextBgm() {
    const n = this.bgm.tracks;
    if (!n.length) return;
    const t = n[(this.bgm.index + 1) % n.length];
    if (!this._bgmPreload) this._bgmPreload = new Audio();
    this._bgmPreload.preload = "auto";
    if (this._bgmPreload._audioFile === t.file && this._bgmPreload.src) return;
    bindAudioSources(this._bgmPreload, t.file);
  },

  bgmNext() {
    if (!this.bgm.tracks.length) return;
    this.bgm.index = (this.bgm.index + 1) % this.bgm.tracks.length;
    const t = this.bgm.tracks[this.bgm.index];
    const a = this.bgm.el;
    if (!a) return;
    a.volume = t.volume;
    a.preload = "auto";
    bindAudioSources(a, t.file);
    try { a.load(); } catch { /* ignore */ }
    if (this.bgm.wanted && this.live() && !rolling) this.resumeBgm();
  },

  resumeBgm() {
    if (!this.live() || !this.bgm.wanted || rolling) return;
    const a = this.bgm.el;
    const t = this.bgm.tracks[this.bgm.index];
    if (!a || !t) return;
    if (!a.paused && !a.ended) return;
    try {
      a.loop = false;
      a.volume = t.volume;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch { /* ignore */ }
  },

  scheduleBgmResume(ms = 1200) {
    clearTimeout(this.bgm.resumeTimer);
    this.bgm.resumeTimer = setTimeout(() => this.resumeBgm(), ms);
  },

  startBgm() {
    if (!this.live()) return;
    this.bgm.wanted = true;
    this.resumeBgm();
  },

  stopBgm() {
    this.bgm.wanted = false;
    this.pauseBgm();
  },

  tick() {},

  startRoll() {
    if (!this.live()) return;
    this.pauseBgm();
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
    this.pauseBgm();
    this.stopRoll();
    this.playClip(this.clips.ding, { volume: 0.95 });
    this.playClip(this.clips.hit, { volume: 1 });
  },

  win() {
    if (!this.live()) return;
    this.pauseBgm();
    this.playClip(this.clips.win, { volume: 0.96 });
  },

  fanfare() {
    if (!this.live()) return;
    this.pauseBgm();
    this.stopAll(["fanfare", "applause"]);
    this.playClip(this.clips.fanfare, { volume: 0.96 });
    this.playClip(this.clips.applause, { volume: 0.84 });
    this.scheduleBgmResume(10800);
  },

  intro() {
    this.startBgm();
  },
};

if (ROLE !== "control") sfx.prepare();

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
  if (!ui.hitOverlay || !ui.hitNumber || !ui.hitSeal) return;
  const max = displayMaxOf(state);
  ui.hitNumber.textContent = pad(number, max);
  ui.hitSeal.classList.remove("out");
  ui.hitSeal.style.animation = "none";
  ui.hitOverlay.classList.remove("hidden");
  void ui.hitSeal.offsetWidth;
  ui.hitSeal.style.animation = "";
}

async function hideHitNumber() {
  if (!ui.hitOverlay || !ui.hitSeal) return;
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

function guestJoinUrl(s) {
  return (s && s.guestUrl) || `${location.protocol}//${location.host}/`;
}

function fillQrImages(s) {
  const url = guestJoinUrl(s);
  for (const el of document.querySelectorAll("[data-qr-url]")) el.textContent = url;
  for (const img of document.querySelectorAll("[data-qr-img]")) {
    const to = img.dataset.qrTo || "guest";
    const src = to === "guest" ? "/api/qr.svg" : `/api/qr.svg?to=${encodeURIComponent(to)}`;
    const key = `${to}:${url}`;
    if (img.dataset.ready === key) continue;
    img.dataset.ready = key;
    img.src = src;
  }
}

function renderGuestQr(s) {
  fillQrImages(s);
  const open = claimingOpen(s);
  const showHostQr = ROLE === "screen" || CAN_CONTROL;
  if (ui.coverQr) ui.coverQr.classList.toggle("hidden", !showHostQr || !open);
  if (ui.hostQrFloat) ui.hostQrFloat.classList.toggle("hidden", !showHostQr || !open || coverOpen());
  if (showHostQr && ui.claimClosed) ui.claimClosed.classList.toggle("hidden", open);
  if (ui.shareQrCaption) {
    ui.shareQrCaption.textContent = open ? "微信扫码领取幸运号码" : "微信扫码打开抽奖页面";
  }
}

function openShareQr() {
  fillQrImages(state);
  if (ui.shareQrCaption) {
    ui.shareQrCaption.textContent = claimingOpen(state) ? "微信扫码领取幸运号码" : "微信扫码打开抽奖页面";
  }
  if (ui.shareQr) ui.shareQr.classList.remove("hidden");
}

function closeShareQr() {
  if (ui.shareQr) ui.shareQr.classList.add("hidden");
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

let coverLeaving = false;
async function enterLottery() {
  if (coverLeaving || !coverOpen()) return;
  coverLeaving = true;
  await sfx.unlock();
  if (!ui.cover || ui.cover.classList.contains("hidden")) return;
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
  if (!ui.toast) {
    console.log(message);
    return;
  }
  ui.toast.textContent = message;
  ui.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.add("hidden"), 2400);
}

function setBusy(value) {
  busy = value;
  if (!ui.actions) return;
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
  if (!ui.drawnStrip) return;
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

function renderClaimed(s) {
  const nums = Array.isArray(s.claimedNumbers) ? s.claimedNumbers : [];
  const max = displayMaxOf(s);
  if (ui.claimedSummary) ui.claimedSummary.textContent = `已领号码 ${nums.length}`;
  if (!ui.claimedList) return;
  ui.claimedList.innerHTML = nums.length
    ? nums.map((n) => `<span class="tag">${pad(n, max)}</span>`).join("")
    : '<span class="muted">暂无</span>';
}

function renderBoard(s) {
  if (!ui.boardList) return;
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
  if (!wall) return;
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
  if (!ui.xiWall || ui.xiWall.dataset.observed) return;
  ui.xiWall.dataset.observed = "1";
  const ro = new ResizeObserver(() => {
    const n = ui.xiWall.querySelectorAll(".xi-card").length;
    if (n) fitWall(n);
  });
  ro.observe(ui.xiWall);
}

function syncWall(s) {
  if (!ui.xiWall) return;
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

function setText(el, value) {
  if (el) el.textContent = value;
}

function maybeAutoEnterScreen(s) {
  if (ROLE !== "screen") return;
  if (!coverOpen()) return;
  if (s && (s.program === "quiz" || (s.session && (s.session.started || (s.session.phase && s.session.phase !== "idle"))))) {
    enterLottery().then(() => {
      if (!sfx.ready) toast("点击右上角开启音乐");
    });
  }
}

function renderStage(s) {
  document.title = s.config.title || "新婚快乐 幸运大抽奖";
  setText(ui.couple, s.config.couple);
  setText(ui.title, s.config.title);
  setText(ui.coverCouple, s.config.couple);
  const level = currentLevel(s);
  const phase = s.session.phase;
  const prize = s.currentPrize;
  const max = displayMaxOf(s);
  if (ui.coverCount) ui.coverCount.textContent = `已有 ${s.claimedCount || 0} 人领取号码`;
  renderGuestQr(s);
  renderClaimed(s);
  syncClaimUi(s);
  maybeAutoEnterScreen(s);

  if (rolling) {
    setText(ui.hint, "红包逐个闪过，好运降临…");
  } else if (phase === "idle") {
    setText(ui.eyebrow, "翻开红包 · 喜从天降");
    setText(ui.levelRibbon, level ? level.name : "准备开始");
    setText(ui.hint, CAN_CONTROL
      ? `已领取 ${s.claimedCount || 0} 个号码（设定 ${s.config.numberMin}–${s.config.numberMax}，超出顺延）${s.claimedCount ? "，可以开始" : "，等待宾客领号"}`
      : "请等待现场开始抽奖");
  } else if (phase === "level_done") {
    setText(ui.eyebrow, "本轮奖项已全部抽出");
    setText(ui.levelRibbon, `${level ? level.name : ""} 抽奖结束`);
    setText(ui.hint, s.nextLevel
      ? (CAN_CONTROL ? `点击开始抽取${s.nextLevel.name}` : `即将抽取${s.nextLevel.name}`)
      : "全部奖项已抽完");
  } else if (phase === "all_done") {
    setText(ui.eyebrow, "抽奖结束");
    setText(ui.levelRibbon, "恭喜各位幸运嘉宾");
    setText(ui.hint, "所有奖项已抽出，完整记录见右侧");
  } else {
    setText(ui.eyebrow, "当前正在抽取");
    setText(ui.levelRibbon, level ? level.name : "");
    if (prize) {
      setText(ui.hint, `本轮共 ${prize.count} 个红包，已翻开 ${prize.drawn} 个，翻齐后公布奖品`);
    } else {
      setText(ui.hint, "准备抽取");
    }
  }

  const batch = s.session.currentBatch || [];
  if (ui.batchRow) {
    ui.batchRow.innerHTML = batch.map((n) => `<span class="tag done">${pad(n, max)}</span>`).join("");
  }
  renderActions(s);
  if (!rolling) syncWall(s);
  renderQuiz(s);
}

function renderActions(s) {
  if (!ui.actions) return;
  if (!CAN_CONTROL) {
    ui.actions.innerHTML = ROLE === "guest"
      ? `<p class="tiny">现场同步中 · 已领取 ${s.claimedCount || 0} 个号码</p>`
      : "";
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
  if (!ui.revealOverlay) return;
  const max = displayMaxOf(state);
  if (ui.revealNumbers) {
    ui.revealNumbers.innerHTML = payload.numbers.map((n) => `<span>${pad(n, max)}</span>`).join("");
  }
  setText(ui.revealLevel, `获得 ${payload.levelName}`);
  setText(ui.revealPrize, payload.prizeName);
  setText(ui.revealMeaning, payload.meaning ? `寓意：${payload.meaning}` : "");
  const wasHidden = ui.revealOverlay.classList.contains("hidden");
  ui.revealOverlay.classList.remove("hidden");
  if (withConfetti && wasHidden) burstConfetti();
}

function hideReveal() {
  if (ui.revealOverlay) ui.revealOverlay.classList.add("hidden");
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
  noteQuizWinner(state);
  if (CAN_CONTROL && state && state.program === "quiz") refreshQuizManage();
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
  if (!ui.xiWall) {
    await presentWin(number, null);
    return;
  }
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
    setBusy(true);
    try {
      if (CAN_CONTROL || !ui.xiWall) {
        applyState(next || state, { skipStage: false });
        await sleep(2200);
      } else {
        await flashToWinner(number);
      }
    } finally {
      rolling = false;
      sfx.scheduleBgmResume(5200);
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
    if (me.quizMine) quizMine = me.quizMine;
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
    if (state && state.program === "quiz") enterLottery();
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
  if (!CAN_CONTROL) return;
  if (busy || rolling) return;
  try {
    setBusy(true);
    if (act === "start") {
      await sfx.unlock();
      applyState(await api("/api/start", {}));
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
      applyState(await api("/api/continue", {}));
      return;
    }
    if (act === "reset") {
      if (!confirm("确定清空所有已抽号码并重新开始？奖项配置会保留。")) return;
      playedDraws.clear();
      applyState(await api("/api/reset", {}));
    }
  } catch (err) {
    toast(err.message);
    try { applyState(await api("/api/state")); } catch { /* ignore */ }
  } finally {
    setBusy(false);
  }
}

onEl(ui.actions, "click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (btn) handleAction(btn.dataset.act);
});
onEl(ui.revealContinue, "click", () => handleAction("continue"));

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
  if (!CAN_CONTROL) return;
  if (state && state.program === "quiz") return;
  if (ui.hitOverlay && !ui.hitOverlay.classList.contains("hidden")) return;
  const revealOpen = ui.revealOverlay && !ui.revealOverlay.classList.contains("hidden");
  const btn = revealOpen
    ? ui.revealContinue
    : ui.actions && ui.actions.querySelector("button");
  if (btn) btn.click();
});

function openSettings() {
  if (!state || !ui.settings) return;
  fillSettings(state);
  ui.settings.classList.remove("hidden");
  if (ui.scrim) ui.scrim.classList.remove("hidden");
  loadQuizEditor();
}
function closeSettings() {
  if (ui.settings) ui.settings.classList.add("hidden");
  if (ui.scrim) ui.scrim.classList.add("hidden");
}
syncSoundButton();
onEl(ui.enterLottery, "click", () => enterLottery());
onEl(ui.claimNumber, "click", () => claimMyNumber());
onEl(ui.youWinClose, "click", () => ui.youWin.classList.add("hidden"));
onEl($("closeShareQr"), "click", closeShareQr);
onEl(ui.shareQr, "click", (e) => {
  if (e.target === ui.shareQr) closeShareQr();
});
for (const btn of document.querySelectorAll("[data-open-share]")) {
  btn.addEventListener("click", openShareQr);
}
if (ui.hostLogin) {
  ui.hostLogin.addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = String(new FormData(ui.hostLogin).get("password") || "");
    try {
      await api("/api/host/login", { password });
      ui.hostGate.classList.add("hidden");
      await refresh();
      if (state && state.program === "quiz") await refreshQuizManage();
      toast("控制台已解锁");
    } catch (err) {
      if (ui.hostGateErr) ui.hostGateErr.textContent = err.message;
      toast(err.message);
    }
  });
}
onEl(ui.toggleSound, "click", async () => {
  sfx.enabled = !sfx.enabled;
  localStorage.setItem("lottery-sfx", sfx.enabled ? "on" : "off");
  syncSoundButton();
  if (sfx.enabled) {
    await sfx.unlock();
    if (!coverOpen()) sfx.startBgm();
    else sfx.playClip(sfx.clips.ding, { volume: 0.9 });
    toast("音乐已打开");
  } else {
    sfx.ready = false;
    sfx.stopAll();
    sfx.stopBgm();
    toast("音乐已关闭");
  }
});
onEl($("openSettings"), "click", openSettings);
onEl($("closeSettings"), "click", closeSettings);
onEl($("scrim"), "click", closeSettings);

function fillSettings(s) {
  if (!ui.settingsForm) return;
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
  if (!ui.settingsForm) return;
  const locked = Boolean(state && (state.session.started || state.draws.length));
  for (const el of ui.settingsForm.querySelectorAll("input, select, button#saveSettings, button#addLevel")) {
    if (el.id === "resetDraws" || el.id === "resetAll" || el.id === "closeSettings") continue;
    el.disabled = locked;
  }
  const claimed = state && state.claimedCount ? state.claimedCount : 0;
  if (ui.settingsNote) {
    ui.settingsNote.textContent = locked
      ? `抽奖已开始。已领取 ${claimed} 个号码。如需改奖项，请先重置抽奖记录。`
      : `保存后立即生效。宾客在首页领号，超过设定人数会自动顺延。当前已领取 ${claimed} 人。`;
  }
  if (ui.prizeEditor) {
    ui.prizeEditor.style.pointerEvents = locked ? "none" : "";
    ui.prizeEditor.style.opacity = locked ? "0.55" : "";
  }
}

function renderPrizeEditor() {
  if (!ui.prizeEditor) return;
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

onEl(ui.prizeEditor, "input", (e) => {
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

onEl(ui.prizeEditor, "click", (e) => {
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

onEl($("addLevel"), "click", () => {
  const id = `lv_${Math.random().toString(16).slice(2, 8)}`;
  editLevels.push({ id, name: "新奖项" });
  renderPrizeEditor();
});

onEl(ui.settingsForm, "submit", async (e) => {
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

onEl($("resetDraws"), "click", async () => {
  if (!confirm("清空全部已抽号码，保留当前奖项和号码区间？")) return;
  try {
    applyState(await api("/api/reset", {}));
    fillSettings(state);
    toast("抽奖记录已重置");
  } catch (err) {
    toast(err.message);
  }
});

onEl($("resetAll"), "click", async () => {
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
    if (!confirm("退出后本机需要重新输入密码。其他已登录设备不受影响。确定吗？")) return;
    try {
      await api("/api/host/release", {});
      location.reload();
    } catch (err) {
      toast(err.message);
    }
  });
}

let quizMine = null;
let quizPicks = new Set();
let quizPickRound = "";
let quizViewKey = "";
let quizManage = null;
let quizManageReq = 0;
let quizSending = false;
let quizFanfareFor = "";
let quizFanfareReady = false;
let quizClock = { elapsedBefore: 0, runningSince: null, offset: 0 };

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatElapsed(ms) {
  const safe = Math.max(0, Number(ms) || 0);
  const totalCs = Math.round(safe / 10);
  const cs = totalCs % 100;
  const totalS = Math.floor(totalCs / 100);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60);
  const frac = String(cs).padStart(2, "0");
  if (m > 0) return `${m}分${String(s).padStart(2, "0")}.${frac}秒`;
  return `${s}.${frac}秒`;
}

function syncQuizClock(quiz) {
  const round = quiz && quiz.round;
  quizClock = {
    elapsedBefore: round ? Number(round.elapsedBefore) || 0 : 0,
    runningSince: round && round.status === "open" ? round.runningSince : null,
    offset: ((quiz && quiz.serverNow) || Date.now()) - Date.now(),
  };
}

function quizElapsedNow() {
  const base = quizClock.elapsedBefore || 0;
  if (!quizClock.runningSince) return base;
  return base + Math.max(0, Date.now() + quizClock.offset - quizClock.runningSince);
}

function updateQuizClocks() {
  const round = state && state.quiz && state.quiz.round;
  let text = "尚未开始计时";
  if (round && round.status === "open") text = formatElapsed(quizElapsedNow());
  else if (round && round.status === "closed") text = `用时 ${formatElapsed(quizElapsedNow())}`;
  for (const el of document.querySelectorAll("[data-quiz-clock]")) el.textContent = text;
  const count = round ? round.answerCount || 0 : 0;
  for (const el of document.querySelectorAll("[data-quiz-count]")) {
    el.textContent = round && round.status !== "reading" ? `已提交 ${count} 人` : "";
  }
}

function quizResultText(mine, quiz) {
  const choices = (mine.choices || []).join("、");
  const time = formatElapsed(mine.elapsedMs);
  const winner = quiz && quiz.winner;
  const winnerLine = winner
    ? `首位获奖是 ${pad(winner.number)} 号，用时 ${formatElapsed(winner.elapsedMs)}。`
    : "本题奖品还在等待下一位答对的宾客。";
  if (mine.result === "winner") {
    const prizeText = winner && winner.prize ? `奖品：${winner.prize}。` : "奖品在本题结束后公布。";
    return `恭喜你，第一个答对。你的选择 ${choices}，用时 ${time}。${prizeText}每人只能领一份竞答奖品。`;
  }
  if (mine.result === "late") {
    return `虽然答对了，但有人比你更先答对。${winnerLine}你的选择 ${choices}，用时 ${time}。`;
  }
  if (mine.result === "already_awarded") {
    const handed = winner && winner.number !== myNumber
      ? winnerLine
      : "这次默认无效，奖品留给下一位答对的宾客。";
    return `虽然答对了，但你已经领过竞答奖品。${handed}你的选择 ${choices}，用时 ${time}。`;
  }
  return `这次没答对。你的选择 ${choices}，用时 ${time}。`;
}

function noteQuizWinner(s) {
  if (ROLE !== "screen" || !s || s.program !== "quiz" || !s.quiz) return;
  const winner = s.quiz.winner;
  const key = winner ? `${winner.roundId}:${winner.number}` : "";
  if (quizFanfareReady && key && key !== quizFanfareFor) {
    sfx.fanfare();
    burstConfetti();
  }
  quizFanfareFor = key;
  quizFanfareReady = true;
}

function renderQuiz(s) {
  const quizMode = Boolean(s && s.program === "quiz");
  document.body.classList.toggle("mode-quiz", quizMode);
  const note = $("programNote");
  if (note) {
    note.textContent = quizMode
      ? "当前环节：有奖竞答。抽奖进度已保留，回到抽奖会从上次继续。"
      : "当前环节：抽奖。进入有奖竞答不会清空已抽号码。";
  }
  if (!quizMode) return;
  syncQuizClock(s.quiz);
  if (ROLE === "guest" && myNumber != null) {
    enterLottery();
  }
  if (CAN_CONTROL) {
    renderQuizLive();
    updateQuizClocks();
    return;
  }
  const round = s.quiz && s.quiz.round;
  if (quizMine && round && quizMine.roundId !== round.id) quizMine = null;
  if (round && quizPickRound !== round.id) {
    quizPickRound = round.id;
    quizPicks = new Set();
  }
  const key = quizViewSignature(s);
  if (key !== quizViewKey) {
    quizViewKey = key;
    paintQuizStage(s);
  }
  updateQuizClocks();
}

function quizProgressKey(s) {
  const progress = s && s.quiz && s.quiz.progress;
  return progress ? `${progress.current}/${progress.total}` : "";
}

function quizKicker(quiz) {
  const progress = quiz && quiz.progress;
  if (progress && progress.current && progress.total) return `第 ${progress.current} / ${progress.total} 题`;
  return "有奖竞答";
}

function quizViewSignature(s) {
  const round = s.quiz && s.quiz.round;
  const progress = quizProgressKey(s);
  if (!round) return `none~${progress}`;
  const mine = quizMine && quizMine.roundId === round.id ? quizMine : null;
  const winner = s.quiz.winner;
  const opt = (round.options || []).map((o) => `${o.key}:${o.text}:${o.correct ? 1 : 0}`).join("|");
  return [
    progress,
    round.id,
    round.status,
    round.question,
    round.prize,
    opt,
    mine ? `${mine.result}:${mine.choices.join("")}:${mine.elapsedMs}` : "",
    winner ? `${winner.number}:${winner.elapsedMs}` : "",
    myNumber == null ? "" : myNumber,
  ].join("~");
}

function paintQuizStage(s) {
  const box = $("quizStage");
  if (!box) return;
  const quiz = s.quiz || {};
  const round = quiz.round;
  const kicker = `<p class="quiz-kicker">${escapeHtml(quizKicker(quiz))}</p>`;
  if (!round) {
    box.innerHTML = `${kicker}<p class="quiz-question">等待主持人出题</p>`;
    return;
  }
  const mine = quizMine && quizMine.roundId === round.id ? quizMine : null;
  const prize = round.status === "closed" && round.prize
    ? `<p class="quiz-prize">奖品：${escapeHtml(round.prize)}</p>`
    : "";
  const question = `<p class="quiz-question">${escapeHtml(round.question || "")}</p>`;
  if (round.status === "reading") {
    box.innerHTML = `<div class="quiz-main">${kicker}${question}<p class="hint">请听主持人读题，选项稍后放出</p></div>`;
    return;
  }
  const locked = Boolean(mine) || round.status !== "open" || myNumber == null;
  const selected = new Set(mine ? mine.choices : quizPicks);
  const options = (round.options || []).map((option) => {
    const on = selected.has(option.key) ? " on" : "";
    const correct = option.correct ? " correct" : "";
    return `<button class="quiz-choice${on}${correct}" type="button" data-quiz-choice="${option.key}" ${locked ? "disabled" : ""}>
      <span class="quiz-key">${option.key}</span><span>${escapeHtml(option.text)}</span>
    </button>`;
  }).join("");
  const clock = round.status === "open" ? `<p class="quiz-timer" data-quiz-clock>${formatElapsed(quizElapsedNow())}</p>` : "";
  let extra = "";
  if (ROLE === "guest" && myNumber == null) {
    extra = `<p class="hint">请先领取幸运号码后再答题</p>`;
  } else if (ROLE === "guest" && round.status === "open" && !mine) {
    extra = `<p class="tiny">可以多选。必须选中全部正确答案，多选或漏选都算没答对。</p>
      <button class="btn gold quiz-submit" type="button" data-quiz-submit>提交答案</button>`;
  }
  if (mine && ROLE === "guest") {
    extra += `<div class="quiz-result${mine.result === "winner" ? " win" : ""}">${escapeHtml(quizResultText(mine, quiz))}</div>`;
  }
  if (ROLE === "screen") {
    if (quiz.winner) {
      const prizeText = round.status === "closed" && quiz.winner.prize ? ` · ${escapeHtml(quiz.winner.prize)}` : "";
      extra += `<div class="quiz-winner">首位答对 ${pad(quiz.winner.number)} 号 · ${formatElapsed(quiz.winner.elapsedMs)}${prizeText}</div>`;
    } else if (round.status === "open") {
      extra += `<p class="hint">等待第一位答对的宾客</p>`;
    } else {
      extra += `<p class="hint">本题已结束</p>`;
    }
    extra += `<p class="tiny" data-quiz-count></p>`;
  }
  const wonBefore = (quiz.awards || []).find((item) => item.number === myNumber);
  const owned = wonBefore && ROLE === "guest"
    ? `<p class="tiny">你已获得过竞答奖品${wonBefore.prize ? `：${escapeHtml(wonBefore.prize)}` : ""}。再第一名答对也不会重复领奖。</p>`
    : "";
  box.innerHTML = `<div class="quiz-main">${kicker}${prize}${question}${clock}<div class="quiz-options">${options}</div></div><div class="quiz-foot">${extra}${owned}</div>`;
}

function renderQuizLive() {
  const round = state && state.quiz && state.quiz.round;
  const hint = $("quizPhaseHint");
  const release = $("quizRelease");
  const closeBtn = $("quizClose");
  const publish = $("quizPublish");
  const items = (quizManage && quizManage.items) || [];
  const playedIds = (quizManage && quizManage.played) || [];
  const played = new Set(playedIds);
  const nextItem = items.find((item) => !played.has(item.id)) || null;
  const nextIndex = nextItem ? items.findIndex((item) => item.id === nextItem.id) + 1 : 0;
  if (release) release.disabled = !round || round.status !== "reading";
  if (closeBtn) closeBtn.disabled = !round || round.status === "closed";
  if (publish) {
    const lastLive = Boolean(round && round.status !== "closed" && !nextItem && items.length);
    publish.disabled = Boolean(quizManage) && !nextItem;
    publish.textContent = !quizManage
      ? "公布题目"
      : nextItem
        ? `公布第 ${nextIndex} 题`
        : lastLive
          ? "本题是最后一题"
          : (items.length ? "题目已全部出完" : "请先配置题目");
  }
  if (hint) {
    if (!quizManage) hint.textContent = "正在读取已经配好的题目。";
    else if (!items.length) hint.textContent = "还没有题目。打开「抽奖设置」，把全部竞答题目按顺序配好并保存。";
    else if (!round) hint.textContent = "题目已备好。公布后嘉宾只能看到题目，还不能选择。";
    else if (round.status === "reading") hint.textContent = "题目已公布。念完后点「放出选项」，嘉宾才能作答，计时从这时开始。";
    else if (round.status === "open") hint.textContent = "选项已放出，正在计时。奖品给第一位答对、且还没领过竞答奖的宾客。";
    else if (nextItem) hint.textContent = "本题已结束。点公布下一题，继续按设定顺序出题。";
    else hint.textContent = "全部题目已出完。可以回到抽奖。";
  }
  renderQuizNow(round, items, played, nextItem);
  const live = $("quizLive");
  if (!live) return;
  const managedRound = quizManage && quizManage.round;
  const same = managedRound && round && managedRound.id === round.id;
  const answers = same ? (managedRound.answers || []).join("、") : "";
  const rows = same
    ? (quizManage.submissions || []).map((item) => {
        const label = item.result === "winner"
          ? "首位答对，获得奖品"
          : item.result === "late"
            ? "答对，但有人更快"
            : item.result === "already_awarded"
              ? "答对，但已领过奖，本题无效"
              : "未答对";
        return `<div class="quiz-live-row">${pad(item.number)} 号 · ${escapeHtml((item.choices || []).join("、"))} · ${formatElapsed(item.elapsedMs)} · ${label}</div>`;
      }).join("")
    : "";
  const winner = state.quiz && state.quiz.winner;
  live.innerHTML = `${answers ? `<p class="tiny">正确答案：${escapeHtml(answers)}</p>` : ""}
    ${winner ? `<div class="quiz-winner">获奖 ${pad(winner.number)} 号 · ${formatElapsed(winner.elapsedMs)} · ${escapeHtml(winner.prize || "")}</div>` : ""}
    ${rows || `<p class="tiny">${round && round.status !== "reading" ? "还没有人提交" : "放出选项后，这里显示宾客的选择和时间"}</p>`}`;
}

async function refreshQuizManage() {
  if (!CAN_CONTROL || !state || state.program !== "quiz") {
    quizManage = null;
    return;
  }
  const seq = ++quizManageReq;
  try {
    const data = await api("/api/quiz/manage");
    if (seq !== quizManageReq) return;
    quizManage = data;
    renderQuizLive();
  } catch {
    /* 控制台未登录时忽略 */
  }
}

function renderQuizNow(round, items, played, nextItem) {
  const box = $("quizNow");
  if (!box) return;
  const managed = quizManage && quizManage.round;
  const same = Boolean(managed && round && managed.id === round.id);
  let heading = "";
  let question = "";
  let prize = "";
  let options = [];
  let answers = [];
  if (round && round.status !== "closed") {
    const index = same && managed.itemId
      ? items.findIndex((item) => item.id === managed.itemId) + 1
      : ((state.quiz.progress && state.quiz.progress.current) || 0);
    const total = items.length || (state.quiz.progress && state.quiz.progress.total) || 0;
    const phase = round.status === "reading" ? "读题中" : "作答中";
    heading = index && total ? `第 ${index} / ${total} 题 · ${phase}` : phase;
    question = round.question || "";
    prize = round.prize || "";
    options = same ? managed.options : (round.options || []);
    answers = same ? managed.answers : [];
  } else if (nextItem) {
    const index = items.findIndex((item) => item.id === nextItem.id) + 1;
    heading = `下一题 ${index} / ${items.length} · 还没公布`;
    question = nextItem.question || "";
    prize = nextItem.prize || "";
    options = nextItem.options || [];
    answers = nextItem.answers || [];
  } else if (items.length) {
    heading = "题目已全部出完";
    question = round ? round.question || "" : "";
    prize = round ? round.prize || "" : "";
    options = same ? managed.options : [];
    answers = same ? managed.answers : [];
  } else if (quizManage) {
    heading = "还没有题目";
    question = "打开「抽奖设置」，先把题目按顺序配好并保存。";
  } else {
    heading = "正在读取题目";
  }
  const answerSet = new Set(answers || []);
  const optionText = (options || []).map((option) => {
    const mark = answerSet.has(option.key) ? "（正确）" : "";
    return `${option.key}. ${option.text}${mark}`;
  }).join("\n");
  const plan = items.map((item, index) => {
    let label = "待公布";
    let cls = "";
    if (round && same && managed.itemId === item.id && round.status !== "closed") {
      label = round.status === "reading" ? "读题中" : "作答中";
      cls = "now";
    } else if (played.has(item.id)) {
      label = "已出过";
      cls = "done";
    } else if (nextItem && nextItem.id === item.id) {
      label = "下一题";
      cls = "now";
    }
    const brief = String(item.question || "").replace(/\s+/g, " ").slice(0, 28);
    return `<li class="${cls}">${index + 1}. ${escapeHtml(brief)} · ${escapeHtml(item.prize || "")} · ${label}</li>`;
  }).join("");
  box.innerHTML = `
    <div class="quiz-now">
      <p class="tiny">${escapeHtml(heading)}</p>
      ${question ? `<p class="quiz-now-question">${escapeHtml(question)}</p>` : ""}
      ${prize ? `<p class="tiny">奖品：${escapeHtml(prize)}</p>` : ""}
      ${optionText ? `<p class="quiz-now-options">${escapeHtml(optionText)}</p>` : ""}
    </div>
    ${plan ? `<ol class="quiz-plan">${plan}</ol>` : ""}
  `;
}

let editQuizItems = [];
let editQuizPlayed = new Set();
let quizEditorReady = false;
let quizEditorReq = 0;

function newQuizDraft() {
  return {
    id: `qi_${Math.random().toString(16).slice(2, 8)}`,
    question: "",
    prize: "",
    letters: ["A", "B", "C", "D", "E"].map((key) => ({
      key,
      on: key !== "E",
      text: "",
      correct: false,
    })),
  };
}

function quizItemToEditor(item) {
  const answers = new Set(item.answers || []);
  const byKey = new Map((item.options || []).map((option) => [option.key, option]));
  return {
    id: item.id,
    question: item.question || "",
    prize: item.prize || "",
    letters: ["A", "B", "C", "D", "E"].map((key) => ({
      key,
      on: byKey.has(key),
      text: byKey.has(key) ? byKey.get(key).text : "",
      correct: answers.has(key),
    })),
  };
}

function renderQuizEditor() {
  const box = $("quizEditor");
  if (!box) return;
  if (!editQuizItems.length) {
    box.innerHTML = `<p class="tiny">还没有题目。点下面的「添加题目」，按出场顺序加好后保存。</p>`;
    return;
  }
  box.innerHTML = editQuizItems.map((item, index) => {
    const played = editQuizPlayed.has(item.id);
    const disabled = played ? "disabled" : "";
    const prevPlayed = index > 0 && editQuizPlayed.has(editQuizItems[index - 1].id);
    const nextPlayed = index + 1 < editQuizItems.length && editQuizPlayed.has(editQuizItems[index + 1].id);
    const letters = item.letters.map((letter) => `
      <div class="quiz-opt-edit">
        <label><input type="checkbox" data-letter="${letter.key}" data-field="on" ${letter.on ? "checked" : ""} ${disabled} /> ${letter.key}</label>
        <input type="text" data-letter="${letter.key}" data-field="text" maxlength="80" value="${escapeAttr(letter.text)}" placeholder="选项${letter.key}" ${disabled} />
        <label><input type="checkbox" data-letter="${letter.key}" data-field="correct" ${letter.correct ? "checked" : ""} ${disabled} /> 正确</label>
      </div>
    `).join("");
    const tools = played
      ? `<p class="tiny">已出过，不能再改</p>`
      : `<div class="quiz-item-tools">
          <button class="ghost" type="button" data-quiz-up="${item.id}" ${index === 0 || prevPlayed ? "disabled" : ""}>上移</button>
          <button class="ghost" type="button" data-quiz-down="${item.id}" ${index === editQuizItems.length - 1 || nextPlayed ? "disabled" : ""}>下移</button>
          <button class="ghost" type="button" data-quiz-del="${item.id}">删除</button>
        </div>`;
    return `
      <section class="quiz-item-editor${played ? " is-played" : ""}" data-quiz-item="${item.id}">
        <div class="quiz-item-head">
          <strong>第 ${index + 1} 题</strong>
          ${played ? `<span class="tiny">已出题</span>` : ""}
        </div>
        <label>题目
          <textarea data-field="question" maxlength="200" rows="3" placeholder="主持人要念的题目" ${disabled}>${escapeHtml(item.question)}</textarea>
        </label>
        <label>奖品
          <input type="text" data-field="prize" maxlength="30" value="${escapeAttr(item.prize)}" placeholder="例如 红包" ${disabled} />
        </label>
        ${letters}
        <p class="tiny">勾选要出现的选项。标成正确的可以有多个，宾客必须全部选对。</p>
        ${tools}
      </section>
    `;
  }).join("");
}

async function loadQuizEditor() {
  if (!CAN_CONTROL || !$("quizEditor")) return;
  const seq = ++quizEditorReq;
  quizEditorReady = false;
  const saveBtn = $("saveQuizBank");
  if (saveBtn) saveBtn.disabled = true;
  try {
    const data = await api("/api/quiz/manage");
    if (seq !== quizEditorReq) return;
    editQuizItems = (data.items || []).map(quizItemToEditor);
    editQuizPlayed = new Set(data.played || []);
    quizEditorReady = true;
    if (saveBtn) saveBtn.disabled = false;
    renderQuizEditor();
  } catch (err) {
    if (seq === quizEditorReq) toast(err.message || "竞答题目没有读出来");
  }
}

function moveQuizItem(id, dir) {
  const index = editQuizItems.findIndex((item) => item.id === id);
  const next = index + dir;
  if (index < 0 || next < 0 || next >= editQuizItems.length) return;
  if (editQuizPlayed.has(id) || editQuizPlayed.has(editQuizItems[next].id)) return;
  const [item] = editQuizItems.splice(index, 1);
  editQuizItems.splice(next, 0, item);
  renderQuizEditor();
}

async function saveQuizBank() {
  if (!CAN_CONTROL) return;
  if (!quizEditorReady) {
    toast("题目还在读取，请稍后再保存");
    return;
  }
  const items = editQuizItems.map((item) => ({
    id: item.id,
    question: item.question.trim(),
    prize: item.prize.trim(),
    options: item.letters.filter((letter) => letter.on).map((letter) => ({
      key: letter.key,
      text: letter.text.trim(),
      correct: Boolean(letter.correct),
    })),
  }));
  try {
    applyState(await api("/api/quiz/bank", { items }));
    await loadQuizEditor();
    toast("竞答题目已保存");
  } catch (err) {
    toast(err.message);
  }
}

async function resetQuizProgress() {
  if (!CAN_CONTROL) return;
  if (!confirm("清空已出题目和答题记录？配好的题目会保留，下次从第一题重新开始。")) return;
  try {
    applyState(await api("/api/quiz/reset", {}));
    await loadQuizEditor();
    toast("竞答进度已清空，题目还在");
  } catch (err) {
    toast(err.message);
  }
}

async function setProgram(mode) {
  if (!CAN_CONTROL || busy) return;
  try {
    setBusy(true);
    applyState(await api("/api/program", { mode }));
    if (mode === "quiz") await refreshQuizManage();
    closeSettings();
    toast(mode === "quiz" ? "已进入有奖竞答，抽奖进度保留" : "已回到抽奖，从上次继续");
  } catch (err) {
    toast(err.message);
  } finally {
    setBusy(false);
  }
}

async function publishQuiz() {
  if (!CAN_CONTROL || busy) return;
  const round = state && state.quiz && state.quiz.round;
  if (round && round.status !== "closed") {
    if (!confirm("当前题目还没结束。公布下一题会结束上一题，确定吗？")) return;
  }
  try {
    setBusy(true);
    applyState(await api("/api/quiz/open", {}));
    await refreshQuizManage();
    toast("题目已公布。念完后请点放出选项");
  } catch (err) {
    toast(err.message);
  } finally {
    setBusy(false);
  }
}

async function releaseQuiz() {
  if (!CAN_CONTROL || busy) return;
  try {
    setBusy(true);
    applyState(await api("/api/quiz/release", {}));
    await refreshQuizManage();
    toast("选项已放出，开始计时");
  } catch (err) {
    toast(err.message);
  } finally {
    setBusy(false);
  }
}

async function closeQuiz() {
  if (!CAN_CONTROL || busy) return;
  try {
    setBusy(true);
    applyState(await api("/api/quiz/close", {}));
    await refreshQuizManage();
    toast("本题已结束");
  } catch (err) {
    toast(err.message);
  } finally {
    setBusy(false);
  }
}

async function submitQuiz() {
  if (ROLE !== "guest" || quizSending) return;
  const round = state && state.quiz && state.quiz.round;
  if (!round || round.status !== "open") {
    toast("现在还不能作答");
    return;
  }
  if (myNumber == null) {
    toast("请先领取抽奖号码");
    return;
  }
  if (!quizPicks.size) {
    toast("请选择答案");
    return;
  }
  quizSending = true;
  try {
    const fp = await deviceFingerprint();
    const data = await api("/api/quiz/answer", {
      choices: [...quizPicks],
      fingerprint: fp,
      localId: guestLocalId(),
    });
    quizMine = {
      roundId: round.id,
      choices: data.choices,
      elapsedMs: data.elapsedMs,
      correct: data.correct,
      result: data.result,
    };
    if (data.state) applyState(data.state);
    else if (state) renderQuiz(state);
    if (data.result === "winner") sfx.unlock().then(() => sfx.fanfare()).catch(() => {});
  } catch (err) {
    toast(err.message);
  } finally {
    quizSending = false;
  }
}

onEl($("enterQuiz"), "click", () => setProgram("quiz"));
onEl($("backToLottery"), "click", () => setProgram("lottery"));
onEl($("quizPublish"), "click", () => publishQuiz());
onEl($("quizRelease"), "click", () => releaseQuiz());
onEl($("quizClose"), "click", () => closeQuiz());
onEl($("quizBack"), "click", () => setProgram("lottery"));
onEl($("addQuizItem"), "click", () => {
  if (!quizEditorReady) {
    toast("题目还在读取，请稍后再添加");
    return;
  }
  editQuizItems.push(newQuizDraft());
  renderQuizEditor();
});
onEl($("saveQuizBank"), "click", () => saveQuizBank());
onEl($("resetQuizProgress"), "click", () => resetQuizProgress());
onEl($("quizEditor"), "input", (e) => {
  const card = e.target.closest("[data-quiz-item]");
  if (!card) return;
  const item = editQuizItems.find((entry) => entry.id === card.dataset.quizItem);
  if (!item || editQuizPlayed.has(item.id)) return;
  if (e.target.dataset.field === "question") item.question = e.target.value;
  if (e.target.dataset.field === "prize") item.prize = e.target.value;
  const key = e.target.dataset.letter;
  if (!key) return;
  const letter = item.letters.find((entry) => entry.key === key);
  if (!letter) return;
  if (e.target.dataset.field === "on") letter.on = e.target.checked;
  if (e.target.dataset.field === "text") letter.text = e.target.value;
  if (e.target.dataset.field === "correct") letter.correct = e.target.checked;
});
onEl($("quizEditor"), "click", (e) => {
  const up = e.target.closest("[data-quiz-up]");
  const down = e.target.closest("[data-quiz-down]");
  const del = e.target.closest("[data-quiz-del]");
  if (up) moveQuizItem(up.dataset.quizUp, -1);
  if (down) moveQuizItem(down.dataset.quizDown, 1);
  if (del) {
    const id = del.dataset.quizDel;
    if (editQuizPlayed.has(id)) return;
    editQuizItems = editQuizItems.filter((item) => item.id !== id);
    renderQuizEditor();
  }
});
onEl($("quizStage"), "click", (e) => {
  const choice = e.target.closest("[data-quiz-choice]");
  if (choice && !choice.disabled) {
    const key = choice.dataset.quizChoice;
    if (quizPicks.has(key)) quizPicks.delete(key);
    else quizPicks.add(key);
    choice.classList.toggle("on", quizPicks.has(key));
    return;
  }
  if (e.target.closest("[data-quiz-submit]")) submitQuiz();
});
setInterval(updateQuizClocks, 100);

function sparkles() {
  const canvas = $("sparkles");
  if (!canvas || !canvas.getContext) return;
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
  if (!canvas) return;
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
  if (!CAN_CONTROL || !ui.hostGate) return;
  try {
    const session = await api("/api/host/session");
    if (session.ok) {
      ui.hostGate.classList.add("hidden");
      return;
    }
    ui.hostGate.classList.remove("hidden");
    if (ui.hostGateErr) ui.hostGateErr.textContent = "";
  } catch (err) {
    if (ui.hostGateErr) ui.hostGateErr.textContent = err.message;
  }
}

async function boot() {
  await bootHost();
  if (ROLE === "guest") await restoreGuest();
  if (ROLE === "screen") {
    const unlock = () => { sfx.unlock(); };
    document.addEventListener("click", unlock);
    document.addEventListener("touchstart", unlock, { passive: true });
  }
  connectWs();
  try {
    await refresh();
  } finally {
    sfx.prepare(state && state.audioCdn);
  }
}

boot().catch((err) => toast(err.message));
setInterval(() => {
  if (!wsLive && !busy && !rolling && document.visibilityState === "visible") {
    refresh().catch(() => {});
  }
}, 2500);
