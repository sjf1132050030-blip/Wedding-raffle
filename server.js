const crypto = require("crypto");
const http = require("http");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WebSocketServer } = require("ws");
const QRCode = require("qrcode");

const PORT = Number(process.env.PORT) || 3780;
const HOST_PASSWORD = "147258";
const DATA_DIR = path.join(__dirname, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const LEVEL_PRESET = [
  { id: "l3", name: "三等奖" },
  { id: "l2", name: "二等奖" },
  { id: "l1", name: "一等奖" },
  { id: "l0", name: "特等奖" },
];

const DEFAULT_MEANINGS = {
  保温杯: "温情常伴，热度不减",
  养生礼盒: "养身养心，健康相守",
  梳子: "一梳到白头，顺心如意",
  羽毛球拍: "一拍即合，默契满分",
  调料盒: "五味俱全，日子有滋味",
  旺旺大礼包: "旺上加旺，红红火火",
  小米吹风机: "顺发顺心，烦恼吹散",
  电煮壶: "一壶热水，家有暖意",
  美的空气炸锅: "美的到家，幸福炸开",
};

function defaultPrizes() {
  return [
    { id: "p1", levelId: "l3", name: "保温杯", count: 2, meaning: DEFAULT_MEANINGS["保温杯"] },
    { id: "p2", levelId: "l3", name: "养生礼盒", count: 1, meaning: DEFAULT_MEANINGS["养生礼盒"] },
    { id: "p3", levelId: "l3", name: "梳子", count: 2, meaning: DEFAULT_MEANINGS["梳子"] },
    { id: "p4", levelId: "l2", name: "羽毛球拍", count: 1, meaning: DEFAULT_MEANINGS["羽毛球拍"] },
    { id: "p5", levelId: "l2", name: "调料盒", count: 1, meaning: DEFAULT_MEANINGS["调料盒"] },
    { id: "p6", levelId: "l2", name: "旺旺大礼包", count: 1, meaning: DEFAULT_MEANINGS["旺旺大礼包"] },
    { id: "p7", levelId: "l1", name: "小米吹风机", count: 1, meaning: DEFAULT_MEANINGS["小米吹风机"] },
    { id: "p8", levelId: "l1", name: "电煮壶", count: 1, meaning: DEFAULT_MEANINGS["电煮壶"] },
    { id: "p9", levelId: "l0", name: "美的空气炸锅", count: 1, meaning: DEFAULT_MEANINGS["美的空气炸锅"] },
  ];
}

function prizeMeaning(p) {
  const custom = String((p && p.meaning) || "").trim();
  if (custom) return custom.slice(0, 40);
  return DEFAULT_MEANINGS[p && p.name] || "百年好合，喜乐安康";
}

function idleSession() {
  return {
    started: false,
    currentLevelId: null,
    currentPrizeId: null,
    currentBatch: [],
    phase: "idle",
  };
}

function idleController() {
  return { token: null, lockedAt: null };
}

function defaultStore() {
  return {
    config: {
      title: "新婚快乐 幸运大抽奖",
      couple: "新郎  ♥  新娘",
      numberMin: 1,
      numberMax: 150,
      excluded: [],
    },
    levels: LEVEL_PRESET.map((l) => ({ ...l })),
    prizes: defaultPrizes(),
    draws: [],
    guests: [],
    controller: idleController(),
    session: idleSession(),
  };
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(defaultStore(), null, 2), "utf8");
  }
}

function loadStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeStore(parsed);
  } catch {
    const fresh = defaultStore();
    saveStore(fresh);
    return fresh;
  }
}

function saveStore(store) {
  ensureStore();
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.copyFileSync(tmp, STORE_PATH);
  fs.unlinkSync(tmp);
}

function normalizeStore(store) {
  const base = defaultStore();
  const config = { ...base.config, ...(store.config || {}) };
  config.numberMin = clampInt(config.numberMin, 1, 9999, 1);
  config.numberMax = clampInt(config.numberMax, 1, 9999, 150);
  if (config.numberMin > config.numberMax) {
    const t = config.numberMin;
    config.numberMin = config.numberMax;
    config.numberMax = t;
  }
  config.excluded = normalizeExcluded(config.excluded, config.numberMin, config.numberMax);
  config.title = String(config.title || base.config.title).slice(0, 40);
  config.couple = String(config.couple || base.config.couple).slice(0, 40);

  const levels = Array.isArray(store.levels) && store.levels.length
    ? store.levels.map((l, i) => ({
        id: String(l.id || uid("lv")),
        name: String(l.name || `奖项${i + 1}`).slice(0, 20),
      }))
    : base.levels;

  const levelIds = new Set(levels.map((l) => l.id));
  const prizes = Array.isArray(store.prizes)
    ? store.prizes
        .filter((p) => p && p.name && levelIds.has(p.levelId))
        .map((p) => ({
          id: String(p.id || uid("p")),
          levelId: String(p.levelId),
          name: String(p.name).slice(0, 30),
          count: clampInt(p.count, 1, 99, 1),
          meaning: prizeMeaning(p),
        }))
    : base.prizes;

  const draws = Array.isArray(store.draws)
    ? store.draws.map((d) => ({
        number: Number(d.number),
        prizeId: String(d.prizeId),
        levelId: String(d.levelId),
        levelName: String(d.levelName || ""),
        prizeName: String(d.prizeName || ""),
        prizeMeaning: String(d.prizeMeaning || ""),
        revealed: Boolean(d.revealed),
        at: d.at || new Date().toISOString(),
      }))
    : [];

  const guests = Array.isArray(store.guests)
    ? store.guests
        .filter((g) => g && Number.isFinite(Number(g.number)))
        .map((g) => ({
          id: String(g.id || uid("g")),
          fingerprint: String(g.fingerprint || ""),
          cookieId: String(g.cookieId || ""),
          number: Number(g.number),
          claimedAt: g.claimedAt || new Date().toISOString(),
        }))
    : [];

  const controller = {
    token: store.controller && store.controller.token ? String(store.controller.token) : null,
    lockedAt: store.controller && store.controller.lockedAt ? store.controller.lockedAt : null,
  };

  const session = { ...idleSession(), ...(store.session || {}) };
  return { config, levels, prizes, draws, guests, controller, session };
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeExcluded(list, min, max) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const n = Number.parseInt(item, 10);
    if (!Number.isFinite(n) || n < min || n > max || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function prizesOfLevel(store, levelId) {
  return store.prizes.filter((p) => p.levelId === levelId);
}

function levelsWithPrizes(store) {
  return store.levels.filter((l) => prizesOfLevel(store, l.id).length > 0);
}

function findPrize(store, prizeId) {
  return store.prizes.find((p) => p.id === prizeId) || null;
}

function findLevel(store, levelId) {
  return store.levels.find((l) => l.id === levelId) || null;
}

function usedNumbers(store) {
  return new Set(store.draws.map((d) => d.number));
}

function claimedNumbers(store) {
  return store.guests.map((g) => g.number);
}

function displayMax(store) {
  const nums = claimedNumbers(store).concat(store.draws.map((d) => d.number));
  return Math.max(store.config.numberMax, ...nums, 0);
}

function availablePool(store) {
  const used = usedNumbers(store);
  return claimedNumbers(store).filter((n) => !used.has(n));
}

function totalPrizeCount(store) {
  return store.prizes.reduce((sum, p) => sum + p.count, 0);
}

function publicState(store) {
  const currentPrize = findPrize(store, store.session.currentPrizeId);
  const currentLevel = findLevel(store, store.session.currentLevelId);
  const nextLevel = nextLevelAfter(store, store.session.currentLevelId);
  const claimed = claimedNumbers(store).slice().sort((a, b) => a - b);
  return {
    config: store.config,
    levels: store.levels,
    prizes: store.prizes,
    draws: store.draws,
    session: store.session,
    currentLevel,
    currentPrize: currentPrize
      ? {
          id: currentPrize.id,
          levelId: currentPrize.levelId,
          count: currentPrize.count,
          drawn: store.session.currentBatch.length,
          remaining: Math.max(0, currentPrize.count - store.session.currentBatch.length),
        }
      : null,
    nextLevel,
    poolLeft: availablePool(store).length,
    totalNeed: totalPrizeCount(store),
    claimedCount: claimed.length,
    claimedNumbers: claimed,
    displayMax: displayMax(store),
    hostLocked: Boolean(store.controller && store.controller.token),
    guestUrl: guestPageUrl(),
    claimingOpen: claimingOpen(store),
  };
}

function claimingOpen(store) {
  return !store.session.started && store.session.phase === "idle";
}

function nextLevelAfter(store, levelId) {
  const active = levelsWithPrizes(store);
  if (!levelId) return active[0] || null;
  const idx = active.findIndex((l) => l.id === levelId);
  if (idx < 0) return active[0] || null;
  return active[idx + 1] || null;
}

function assertCanEdit(store) {
  if (store.draws.length > 0 || store.session.started) {
    const err = new Error("抽奖已开始，请先重置后再修改配置");
    err.status = 400;
    throw err;
  }
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function appendCookie(res, name, value, attrs) {
  const cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=31536000${attrs || ""}`;
  const prev = res.getHeader("Set-Cookie");
  if (!prev) res.setHeader("Set-Cookie", cookie);
  else res.setHeader("Set-Cookie", [].concat(prev, cookie));
}

function hostTokenFrom(req) {
  const cookies = parseCookies(req);
  const header = String(req.headers["x-host-token"] || "").trim();
  const bodyToken = req.body && req.body.token ? String(req.body.token).trim() : "";
  return cookies.host_token || header || bodyToken || "";
}

function requireHost(req, store) {
  if (!store.controller || !store.controller.token) {
    fail(403, "请先打开 /start 登录控制台");
  }
  if (hostTokenFrom(req) !== store.controller.token) {
    fail(403, "只有控制台可以操作抽奖");
  }
}

function cleanFingerprint(value) {
  const s = String(value || "").toLowerCase().replace(/[^a-f0-9]/g, "");
  if (s.length < 16 || s.length > 128) return "";
  return s.slice(0, 128);
}

function cleanLocalId(value) {
  const s = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (s.length < 8 || s.length > 80) return "";
  return s.slice(0, 80);
}

function findGuest(store, fingerprint, cookieId, localId) {
  return store.guests.find((g) => {
    if (fingerprint && g.fingerprint && g.fingerprint === fingerprint) return true;
    if (cookieId && g.cookieId && g.cookieId === cookieId) return true;
    if (localId && g.cookieId && g.cookieId === localId) return true;
    return false;
  }) || null;
}

function nextClaimNumber(store) {
  const taken = new Set(claimedNumbers(store));
  const excluded = new Set(store.config.excluded);
  const min = store.config.numberMin;
  const max = store.config.numberMax;
  const pool = [];
  for (let n = min; n <= max; n++) {
    if (!taken.has(n) && !excluded.has(n)) pool.push(n);
  }
  if (pool.length) return pool[crypto.randomInt(pool.length)];
  let n = max + 1;
  while (taken.has(n) || excluded.has(n)) n += 1;
  return n;
}

let queue = Promise.resolve();
function withStore(mutator) {
  const run = queue.then(async () => {
    const store = loadStore();
    const result = mutator(store);
    saveStore(store);
    return result;
  });
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/start", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(PUBLIC_DIR, "start.html"));
});

app.use(express.static(PUBLIC_DIR, {
  etag: false,
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-store");
  },
}));

app.get("/api/state", (_req, res) => {
  res.json(publicState(loadStore()));
});

app.get("/api/qr.svg", (req, res, next) => {
  QRCode.toString(guestPageUrl(req), {
    type: "svg",
    margin: 1,
    width: 640,
    errorCorrectionLevel: "H",
    color: { dark: "#c2182c", light: "#fff6d0" },
  })
    .then((svg) => {
      res.setHeader("Cache-Control", "no-store");
      res.type("image/svg+xml");
      res.send(svg);
    })
    .catch(next);
});

app.get("/api/host/session", (req, res) => {
  const store = loadStore();
  const token = hostTokenFrom(req);
  const locked = Boolean(store.controller && store.controller.token);
  const ok = locked && token && token === store.controller.token;
  res.json({ ok, locked, claimedCount: store.guests.length });
});

app.post("/api/host/login", (req, res, next) => {
  withStore((store) => {
    const password = String((req.body && req.body.password) || "");
    if (password !== HOST_PASSWORD) fail(403, "密码错误");
    const existing = hostTokenFrom(req);
    if (store.controller && store.controller.token) {
      if (existing && existing === store.controller.token) {
        return { ok: true, token: store.controller.token, first: false };
      }
      fail(403, "控制台已被占用，无法进入");
    }
    const token = crypto.randomBytes(24).toString("hex");
    store.controller = { token, lockedAt: new Date().toISOString() };
    return { ok: true, token, first: true };
  })
    .then((result) => {
      appendCookie(res, "host_token", result.token, "; HttpOnly");
      res.json({ ok: true, first: result.first, claimedCount: loadStore().guests.length });
    })
    .catch(next);
});

app.post("/api/host/release", (req, res, next) => {
  withStore((store) => {
    requireHost(req, store);
    store.controller = idleController();
    return { ok: true };
  })
    .then((result) => {
      appendCookie(res, "host_token", "", "; HttpOnly; Max-Age=0");
      broadcast({ type: "state", state: publicState(loadStore()) });
      res.json(result);
    })
    .catch(next);
});

function guestIdentity(req) {
  const body = req.body || {};
  const cookies = parseCookies(req);
  return {
    fingerprint: cleanFingerprint(body.fingerprint),
    localId: cleanLocalId(body.localId),
    cookieId: cleanLocalId(cookies.guest_id),
  };
}

function isWeChatMobile(req) {
  const ua = String(req.headers["user-agent"] || "");
  if (!/MicroMessenger/i.test(ua)) return false;
  if (/WindowsWechat|MacWechat|WeChatForWindows|WeChatForMac/i.test(ua)) return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

function requireWeChatGuest(req) {
  if (!isWeChatMobile(req)) fail(403, "请使用微信扫码参加抽奖");
}

app.post("/api/me", (req, res) => {
  if (!isWeChatMobile(req)) {
    res.json({ number: null, claimedCount: loadStore().guests.length, win: null, wechat: false });
    return;
  }
  const store = loadStore();
  const id = guestIdentity(req);
  const guest = findGuest(store, id.fingerprint, id.cookieId, id.localId);
  const win = guest ? store.draws.find((d) => d.number === guest.number) || null : null;
  res.json({
    number: guest ? guest.number : null,
    claimedCount: store.guests.length,
    win,
    displayMax: displayMax(store),
  });
});

app.post("/api/claim", (req, res, next) => {
  withStore((store) => {
    requireWeChatGuest(req);
    const id = guestIdentity(req);
    if (!id.fingerprint && !id.localId && !id.cookieId) {
      fail(400, "无法识别这台手机，请用微信重新扫码");
    }
    const existing = findGuest(store, id.fingerprint, id.cookieId, id.localId);
    if (existing) {
      if (id.fingerprint && !existing.fingerprint) existing.fingerprint = id.fingerprint;
      return { guest: existing, already: true };
    }
    if (!claimingOpen(store)) fail(403, "抽奖已开始，停止领号");
    const cookieId = id.cookieId || id.localId || uid("guest");
    const guest = {
      id: uid("g"),
      fingerprint: id.fingerprint,
      cookieId,
      number: nextClaimNumber(store),
      claimedAt: new Date().toISOString(),
    };
    store.guests.push(guest);
    return { guest, already: false };
  })
    .then((result) => {
      appendCookie(res, "guest_id", result.guest.cookieId, "; HttpOnly");
      const store = loadStore();
      const state = publicState(store);
      const win = store.draws.find((d) => d.number === result.guest.number) || null;
      broadcast({ type: "claim", state });
      res.json({
        number: result.guest.number,
        already: result.already,
        claimedCount: store.guests.length,
        displayMax: displayMax(store),
        win,
      });
    })
    .catch(next);
});

app.post("/api/config", (req, res, next) => {
  mutateHost(req, res, next, (store) => {
    assertCanEdit(store);
    const body = req.body || {};
    if (body.title != null) store.config.title = String(body.title).slice(0, 40);
    if (body.couple != null) store.config.couple = String(body.couple).slice(0, 40);
    if (body.numberMin != null) store.config.numberMin = clampInt(body.numberMin, 1, 9999, store.config.numberMin);
    if (body.numberMax != null) store.config.numberMax = clampInt(body.numberMax, 1, 9999, store.config.numberMax);
    if (store.config.numberMin > store.config.numberMax) fail(400, "号码最小值不能大于最大值");
    if (body.excluded != null) {
      store.config.excluded = normalizeExcluded(body.excluded, store.config.numberMin, store.config.numberMax);
    }
    return publicState(store);
  });
});

app.post("/api/setup", (req, res, next) => {
  mutateHost(req, res, next, (store) => {
    assertCanEdit(store);
    const body = req.body || {};
    if (body.config) {
      const c = body.config;
      if (c.title != null) store.config.title = String(c.title).slice(0, 40);
      if (c.couple != null) store.config.couple = String(c.couple).slice(0, 40);
      if (c.numberMin != null) store.config.numberMin = clampInt(c.numberMin, 1, 9999, 1);
      if (c.numberMax != null) store.config.numberMax = clampInt(c.numberMax, 1, 9999, 150);
      if (store.config.numberMin > store.config.numberMax) fail(400, "号码最小值不能大于最大值");
      if (c.excluded != null) {
        store.config.excluded = normalizeExcluded(c.excluded, store.config.numberMin, store.config.numberMax);
      }
    }
    if (Array.isArray(body.levels) && body.levels.length) {
      const levels = body.levels.map((l, i) => ({
        id: String(l.id || uid("lv")),
        name: String(l.name || `奖项${i + 1}`).trim().slice(0, 20),
      }));
      if (levels.some((l) => !l.name)) fail(400, "奖项等级名称不能为空");
      const ids = new Set(levels.map((l) => l.id));
      if (ids.size !== levels.length) fail(400, "奖项等级 ID 重复");
      store.levels = levels;
    }
    if (Array.isArray(body.prizes)) {
      const levelIds = new Set(store.levels.map((l) => l.id));
      const prizes = body.prizes.map((p) => ({
        id: String(p.id || uid("p")),
        levelId: String(p.levelId),
        name: String(p.name || "").trim().slice(0, 30),
        count: clampInt(p.count, 1, 99, 1),
        meaning: prizeMeaning(p),
      }));
      if (prizes.some((p) => !p.name)) fail(400, "奖品名称不能为空");
      if (prizes.some((p) => !levelIds.has(p.levelId))) fail(400, "奖品所属等级无效");
      if (!prizes.length) fail(400, "至少需要一个奖品");
      store.prizes = prizes;
    }
    return publicState(store);
  });
});

app.post("/api/start", (req, res, next) => {
  mutateHost(req, res, next, (store) => {
    if (store.session.phase !== "idle") fail(400, "抽奖已经开始");
    const active = levelsWithPrizes(store);
    if (!active.length) fail(400, "请先配置奖项");
    if (!store.guests.length) fail(400, "还没有宾客领取号码");
    const pool = availablePool(store);
    if (!pool.length) fail(400, "没有可抽的号码了");
    const firstLevel = active[0];
    const firstPrize = prizesOfLevel(store, firstLevel.id)[0];
    store.session = {
      started: true,
      currentLevelId: firstLevel.id,
      currentPrizeId: firstPrize.id,
      currentBatch: [],
      phase: "drawing",
    };
    return publicState(store);
  });
});

app.post("/api/draw", (req, res, next) => {
  mutateHost(req, res, next, (store) => {
    if (store.session.phase !== "drawing") fail(400, "当前不能抽号");
    const prize = findPrize(store, store.session.currentPrizeId);
    const level = findLevel(store, store.session.currentLevelId);
    if (!prize || !level) fail(400, "当前奖项不存在");
    if (store.session.currentBatch.length >= prize.count) fail(400, "本轮号码已抽齐，请公布奖品");
    const pool = availablePool(store);
    if (!pool.length) fail(400, "没有可抽的号码了");
    const number = pool[crypto.randomInt(pool.length)];
    store.session.currentBatch.push(number);
    store.draws.push({
      number,
      prizeId: prize.id,
      levelId: level.id,
      levelName: level.name,
      prizeName: prize.name,
      prizeMeaning: prizeMeaning(prize),
      revealed: false,
      at: new Date().toISOString(),
    });
    if (store.session.currentBatch.length >= prize.count) {
      store.session.phase = "awaiting_reveal";
    }
    return { ...publicState(store), justDrawn: number };
  }, "draw");
});

app.post("/api/reveal", (req, res, next) => {
  mutateHost(req, res, next, (store) => {
    if (store.session.phase !== "awaiting_reveal") fail(400, "请先抽完本轮号码");
    const prize = findPrize(store, store.session.currentPrizeId);
    const batch = store.session.currentBatch.slice();
    for (const draw of store.draws) {
      if (batch.includes(draw.number)) draw.revealed = true;
    }
    store.session.phase = "revealed";
    return {
      ...publicState(store),
      revealed: {
        levelName: findLevel(store, store.session.currentLevelId)?.name || "",
        prizeName: prize?.name || "",
        meaning: prizeMeaning(prize),
        numbers: batch,
      },
    };
  }, "reveal");
});

app.post("/api/continue", (req, res, next) => {
  mutateHost(req, res, next, (store) => {
    if (store.session.phase === "revealed") {
      const levelId = store.session.currentLevelId;
      const currentId = store.session.currentPrizeId;
      const list = prizesOfLevel(store, levelId);
      const idx = list.findIndex((p) => p.id === currentId);
      const nextPrize = idx >= 0 ? list[idx + 1] : null;
      if (nextPrize) {
        store.session.currentPrizeId = nextPrize.id;
        store.session.currentBatch = [];
        store.session.phase = "drawing";
      } else if (!nextLevelAfter(store, levelId)) {
        store.session.currentLevelId = null;
        store.session.currentPrizeId = null;
        store.session.currentBatch = [];
        store.session.phase = "all_done";
      } else {
        store.session.currentPrizeId = null;
        store.session.currentBatch = [];
        store.session.phase = "level_done";
      }
      return publicState(store);
    }
    if (store.session.phase === "level_done") {
      const next = nextLevelAfter(store, store.session.currentLevelId);
      if (!next) {
        store.session.phase = "all_done";
        store.session.currentLevelId = null;
        store.session.currentPrizeId = null;
        store.session.currentBatch = [];
        return publicState(store);
      }
      const firstPrize = prizesOfLevel(store, next.id)[0];
      store.session.currentLevelId = next.id;
      store.session.currentPrizeId = firstPrize.id;
      store.session.currentBatch = [];
      store.session.phase = "drawing";
      return publicState(store);
    }
    fail(400, "当前不能继续");
  });
});

app.post("/api/reset", (req, res, next) => {
  mutateHost(req, res, next, (store) => {
    const restoreDefaults = Boolean(req.body && req.body.defaults);
    const clearGuests = Boolean(req.body && req.body.guests);
    if (restoreDefaults) {
      const fresh = defaultStore();
      store.config = fresh.config;
      store.levels = fresh.levels;
      store.prizes = fresh.prizes;
    }
    store.draws = [];
    store.session = idleSession();
    if (restoreDefaults || clearGuests) store.guests = [];
    return publicState(store);
  });
});

function mutateHost(req, res, next, mutator, type = "state") {
  withStore((store) => {
    requireHost(req, store);
    return mutator(store);
  })
    .then((state) => {
      const payload = { type, state };
      if (state && state.justDrawn != null) payload.justDrawn = state.justDrawn;
      broadcast(payload);
      res.json(state);
    })
    .catch(next);
}

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "服务器错误" });
});

function lanIPs() {
  const ips = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) ips.push(a.address);
    }
  }
  return ips;
}

function preferredLanIP() {
  const score = (ip) => {
    if (ip.startsWith("192.168.")) return 0;
    if (ip.startsWith("10.")) return 1;
    const m = ip.match(/^172\.(\d+)\./);
    if (m) {
      const n = Number(m[1]);
      if (n >= 16 && n <= 31) return 2;
    }
    return 9;
  };
  return lanIPs().slice().sort((a, b) => score(a) - score(b))[0] || "localhost";
}

function guestPageUrl(req) {
  const rawHost = String((req && req.headers && req.headers.host) || "");
  const hostname = rawHost.split(":")[0];
  const local = !hostname || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const host = local ? preferredLanIP() : hostname;
  return `http://${host}:${PORT}/`;
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "state", state: publicState(loadStore()) }));
});

server.listen(PORT, "0.0.0.0", () => {
  const ips = lanIPs();
  console.log(`婚礼抽奖服务已启动`);
  console.log(`宾客领号: http://localhost:${PORT}`);
  console.log(`控制台:   http://localhost:${PORT}/start`);
  for (const ip of ips) {
    console.log(`宾客局域网: http://${ip}:${PORT}`);
    console.log(`控制台局域网: http://${ip}:${PORT}/start`);
  }
});
