import bcrypt from "bcryptjs";
import fs from "node:fs/promises";
import path from "node:path";

const STORE_PATH = path.join(process.cwd(), "data", "user-store.json");
const MAX_RECENT_ATTEMPTS = 120;
const CHINA_TIME_ZONE = "Asia/Shanghai";

export function buildConfiguredUsers() {
  const users = new Map();
  const sharedPassword = process.env.AUTH_PASSWORD || "";
  const sharedUsernames = parseList(process.env.AUTH_SHARED_USERS || process.env.AUTH_USERNAMES || "");

  if (sharedPassword && sharedUsernames.length) {
    const sharedPasswordHash = bcrypt.hashSync(sharedPassword, 10);
    for (const username of sharedUsernames) {
      users.set(username, sharedPasswordHash);
    }
  }

  const rawUsers = process.env.AUTH_USERS || "";
  for (const entry of rawUsers.split(",")) {
    const [rawUsername, ...passwordParts] = entry.split(":");
    const username = rawUsername?.trim();
    const password = passwordParts.join(":").trim();
    if (username && password) {
      users.set(username, bcrypt.hashSync(password, 10));
    }
  }

  if (sharedPassword && !users.size) {
    users.set(process.env.AUTH_USERNAME || "user", bcrypt.hashSync(sharedPassword, 10));
  }
  return users;
}

function parseList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function verifyConfiguredUser(configuredUsers, username, password) {
  const normalized = String(username || "").trim();
  const passwordHash = configuredUsers.get(normalized);
  if (!passwordHash || !password) return null;
  const valid = await bcrypt.compare(String(password), passwordHash);
  return valid ? normalized : null;
}

export async function ensureUser(username) {
  const store = await readStore();
  const user = getOrCreateUser(store, username);
  user.profile.lastLoginAt = new Date().toISOString();
  await writeStore(store);
  return publicUserState(user);
}

export async function getUserState(username) {
  const store = await readStore();
  const user = getOrCreateUser(store, username);
  await writeStore(store);
  return publicUserState(user);
}

export async function setFavorite(username, questionId, favorite) {
  const store = await readStore();
  const user = getOrCreateUser(store, username);
  if (favorite) {
    user.favorites[questionId] = new Date().toISOString();
  } else {
    delete user.favorites[questionId];
  }
  await writeStore(store);
  return publicUserState(user);
}

export async function recordAttempt(username, { questionId, bankId, answer, correct, seconds }) {
  const store = await readStore();
  const user = getOrCreateUser(store, username);
  const now = new Date();
  const iso = now.toISOString();
  const duration = Math.max(1, Number(seconds) || 1);
  const passed = Boolean(correct);
  const questionStat = user.stats.byQuestion[questionId] || emptyQuestionStats();

  user.stats.attempts += 1;
  user.stats.correct += passed ? 1 : 0;
  user.stats.totalSeconds += duration;
  questionStat.attempts += 1;
  questionStat.correct += passed ? 1 : 0;
  questionStat.totalSeconds += duration;
  questionStat.lastAt = iso;
  questionStat.lastAnswer = String(answer || "");
  user.stats.byQuestion[questionId] = questionStat;

  incrementPeriod(user.stats.daily, chinaDateKey(now), passed, duration);
  incrementPeriod(user.stats.weekly, chinaWeekKey(now), passed, duration);
  incrementPeriod(user.stats.monthly, chinaMonthKey(now), passed, duration);

  user.stats.recentAttempts.unshift({
    questionId,
    bankId,
    correct: passed,
    seconds: duration,
    answer: String(answer || ""),
    at: iso,
    dayKey: chinaDateKey(now),
  });
  user.stats.recentAttempts = user.stats.recentAttempts.slice(0, MAX_RECENT_ATTEMPTS);

  if (!passed) {
    const mistake = user.mistakes[questionId] || { count: 0, lastAt: "", lastAnswer: "" };
    user.mistakes[questionId] = {
      count: mistake.count + 1,
      lastAt: iso,
      lastAnswer: String(answer || ""),
    };
  }

  user.progress.lastQuestionId = questionId;
  if (bankId) {
    user.progress.lastBankId = bankId;
    user.progress.currentByBank[bankId] = questionId;
  }

  await writeStore(store);
  return publicUserState(user);
}

export async function saveProgress(username, { bankId, questionId, mode, typeFilter }) {
  const store = await readStore();
  const user = getOrCreateUser(store, username);
  if (questionId) user.progress.lastQuestionId = questionId;
  if (bankId) {
    user.progress.lastBankId = bankId;
    if (questionId) user.progress.currentByBank[bankId] = questionId;
  }
  if (mode) user.progress.mode = mode;
  if (typeFilter) user.progress.typeFilter = typeFilter;
  await writeStore(store);
  return publicUserState(user);
}

export async function checkIn(username) {
  const store = await readStore();
  const user = getOrCreateUser(store, username);
  const today = chinaDateKey(new Date());
  const alreadyChecked = Boolean(user.checkins[today]);
  if (!alreadyChecked) {
    user.checkins[today] = new Date().toISOString();
  }
  await writeStore(store);
  return {
    ...publicUserState(user),
    checkin: {
      checkedToday: true,
      newlyChecked: !alreadyChecked,
      streak: checkinStreak(user.checkins),
    },
  };
}

export async function resetUser(username) {
  const store = await readStore();
  const user = getOrCreateUser(store, username);
  user.favorites = {};
  user.mistakes = {};
  user.stats = emptyStats();
  user.progress = emptyProgress();
  await writeStore(store);
  return publicUserState(user);
}

function publicUserState(user) {
  return {
    username: user.profile.username,
    profile: user.profile,
    favorites: Object.keys(user.favorites),
    mistakes: user.mistakes,
    stats: user.stats,
    progress: user.progress,
    checkins: {
      checkedToday: Boolean(user.checkins[chinaDateKey(new Date())]),
      streak: checkinStreak(user.checkins),
      days: Object.keys(user.checkins).sort(),
    },
  };
}

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const store = JSON.parse(raw);
    return { users: {}, ...store };
  } catch (error) {
    if (error.code === "ENOENT") return { users: {} };
    throw error;
  }
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2));
}

function getOrCreateUser(store, username) {
  const normalized = String(username || "user").trim() || "user";
  if (!store.users[normalized]) {
    store.users[normalized] = {
      profile: {
        username: normalized,
        createdAt: new Date().toISOString(),
        lastLoginAt: "",
      },
      favorites: {},
      mistakes: {},
      stats: emptyStats(),
      progress: emptyProgress(),
      checkins: {},
    };
  }
  return store.users[normalized];
}

function emptyStats() {
  return {
    attempts: 0,
    correct: 0,
    totalSeconds: 0,
    byQuestion: {},
    daily: {},
    weekly: {},
    monthly: {},
    recentAttempts: [],
  };
}

function emptyQuestionStats() {
  return { attempts: 0, correct: 0, totalSeconds: 0, lastAt: "", lastAnswer: "" };
}

function emptyProgress() {
  return {
    lastBankId: "",
    lastQuestionId: "",
    currentByBank: {},
    mode: "random",
    typeFilter: "all",
  };
}

function incrementPeriod(bucket, key, correct, seconds) {
  const item = bucket[key] || { attempts: 0, correct: 0, totalSeconds: 0 };
  item.attempts += 1;
  item.correct += correct ? 1 : 0;
  item.totalSeconds += seconds;
  bucket[key] = item;
}

function chinaDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function chinaDateKey(date) {
  const { year, month, day } = chinaDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function chinaMonthKey(date) {
  const { year, month } = chinaDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function chinaWeekKey(date) {
  const { year, month, day } = chinaDateParts(date);
  const localAsUtc = new Date(Date.UTC(year, month - 1, day));
  const weekday = localAsUtc.getUTCDay() || 7;
  localAsUtc.setUTCDate(localAsUtc.getUTCDate() - weekday + 1);
  return localAsUtc.toISOString().slice(0, 10);
}

function checkinStreak(checkins) {
  const days = new Set(Object.keys(checkins));
  let streak = 0;
  const { year, month, day } = chinaDateParts(new Date());
  const cursor = new Date(Date.UTC(year, month - 1, day));
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
