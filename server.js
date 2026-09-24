const crypto = require("crypto");
const http = require("http");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WebSocketServer } = require("ws");
const QRCode = require("qrcode");

const PORT = Number(process.env.PORT) || 3780;
const DEFAULT_PUBLIC_URL = "http://816.gjsgj.com";
const HOST_PASSWORD = "147258";
const DATA_DIR = path.join(__dirname, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_AUDIO_CDN = [
  "https://cdn.jsdmirror.com/gh/sjf1132050030-blip/Wedding-raffle@main/public",
  "https://cdn.jsdelivr.net/gh/sjf1132050030-blip/Wedding-raffle@main/public",
];

function audioCdnList() {
  const raw = process.env.AUDIO_CDN;
  if (raw == null || String(raw).trim() === "") return DEFAULT_AUDIO_CDN.slice();
  const s = String(raw).trim();
  if (/^(off|none|0|false)$/i.test(s)) return [];
  return s.split(/[,;\s]+/).map((item) => item.replace(/\/$/, "")).filter(Boolean);
}

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

const QUIZ_LETTERS = ["A", "B", "C", "D", "E"];

function idleQuiz() {
  return { items: [], played: [], round: null, submissions: [], awards: [] };
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
    program: "lottery",
    quiz: idleQuiz(),
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
  const program = store.program === "quiz" ? "quiz" : "lottery";
  const quiz = normalizeQuiz(store.quiz);
  return { config, levels, prizes, draws, guests, controller, session, program, quiz };
}

function normalizeQuiz(raw) {
  const quiz = idleQuiz();
  if (!raw || typeof raw !== "object") return quiz;
  const seenIds = new Set();
  for (const rawItem of Array.isArray(raw.items) ? raw.items : []) {
    const item = coerceQuizItem(rawItem);
    if (!item || seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    quiz.items.push(item);
  }
  const playedSeen = new Set();
  for (const id of Array.isArray(raw.played) ? raw.played : []) {
    const key = String(id || "");
    if (!seenIds.has(key) || playedSeen.has(key)) continue;
    playedSeen.add(key);
    quiz.played.push(key);
  }
  const round = raw.round;
  if (round && round.question) {
    const options = [];
    const seen = new Set();
    for (const item of Array.isArray(round.options) ? round.options : []) {
      const key = String(item && item.key || "").trim().toUpperCase();
      const text = String(item && item.text || "").trim().slice(0, 80);
      if (!QUIZ_LETTERS.includes(key) || seen.has(key) || !text) continue;
      seen.add(key);
      options.push({ key, text });
    }
    options.sort((a, b) => QUIZ_LETTERS.indexOf(a.key) - QUIZ_LETTERS.indexOf(b.key));
    const answers = [...new Set(
      (Array.isArray(round.answers) ? round.answers : [])
        .map((key) => String(key || "").trim().toUpperCase())
        .filter((key) => seen.has(key))
    )];
    if (options.length >= 2 && answers.length) {
      const itemId = String(round.itemId || "");
      quiz.round = {
        id: String(round.id || uid("q")),
        itemId,
        question: String(round.question).trim().slice(0, 200),
        prize: String(round.prize || "竞答奖品").trim().slice(0, 30) || "竞答奖品",
        options,
        answers,
        status: round.status === "closed" ? "closed" : round.status === "open" ? "open" : "reading",
        elapsedBefore: Math.max(0, Number(round.elapsedBefore) || 0),
        runningSince: round.status === "open" ? (Number(round.runningSince) || null) : null,
      };
      if (itemId && seenIds.has(itemId) && !playedSeen.has(itemId)) {
        playedSeen.add(itemId);
        quiz.played.push(itemId);
      }
    }
  }
  const roundIds = new Set(quiz.round ? [quiz.round.id] : []);
  const guestSeen = new Set();
  for (const item of Array.isArray(raw.awards) ? raw.awards : []) {
    if (!item || !item.roundId || !item.guestId) continue;
    const roundId = String(item.roundId);
    const guestId = String(item.guestId);
    if (guestSeen.has(guestId)) continue;
    if (quiz.awards.some((award) => award.roundId === roundId)) continue;
    guestSeen.add(guestId);
    roundIds.add(roundId);
    quiz.awards.push({
      roundId,
      guestId,
      number: Number(item.number),
      elapsedMs: Math.max(0, Number(item.elapsedMs) || 0),
      prize: String(item.prize || "").slice(0, 30),
      question: String(item.question || "").slice(0, 200),
      at: item.at || new Date().toISOString(),
    });
  }
  const answered = new Set();
  for (const item of Array.isArray(raw.submissions) ? raw.submissions : []) {
    if (!item || !item.roundId || !item.guestId) continue;
    const roundId = String(item.roundId);
    const guestId = String(item.guestId);
    const mark = `${roundId}:${guestId}`;
    if (answered.has(mark)) continue;
    answered.add(mark);
    const choices = [...new Set(
      (Array.isArray(item.choices) ? item.choices : [])
        .map((key) => String(key || "").trim().toUpperCase())
        .filter((key) => QUIZ_LETTERS.includes(key))
    )];
    quiz.submissions.push({
      id: String(item.id || uid("qa")),
      roundId,
      guestId,
      number: Number(item.number),
      choices,
      elapsedMs: Math.max(0, Number(item.elapsedMs) || 0),
      correct: Boolean(item.correct),
      result: ["wrong", "winner", "late", "already_awarded"].includes(item.result) ? item.result : "wrong",
      at: item.at || new Date().toISOString(),
    });
  }
  return quiz;
}

function pauseQuizClock(quiz, now) {
  const round = quiz && quiz.round;
  if (!round || round.status !== "open" || !round.runningSince) return;
  round.elapsedBefore += Math.max(0, now - round.runningSince);
  round.runningSince = null;
}

function resumeQuizClock(quiz, now) {
  const round = quiz && quiz.round;
  if (!round || round.status !== "open" || round.runningSince) return;
  round.runningSince = now;
}

function quizElapsed(round, now) {
  if (!round) return 0;
  let ms = Math.max(0, Number(round.elapsedBefore) || 0);
  if (round.runningSince) ms += Math.max(0, now - round.runningSince);
  return ms;
}

function sameChoiceSet(left, right) {
  if (left.length !== right.length) return false;
  const wanted = new Set(right);
  return left.every((key) => wanted.has(key));
}

function sortQuizAnswers(answers) {
  return answers.slice().sort((a, b) => QUIZ_LETTERS.indexOf(a) - QUIZ_LETTERS.indexOf(b));
}

function parseQuizSetup(body) {
  const question = String(body.question || "").trim().slice(0, 200);
  const prize = String(body.prize || "").trim().slice(0, 30);
  if (!question) fail(400, "请填写题目");
  if (!prize) fail(400, "请填写奖品");
  if (!Array.isArray(body.options)) fail(400, "请设置选项");
  const options = [];
  const seen = new Set();
  const answers = [];
  for (const item of body.options) {
    const key = String(item && item.key || "").trim().toUpperCase();
    if (!QUIZ_LETTERS.includes(key) || seen.has(key)) continue;
    const text = String(item && item.text || "").trim().slice(0, 80);
    if (!text) fail(400, `选项 ${key} 的内容不能为空`);
    seen.add(key);
    options.push({ key, text });
    if (item.correct) answers.push(key);
  }
  options.sort((a, b) => QUIZ_LETTERS.indexOf(a.key) - QUIZ_LETTERS.indexOf(b.key));
  if (options.length < 2) fail(400, "至少保留两个选项");
  if (!answers.length) fail(400, "请至少勾选一个正确答案");
  return { question, prize, options, answers: sortQuizAnswers(answers) };
}

function coerceQuizItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const question = String(raw.question || "").trim().slice(0, 200);
  const prize = String(raw.prize || "").trim().slice(0, 30);
  if (!question || !prize) return null;
  const options = [];
  const seen = new Set();
  for (const item of Array.isArray(raw.options) ? raw.options : []) {
    const key = String(item && item.key || "").trim().toUpperCase();
    const text = String(item && item.text || "").trim().slice(0, 80);
    if (!QUIZ_LETTERS.includes(key) || seen.has(key) || !text) continue;
    seen.add(key);
    options.push({ key, text });
  }
  options.sort((a, b) => QUIZ_LETTERS.indexOf(a.key) - QUIZ_LETTERS.indexOf(b.key));
  let answers = [...new Set(
    (Array.isArray(raw.answers) ? raw.answers : [])
      .map((key) => String(key || "").trim().toUpperCase())
      .filter((key) => seen.has(key))
  )];
  if (!answers.length) {
    answers = [...new Set(
      (Array.isArray(raw.options) ? raw.options : [])
        .filter((item) => item && item.correct)
        .map((item) => String(item.key || "").trim().toUpperCase())
        .filter((key) => seen.has(key))
    )];
  }
  if (options.length < 2 || !answers.length) return null;
  const id = String(raw.id || "").trim().slice(0, 40);
  if (id && !/^[\w-]+$/.test(id)) return null;
  return { id: id || uid("qi"), question, prize, options, answers: sortQuizAnswers(answers) };
}

function parseQuizItem(body) {
  const setup = parseQuizSetup(body || {});
  const id = String((body && body.id) || "").trim().slice(0, 40);
  if (id && !/^[\w-]+$/.test(id)) fail(400, "题目编号无效");
  return { id: id || uid("qi"), ...setup };
}

function sameQuizItem(left, right) {
  if (!left || !right) return false;
  if (left.question !== right.question || left.prize !== right.prize) return false;
  if (left.options.length !== right.options.length) return false;
  if (!left.options.every((option, index) => option.key === right.options[index].key && option.text === right.options[index].text)) {
    return false;
  }
  return sameChoiceSet(left.answers, right.answers);
}

function saveQuizBank(store, rawItems) {
  const quiz = store.quiz || idleQuiz();
  store.quiz = quiz;
  if (!Array.isArray(quiz.items)) quiz.items = [];
  if (!Array.isArray(quiz.played)) quiz.played = [];
  if (!Array.isArray(rawItems)) fail(400, "题目格式不对");
  if (rawItems.length > 40) fail(400, "最多配置 40 道题");
  const items = rawItems.map((item, index) => {
    try {
      return parseQuizItem(item);
    } catch (err) {
      err.message = `第 ${index + 1} 题：${err.message}`;
      throw err;
    }
  });
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) fail(400, "题目编号重复");
    ids.add(item.id);
  }
  const prevById = new Map(quiz.items.map((item) => [item.id, item]));
  for (const id of quiz.played) {
    if (!ids.has(id)) fail(400, "已经出过的题目不能删除");
  }
  for (let i = 0; i < quiz.played.length; i += 1) {
    const id = quiz.played[i];
    if (!items[i] || items[i].id !== id) fail(400, "已经出过的题目不能调换顺序");
    if (!sameQuizItem(items[i], prevById.get(id))) fail(400, "已经出过的题目不能修改");
  }
  quiz.items = items;
}

function openNextQuizRound(store, now = Date.now()) {
  if (store.program !== "quiz") fail(400, "请先进入有奖竞答");
  const quiz = store.quiz || idleQuiz();
  store.quiz = quiz;
  if (!Array.isArray(quiz.items)) quiz.items = [];
  if (!Array.isArray(quiz.played)) quiz.played = [];
  const played = new Set(quiz.played);
  const item = quiz.items.find((entry) => !played.has(entry.id));
  if (!item) fail(400, quiz.items.length ? "题目已经出完" : "请先在设置里配置竞答题目");
  closeQuizRound(quiz, now);
  quiz.played.push(item.id);
  quiz.round = {
    id: uid("q"),
    itemId: item.id,
    question: item.question,
    prize: item.prize,
    options: item.options.map((option) => ({ key: option.key, text: option.text })),
    answers: item.answers.slice(),
    status: "reading",
    elapsedBefore: 0,
    runningSince: null,
  };
}

function resetQuizProgress(store) {
  const items = store.quiz && Array.isArray(store.quiz.items) ? store.quiz.items : [];
  store.quiz = idleQuiz();
  store.quiz.items = items;
}

function parseQuizChoices(raw, allowed) {
  const list = Array.isArray(raw) ? raw : [];
  const choices = [];
  for (const item of list) {
    const key = String(item || "").trim().toUpperCase();
    if (!allowed.has(key) || choices.includes(key)) continue;
    choices.push(key);
  }
  choices.sort((a, b) => QUIZ_LETTERS.indexOf(a) - QUIZ_LETTERS.indexOf(b));
  if (!choices.length) fail(400, "请选择答案");
  return choices;
}

function closeQuizRound(quiz, now) {
  const round = quiz.round;
  if (!round || round.status === "closed") return;
  pauseQuizClock(quiz, now);
  round.status = "closed";
}

function publicQuiz(store, now = Date.now()) {
  const quiz = store.quiz || idleQuiz();
  const round = quiz.round;
  const award = round ? quiz.awards.find((item) => item.roundId === round.id) || null : null;
  const answerCount = round
    ? quiz.submissions.filter((item) => item.roundId === round.id).length
    : 0;
  const items = Array.isArray(quiz.items) ? quiz.items : [];
  let current = 0;
  if (round && round.itemId) {
    const index = items.findIndex((item) => item.id === round.itemId);
    if (index >= 0) current = index + 1;
  }
  const showPrize = Boolean(round && round.status === "closed");
  return {
    progress: {
      current,
      total: items.length,
      done: Array.isArray(quiz.played) ? quiz.played.length : 0,
    },
    round: round
      ? {
          id: round.id,
          itemId: round.itemId || "",
          question: round.question,
          prize: showPrize ? round.prize : "",
          status: round.status,
          elapsedBefore: round.elapsedBefore || 0,
          runningSince: round.status === "open" ? round.runningSince : null,
          answerCount,
          options: round.status === "reading"
            ? []
            : round.options.map((option) => ({
                key: option.key,
                text: option.text,
                ...(showPrize ? { correct: round.answers.includes(option.key) } : {}),
              })),
        }
      : null,
    winner: award
      ? {
          roundId: award.roundId,
          number: award.number,
          elapsedMs: award.elapsedMs,
          prize: showPrize ? award.prize : "",
        }
      : null,
    awards: quiz.awards.map((item) => ({
      roundId: item.roundId,
      number: item.number,
      elapsedMs: item.elapsedMs,
      prize: round && item.roundId === round.id && !showPrize ? "" : item.prize,
      question: item.question,
    })),
    serverNow: now,
  };
}

function hostQuizView(store) {
  const quiz = store.quiz || idleQuiz();
  const round = quiz.round;
  const submissions = round
    ? quiz.submissions
        .filter((item) => item.roundId === round.id)
        .slice()
        .sort((a, b) => a.elapsedMs - b.elapsedMs)
    : [];
  return {
    program: store.program,
    items: quiz.items || [],
    played: quiz.played || [],
    round: round
      ? {
          id: round.id,
          itemId: round.itemId || "",
          question: round.question,
          prize: round.prize,
          status: round.status,
          options: round.options,
          answers: round.answers,
          elapsedBefore: round.elapsedBefore || 0,
          runningSince: round.runningSince,
        }
      : null,
    submissions,
    awards: quiz.awards,
  };
}

function quizMineFor(store, guest) {
  const round = store.quiz && store.quiz.round;
  if (!guest || !round) return null;
  const mine = store.quiz.submissions.find((item) => item.roundId === round.id && item.guestId === guest.id);
  if (!mine) return null;
  const award = store.quiz.awards.find((item) => item.roundId === round.id) || null;
  return {
    roundId: mine.roundId,
    choices: mine.choices,
    elapsedMs: mine.elapsedMs,
    correct: mine.correct,
    result: mine.result,
    winner: award
      ? { number: award.number, elapsedMs: award.elapsedMs, prize: award.prize }
      : null,
  };
}

function submitQuizAnswer(store, guest, rawChoices, now = Date.now()) {
  if (store.program !== "quiz") fail(400, "现在不是有奖竞答环节");
  const round = store.quiz && store.quiz.round;
  if (round.status === "reading") fail(400, "请等主持人放出选项");
  if (round.status !== "open" || !round.runningSince) fail(400, "本题还没开始或已经结束");
  if (!guest) fail(403, "请先领取抽奖号码");
  const allowed = new Set(round.options.map((option) => option.key));
  const choices = parseQuizChoices(rawChoices, allowed);
  const existing = store.quiz.submissions.find((item) => item.roundId === round.id && item.guestId === guest.id);
  if (existing) return existing;
  const correct = sameChoiceSet(choices, round.answers);
  const elapsedMs = quizElapsed(round, now);
  let result = "wrong";
  if (correct) {
    const roundWinner = store.quiz.awards.find((item) => item.roundId === round.id);
    const alreadyAwarded = store.quiz.awards.some((item) => item.guestId === guest.id);
    if (roundWinner) result = "late";
    else if (alreadyAwarded) result = "already_awarded";
    else {
      result = "winner";
      store.quiz.awards.push({
        roundId: round.id,
        guestId: guest.id,
        number: guest.number,
        elapsedMs,
        prize: round.prize,
        question: round.question,
        at: new Date(now).toISOString(),
      });
    }
  }
  const submission = {
    id: uid("qa"),
    roundId: round.id,
    guestId: guest.id,
    number: guest.number,
    choices,
    elapsedMs,
    correct,
    result,
    at: new Date(now).toISOString(),
  };
  store.quiz.submissions.push(submission);
  return submission;
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
    program: store.program === "quiz" ? "quiz" : "lottery",
    quiz: publicQuiz(store),
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
    guestUrl: publicPageUrl(null, "/"),
    screenUrl: publicPageUrl(null, "/screen"),
    controlUrl: publicPageUrl(null, "/control"),
    claimingOpen: claimingOpen(store),
    audioCdn: audioCdnList(),
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
    fail(403, "请先打开 /control 登录控制台");
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

app.get("/screen", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(PUBLIC_DIR, "screen.html"));
});

app.get("/control", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(PUBLIC_DIR, "control.html"));
});

app.get("/start", (_req, res) => {
  res.redirect(302, "/screen");
});

app.use(express.static(PUBLIC_DIR, {
  etag: true,
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".mp3" || ext === ".jpg" || ext === ".jpeg" || ext === ".png" || ext === ".webp" || ext === ".gif") {
      res.setHeader("Cache-Control", "public, max-age=86400");
    } else {
      res.setHeader("Cache-Control", "no-store");
    }
  },
}));

app.get("/api/state", (_req, res) => {
  res.json(publicState(loadStore()));
});

app.get("/api/qr.svg", (req, res, next) => {
  const to = String(req.query.to || "guest").toLowerCase();
  const pathname = to === "control" ? "/control" : to === "screen" ? "/screen" : "/";
  QRCode.toString(publicPageUrl(req, pathname), {
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
  const ok = Boolean(store.controller && store.controller.token && token && token === store.controller.token);
  res.json({ ok, claimedCount: store.guests.length });
});

app.post("/api/host/login", (req, res, next) => {
  withStore((store) => {
    const password = String((req.body && req.body.password) || "");
    if (password !== HOST_PASSWORD) fail(403, "密码错误");
    if (!store.controller || !store.controller.token) {
      store.controller = {
        token: crypto.randomBytes(24).toString("hex"),
        lockedAt: new Date().toISOString(),
      };
    }
    return { ok: true, token: store.controller.token };
  })
    .then((result) => {
      appendCookie(res, "host_token", result.token, "; HttpOnly");
      res.json({ ok: true, claimedCount: loadStore().guests.length });
    })
    .catch(next);
});

app.post("/api/host/release", (req, res, next) => {
  withStore((store) => {
    requireHost(req, store);
    return { ok: true };
  })
    .then((result) => {
      appendCookie(res, "host_token", "", "; HttpOnly; Max-Age=0");
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
    quizMine: quizMineFor(store, guest),
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

function assertLotteryProgram(store) {
  if (store.program === "quiz") fail(400, "当前是有奖竞答，请先回到抽奖环节");
}

app.post("/api/start", (req, res, next) => {
  mutateHost(req, res, next, (store) => {
    assertLotteryProgram(store);
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
    assertLotteryProgram(store);
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
    assertLotteryProgram(store);
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
    assertLotteryProgram(store);
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
    if (restoreDefaults) {
      store.guests = [];
      store.quiz = idleQuiz();
      store.program = "lottery";
    } else if (clearGuests) {
      store.guests = [];
      resetQuizProgress(store);
    }
    return publicState(store);
  });
});

app.post("/api/program", (req, res, next) => {
  mutateHost(req, res, next, (store) => {
    const mode = req.body && req.body.mode;
    if (mode !== "quiz" && mode !== "lottery") fail(400, "环节无效");
    const now = Date.now();
    if (mode === "lottery") pauseQuizClock(store.quiz, now);
    store.program = mode;
    if (mode === "quiz") resumeQuizClock(store.quiz, now);
    return publicState(store);
  });
});

app.get("/api/quiz/manage", (req, res) => {
  const store = loadStore();
  try {
    requireHost(req, store);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "服务器错误" });
    return;
  }
  res.json(hostQuizView(store));
});

app.post("/api/quiz/bank", (req, res, next) => {
  mutateHost(req, res, next, (store) => {
    saveQuizBank(store, req.body && req.body.items);
    return publicState(store);
  });
});

app.post("/api/quiz/reset", (req, res, next) => {
  mutateHost(req, res, next, (store) => {
    resetQuizProgress(store);
    return publicState(store);
  });
});

app.post("/api/quiz/open", (req, res, next) => {
  mutateHost(req, res, next, (store) => {
    openNextQuizRound(store, Date.now());
    return publicState(store);
  });
});

app.post("/api/quiz/release", (req, res, next) => {
  mutateHost(req, res, next, (store) => {
    if (store.program !== "quiz") fail(400, "请先进入有奖竞答");
    const round = store.quiz.round;
    if (!round) fail(400, "请先公布题目");
    if (round.status === "closed") fail(400, "本题已结束");
    if (round.status === "reading") {
      round.status = "open";
      round.elapsedBefore = 0;
      round.runningSince = Date.now();
    }
    return publicState(store);
  });
});

app.post("/api/quiz/close", (req, res, next) => {
  mutateHost(req, res, next, (store) => {
    if (store.program !== "quiz") fail(400, "请先进入有奖竞答");
    if (!store.quiz.round) fail(400, "还没有题目");
    closeQuizRound(store.quiz, Date.now());
    return publicState(store);
  });
});

app.post("/api/quiz/answer", (req, res, next) => {
  withStore((store) => {
    requireWeChatGuest(req);
    const id = guestIdentity(req);
    const guest = findGuest(store, id.fingerprint, id.cookieId, id.localId);
    const submission = submitQuizAnswer(store, guest, req.body && req.body.choices);
    const award = store.quiz.awards.find((item) => item.roundId === submission.roundId) || null;
    return {
      state: publicState(store),
      payload: {
        number: submission.number,
        choices: submission.choices,
        elapsedMs: submission.elapsedMs,
        correct: submission.correct,
        result: submission.result,
        winner: award
          ? {
              number: award.number,
              elapsedMs: award.elapsedMs,
              prize: store.quiz.round && store.quiz.round.status === "closed" ? award.prize : "",
            }
          : null,
      },
    };
  })
    .then((result) => {
      broadcast({ type: "quiz", state: result.state });
      res.json({ ...result.payload, state: result.state });
    })
    .catch(next);
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

function configuredPublicOrigin() {
  const raw = process.env.PUBLIC_URL;
  const value = raw == null || String(raw).trim() === ""
    ? DEFAULT_PUBLIC_URL
    : String(raw).trim();
  if (/^(off|none|0|false|lan)$/i.test(value)) return "";
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/$/, "");
  }
}

function requestOrigin(req) {
  if (!req || !req.headers) return "";
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const rawHost = forwardedHost || String(req.headers.host || "").split(",")[0].trim();
  if (!rawHost) return "";
  const hostname = rawHost.split(":")[0];
  const local = !hostname || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (local) return "";
  const proto = forwardedProto || "http";
  return rawHost.includes(":") ? `${proto}://${rawHost}` : `${proto}://${hostname}`;
}

function publicOrigin(req) {
  return configuredPublicOrigin() || requestOrigin(req) || `http://${preferredLanIP()}:${PORT}`;
}

function publicPageUrl(req, pathname = "/") {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const origin = publicOrigin(req);
  return path === "/" ? `${origin}/` : `${origin}${path}`;
}

function guestPageUrl(req) {
  return publicPageUrl(req, "/");
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
  socket.on("error", (err) => {
    console.error("WebSocket 连接错误:", err.message);
  });
  socket.send(JSON.stringify({ type: "state", state: publicState(loadStore()) }));
});
wss.on("error", (err) => {
  console.error("WebSocket 服务错误:", err);
});
server.on("error", (err) => {
  console.error("HTTP 服务错误:", err);
});
process.on("uncaughtException", (err) => {
  console.error("未捕获异常:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("未处理的 Promise:", err);
});

function runQuizSelfTest() {
  function assert(cond, message) {
    if (!cond) throw new Error(message);
  }
  function guest(id, number) {
    return { id, number };
  }
  function openRound(store, answers, now) {
    store.program = "quiz";
    store.quiz.round = {
      id: "q1",
      question: "测试题",
      prize: "红包",
      options: [
        { key: "A", text: "甲" },
        { key: "B", text: "乙" },
        { key: "C", text: "丙" },
      ],
      answers,
      status: "open",
      elapsedBefore: 0,
      runningSince: now,
    };
  }
  const store = {
    program: "lottery",
    draws: [{ number: 7 }],
    session: { phase: "drawing", started: true, currentBatch: [7] },
    quiz: idleQuiz(),
  };
  const drawsBefore = store.draws.length;
  const phaseBefore = store.session.phase;
  pauseQuizClock(store.quiz, 1000);
  store.program = "quiz";
  assert(store.draws.length === drawsBefore && store.session.phase === phaseBefore, "切换环节不应改动抽奖");
  openRound(store, ["A", "C"], 5000);
  store.quiz.round.status = "reading";
  store.quiz.round.runningSince = null;
  const hidden = publicQuiz(store, 5000);
  assert(hidden.round.status === "reading" && hidden.round.options.length === 0, "读题时不能看到选项");
  let blockedRead = false;
  try {
    submitQuizAnswer(store, guest("g0", 11), ["A"], 6000);
  } catch (err) {
    blockedRead = /选项/.test(err.message);
  }
  assert(blockedRead && store.quiz.submissions.length === 0, "放出选项前不能作答");
  store.quiz.round.status = "open";
  store.quiz.round.runningSince = 5000;
  const partial = submitQuizAnswer(store, guest("g1", 12), ["A"], 8000);
  assert(partial.result === "wrong" && store.quiz.awards.length === 0, "漏选不能获奖");
  const extra = submitQuizAnswer(store, guest("g2", 13), ["A", "B", "C"], 9000);
  assert(extra.result === "wrong", "多选不能获奖");
  const first = submitQuizAnswer(store, guest("g3", 21), ["C", "A"], 11000);
  assert(first.result === "winner" && first.elapsedMs === 6000, "第一位全部答对获奖");
  assert(store.quiz.awards[0].number === 21, "奖品记在第一位答对的号码");
  const again = submitQuizAnswer(store, guest("g3", 21), ["A", "C"], 12000);
  assert(again === first && store.quiz.awards.length === 1, "重复提交不重复发奖");
  const late = submitQuizAnswer(store, guest("g4", 22), ["A", "C"], 13000);
  assert(late.result === "late" && store.quiz.awards.length === 1, "后来答对不发奖");
  closeQuizRound(store.quiz, 14000);
  store.quiz.round = {
    id: "q2",
    question: "第二题",
    prize: "香囊",
    options: store.quiz.round.options,
    answers: ["B"],
    status: "open",
    elapsedBefore: 0,
    runningSince: 20000,
  };
  const blocked = submitQuizAnswer(store, guest("g3", 21), ["B"], 21000);
  assert(blocked.result === "already_awarded" && store.quiz.awards.length === 1, "已领奖的人再第一也无效");
  const next = submitQuizAnswer(store, guest("g5", 30), ["B"], 23000);
  assert(next.result === "winner" && store.quiz.awards[1].number === 30, "奖品留给下一位答对的人");
  pauseQuizClock(store.quiz, 26000);
  const frozen = quizElapsed(store.quiz.round, 90000);
  assert(frozen === 6000, "回到抽奖后计时暂停");
  assert(store.session.phase === "drawing" && store.session.currentBatch[0] === 7, "竞答过程不重置抽奖");

  const bankStore = { program: "quiz", quiz: idleQuiz() };
  let needConfig = false;
  try {
    openNextQuizRound(bankStore, 1);
  } catch (err) {
    needConfig = /配置/.test(err.message);
  }
  assert(needConfig, "没配题目不能公布");
  saveQuizBank(bankStore, [
    {
      id: "qa_one",
      question: "第一题",
      prize: "红包",
      options: [
        { key: "A", text: "甲", correct: true },
        { key: "B", text: "乙", correct: false },
      ],
    },
    {
      id: "qa_two",
      question: "第二题",
      prize: "香囊",
      options: [
        { key: "A", text: "甲", correct: false },
        { key: "B", text: "乙", correct: true },
      ],
    },
  ]);
  openNextQuizRound(bankStore, 1000);
  assert(bankStore.quiz.round.question === "第一题" && bankStore.quiz.round.status === "reading", "按顺序公布第一题");
  assert(bankStore.quiz.played[0] === "qa_one", "出过的题目记下来");
  const hiddenBank = publicQuiz(bankStore, 1000);
  assert(hiddenBank.progress.current === 1 && hiddenBank.progress.total === 2, "公开进度只有题号");
  assert(!hiddenBank.round.prize, "读题时不公布奖品");
  bankStore.quiz.round.status = "open";
  bankStore.quiz.round.runningSince = 1200;
  assert(!publicQuiz(bankStore, 1300).round.prize, "作答时不公布奖品");
  closeQuizRound(bankStore.quiz, 1400);
  assert(publicQuiz(bankStore, 1400).round.prize === "红包", "结束后才公布奖品");
  assert(!Object.prototype.hasOwnProperty.call(hiddenBank, "items"), "公开状态不含题库");
  assert(!JSON.stringify(hiddenBank).includes("香囊"), "还没轮到的题目不能出现在公开状态");
  const kept = bankStore.quiz.items.map((item) => ({
    id: item.id,
    question: item.question,
    prize: item.prize,
    options: item.options.map((option) => ({
      key: option.key,
      text: option.text,
      correct: item.answers.includes(option.key),
    })),
  }));
  kept[1].question = "第二题改过";
  saveQuizBank(bankStore, kept);
  assert(bankStore.quiz.items[1].question === "第二题改过", "还没出的题可以改");
  let lockedItem = false;
  try {
    const bad = kept.map((item) => ({ ...item, options: item.options.map((option) => ({ ...option })) }));
    bad[0].question = "改掉第一题";
    saveQuizBank(bankStore, bad);
  } catch (err) {
    lockedItem = /不能修改/.test(err.message);
  }
  assert(lockedItem && bankStore.quiz.items[0].question === "第一题", "已经出过的题目不能改");
  openNextQuizRound(bankStore, 2000);
  assert(bankStore.quiz.round.question === "第二题改过" && bankStore.quiz.round.status === "reading", "下一题用改过的内容");
  assert(bankStore.quiz.played.length === 2, "两题都按顺序出过");
  let finished = false;
  try {
    openNextQuizRound(bankStore, 3000);
  } catch (err) {
    finished = /出完/.test(err.message);
  }
  assert(finished, "题目出完就不能再公布");
  resetQuizProgress(bankStore);
  assert(bankStore.quiz.items.length === 2 && bankStore.quiz.played.length === 0 && !bankStore.quiz.round, "清空进度仍保留题目");
  const restored = normalizeQuiz({
    items: [{
      id: "qa_keep",
      question: "存档题",
      prize: "对杯",
      options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }],
      answers: ["A"],
    }],
    played: ["qa_keep", "missing"],
  });
  assert(restored.items.length === 1 && restored.played.length === 1 && restored.items[0].answers[0] === "A", "题库能从存档读出");
  console.log("quiz self-test ok");
}

if (process.env.QUIZ_SELFTEST === "1") {
  try {
    runQuizSelfTest();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    const ips = lanIPs();
    console.log(`婚礼抽奖服务已启动`);
    const cdn = audioCdnList();
    console.log(cdn.length ? `音频CDN: ${cdn.join("  ")}` : "音频CDN: 关闭（使用本站 /audio）");
    console.log(`宾客扫码: ${publicPageUrl(null, "/")}`);
    console.log(`宾客领号: http://localhost:${PORT}/`);
    console.log(`大屏展示: http://localhost:${PORT}/screen`);
    console.log(`手机控制: http://localhost:${PORT}/control`);
    for (const ip of ips) {
      console.log(`宾客局域网: http://${ip}:${PORT}/`);
      console.log(`大屏局域网: http://${ip}:${PORT}/screen`);
      console.log(`控制局域网: http://${ip}:${PORT}/control`);
    }
  });
}

module.exports = {
  publicPageUrl,
  configuredPublicOrigin,
};
