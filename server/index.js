import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { answerQuestion, generateExplanation, getLlmConfig, gradeShortAnswer } from "./llmClient.js";
import { loadQuestions } from "./questionLoader.js";

dotenv.config();

const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "";
const AUTH_COOKIE_SECRET = process.env.AUTH_COOKIE_SECRET || crypto.randomBytes(32).toString("hex");
const AUTH_SESSION_DAYS = Number(process.env.AUTH_SESSION_DAYS) || 7;
const passwordHash = AUTH_PASSWORD ? bcrypt.hashSync(AUTH_PASSWORD, 10) : null;

const app = express();
const port = Number(process.env.PORT || 8787);
const questions = loadQuestions();
const byId = new Map(questions.map((question) => [question.id, question]));
const cacheDir = path.join(process.cwd(), ".cache");
const explanationCachePath = path.join(cacheDir, "ai-explanations.json");
const pregenState = {
  running: false,
  total: questions.length,
  done: 0,
  cached: 0,
  failed: 0,
  lastError: "",
};

app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser(AUTH_COOKIE_SECRET));

function requireAuth(req, res, next) {
  if (!passwordHash) return next();
  if (req.signedCookies.solvemate_auth === "true") return next();
  res.status(401).json({ error: "authentication required" });
}

app.get("/api/health", async (_req, res) => {
  const cache = await readExplanationCache();
  res.json({
    ok: true,
    questionCount: questions.length,
    ai: getLlmConfig(),
    explanationCacheCount: Object.keys(cache).length,
    pregen: pregenState,
  });
});

app.get("/api/questions", (_req, res) => {
  res.json({ questions });
});

app.get("/api/auth/status", (req, res) => {
  if (!passwordHash) return res.json({ authenticated: true, enabled: false });
  res.json({
    authenticated: req.signedCookies.solvemate_auth === "true",
    enabled: true,
  });
});

app.post("/api/auth/login", async (req, res) => {
  if (!passwordHash) return res.status(403).json({ error: "authentication is not configured" });
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "password is required" });
  const valid = await bcrypt.compare(password, passwordHash);
  if (!valid) return res.status(401).json({ error: "invalid password" });
  res.cookie("solvemate_auth", "true", {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    maxAge: AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
  res.json({ authenticated: true });
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("solvemate_auth", { path: "/" });
  res.json({ ok: true });
});

app.get("/api/questions/:id/explanation", requireAuth, async (req, res, next) => {
  try {
    const question = getQuestionOrThrow(req.params.id);
    const refresh = req.query.refresh === "1";
    const cacheOnly = req.query.cacheOnly === "1";
    const cache = await readExplanationCache();

    if (!refresh && cache[question.id]) {
      return res.json({ explanation: cache[question.id].content, cached: true });
    }

    if (cacheOnly) {
      return res.status(404).json({ error: "cached explanation not found" });
    }

    const explanation = await generateExplanation(question);
    cache[question.id] = {
      content: explanation,
      updatedAt: new Date().toISOString(),
    };
    await writeExplanationCache(cache);
    res.json({ explanation, cached: false });
  } catch (error) {
    next(error);
  }
});

app.post("/api/questions/:id/chat", requireAuth, async (req, res, next) => {
  try {
    const question = getQuestionOrThrow(req.params.id);
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "message is required" });
    const answer = await answerQuestion(question, message, req.body?.history || []);
    res.json({ answer });
  } catch (error) {
    next(error);
  }
});

app.post("/api/questions/:id/grade", requireAuth, async (req, res, next) => {
  try {
    const question = getQuestionOrThrow(req.params.id);
    if (question.type !== "short") {
      return res.status(400).json({ error: "only short-answer questions can be graded" });
    }
    const userAnswer = String(req.body?.answer || "").trim();
    if (!userAnswer) return res.status(400).json({ error: "answer is required" });
    const result = await gradeShortAnswer(question, userAnswer);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/explanations/prewarm", requireAuth, async (_req, res) => {
  if (pregenState.running) {
    return res.json({ started: false, pregen: pregenState });
  }
  runExplanationPrewarm().catch((error) => {
    pregenState.running = false;
    pregenState.lastError = error.message;
  });
  res.json({ started: true, pregen: pregenState });
});

const dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(dirname, "..", "dist");
app.use(express.static(clientDist));
app.use(async (_req, res, next) => {
  try {
    await fs.access(path.join(clientDist, "index.html"));
    res.sendFile(path.join(clientDist, "index.html"));
  } catch (error) {
    next();
  }
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || "Internal server error",
  });
});

app.listen(port, () => {
  console.log(`SolveMate API running at http://localhost:${port}`);
  if (process.env.AI_PREGENERATE_ON_START !== "false" && getLlmConfig().configured) {
    runExplanationPrewarm().catch((error) => {
      pregenState.running = false;
      pregenState.lastError = error.message;
    });
  }
});

function getQuestionOrThrow(id) {
  const question = byId.get(id);
  if (!question) {
    const error = new Error("question not found");
    error.status = 404;
    throw error;
  }
  return question;
}

async function readExplanationCache() {
  try {
    const raw = await fs.readFile(explanationCachePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeExplanationCache(cache) {
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(explanationCachePath, JSON.stringify(cache, null, 2));
}

async function runExplanationPrewarm() {
  if (!getLlmConfig().configured) {
    pregenState.lastError = "LLM_API_KEY is not configured";
    return;
  }

  pregenState.running = true;
  pregenState.done = 0;
  pregenState.cached = 0;
  pregenState.failed = 0;
  pregenState.lastError = "";

  const cache = await readExplanationCache();
  for (const question of questions) {
    if (cache[question.id]) {
      pregenState.cached += 1;
      pregenState.done += 1;
      continue;
    }

    try {
      const explanation = await generateExplanation(question);
      cache[question.id] = {
        content: explanation,
        updatedAt: new Date().toISOString(),
      };
      await writeExplanationCache(cache);
    } catch (error) {
      pregenState.failed += 1;
      pregenState.lastError = error.message;
    } finally {
      pregenState.done += 1;
    }
  }

  pregenState.running = false;
}
