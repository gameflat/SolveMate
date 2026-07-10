import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import { answerQuestion, chatCompletion, generateExplanation, getLlmConfig, gradeShortAnswer } from "./llmClient.js";
import { loadQuestionBanks, publicBankMeta, readQuestionBankPayload, writeQuestionBankPayload } from "./questionLoader.js";
import {
  buildConfiguredUsers,
  checkIn,
  ensureUser,
  getUserState,
  recordAttempt,
  resetUser,
  saveProgress,
  setFavorite,
  verifyConfiguredUser,
} from "./userStore.js";

dotenv.config();

const AUTH_COOKIE_SECRET = process.env.AUTH_COOKIE_SECRET || crypto.randomBytes(32).toString("hex");
const AUTH_SESSION_DAYS = Number(process.env.AUTH_SESSION_DAYS) || 7;
const configuredUsers = buildConfiguredUsers();

const app = express();
const port = Number(process.env.PORT || 8787);
const execFileAsync = promisify(execFile);
let questionBankPayload = loadQuestionBanks();
let banks = questionBankPayload.banks;
let questions = questionBankPayload.questions;
let byId = new Map(questions.map((question) => [question.id, question]));
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
app.use(express.json({ limit: "24mb" }));
app.use(cookieParser(AUTH_COOKIE_SECRET));

function requireAuth(req, res, next) {
  if (!configuredUsers.size) {
    req.username = "local";
    return next();
  }
  const username = req.signedCookies.solvemate_user;
  if (username && configuredUsers.has(username)) {
    req.username = username;
    return next();
  }
  res.status(401).json({ error: "authentication required" });
}

app.get("/api/health", async (_req, res) => {
  const cache = await readExplanationCache();
  res.json({
    ok: true,
    questionCount: questions.length,
    defaultBankId: questionBankPayload.defaultBankId,
    banks: banks.map(publicBankMeta),
    ai: getLlmConfig(),
    explanationCacheCount: Object.keys(cache).length,
    pregen: pregenState,
  });
});

app.get("/api/banks", requireAuth, (_req, res) => {
  res.json({
    defaultBankId: questionBankPayload.defaultBankId,
    banks: banks.map(publicBankMeta),
  });
});

app.get("/api/questions", requireAuth, (req, res) => {
  const bankId = String(req.query.bankId || questionBankPayload.defaultBankId);
  const bank = banks.find((item) => item.id === bankId) || banks[0];
  res.json({
    defaultBankId: questionBankPayload.defaultBankId,
    banks: banks.map(publicBankMeta),
    activeBankId: bank?.id || "",
    questions: bank?.questions || questions,
  });
});

app.patch("/api/banks/:id", requireAuth, async (req, res, next) => {
  try {
    const payload = readQuestionBankPayload();
    const bank = payload.banks.find((item) => item.id === req.params.id);
    if (!bank) return res.status(404).json({ error: "bank not found" });
    const name = sanitizeText(req.body?.name, 80);
    const label = sanitizeText(req.body?.label, 24);
    if (!name) return res.status(400).json({ error: "bank name is required" });
    bank.name = name;
    bank.label = label;
    bank.updatedAt = new Date().toISOString();
    writeQuestionBankPayload(payload);
    reloadQuestionBanks();
    res.json({ bank: publicBankMeta(banks.find((item) => item.id === bank.id)) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/banks/:id", requireAuth, async (req, res, next) => {
  try {
    const payload = readQuestionBankPayload();
    const bankIndex = payload.banks.findIndex((item) => item.id === req.params.id);
    if (bankIndex < 0) return res.status(404).json({ error: "bank not found" });
    if (payload.banks.length <= 1) return res.status(400).json({ error: "至少需要保留一个题库" });
    const bank = payload.banks[bankIndex];
    const backup = await createQuestionBankBackup({
      type: "pre-delete",
      username: req.username,
      bankId: bank.id,
      bankName: bank.name,
      questionCount: Array.isArray(bank.questions) ? bank.questions.length : 0,
    });
    payload.banks.splice(bankIndex, 1);
    if (payload.defaultBankId === bank.id) payload.defaultBankId = payload.banks[0].id;
    writeQuestionBankPayload(payload);
    reloadQuestionBanks();
    res.json({
      defaultBankId: questionBankPayload.defaultBankId,
      banks: banks.map(publicBankMeta),
      backup,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/banks/default", requireAuth, async (req, res, next) => {
  try {
    const bankId = String(req.body?.bankId || "");
    const payload = readQuestionBankPayload();
    if (!payload.banks.some((bank) => bank.id === bankId)) {
      return res.status(404).json({ error: "bank not found" });
    }
    payload.defaultBankId = bankId;
    writeQuestionBankPayload(payload);
    reloadQuestionBanks();
    res.json({ defaultBankId: questionBankPayload.defaultBankId, banks: banks.map(publicBankMeta) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/banks/import", requireAuth, async (req, res, next) => {
  try {
    const fileName = sanitizeFileName(req.body?.fileName);
    const contentBase64 = String(req.body?.contentBase64 || "").split(",").pop();
    const targetMode = req.body?.targetMode === "existing" ? "existing" : "new";
    const bankName = sanitizeText(req.body?.bankName, 80);
    const bankLabel = sanitizeText(req.body?.bankLabel, 24) || "导入题库";
    const aiAssist = Boolean(req.body?.aiAssist);
    if (!fileName || !contentBase64) return res.status(400).json({ error: "file is required" });
    if (targetMode === "new" && !bankName) return res.status(400).json({ error: "bank name is required" });

    const buffer = Buffer.from(contentBase64, "base64");
    if (!buffer.length) return res.status(400).json({ error: "uploaded file is empty" });
    if (buffer.length > 18 * 1024 * 1024) return res.status(400).json({ error: "file is too large; max 18MB" });

    const storedFile = await saveImportFile(fileName, buffer);
    const parsed = await parseImportFile(storedFile.absolutePath);
    const strictIssue = !parsed.questions.length || (parsed.warnings || []).length > 0;
    const aiResult = await maybeParseWithLlm({
      aiAssist,
      fileName,
      parsedQuestions: parsed.questions,
      sourceText: parsed.sourceText || "",
      warnings: parsed.warnings || [],
      required: strictIssue,
    });
    if (strictIssue && !aiResult.questions.length) {
      return res.status(400).json({
        error: aiAssist
          ? "题库解析存在不确定内容，AI 未能生成可安全导入的结构化题目。"
          : "题库解析存在不确定内容，已停止导入以防污染题库。",
        warnings: parsed.warnings || [],
        ai: aiResult.report,
      });
    }
    const importedQuestions = strictIssue ? aiResult.questions : parsed.questions;
    if (!importedQuestions.length) {
      return res.status(400).json({
        error: "未能识别出可安全导入的题目，请整理文件后重试。",
        warnings: parsed.warnings || [],
        ai: aiResult.report,
      });
    }

    const payload = readQuestionBankPayload();
    const now = new Date().toISOString();
    let bank;
    if (targetMode === "existing") {
      bank = payload.banks.find((item) => item.id === String(req.body?.targetBankId || ""));
      if (!bank) return res.status(404).json({ error: "target bank not found" });
      bank.updatedAt = now;
    } else {
      bank = {
        id: createBankId(bankName || fileName, payload.banks),
        name: bankName,
        label: bankLabel,
        source: storedFile.relativePath,
        isLegacy: false,
        importedAt: now,
        updatedAt: now,
        questions: [],
      };
      payload.banks.unshift(bank);
      payload.defaultBankId = bank.id;
    }

    const normalizedQuestions = normalizeImportedQuestions(importedQuestions, bank, storedFile.relativePath);
    if (normalizedQuestions.length !== importedQuestions.length) {
      return res.status(400).json({
        error: "导入题目规范化时发现不完整数据，已停止导入。",
        warnings: parsed.warnings || [],
        ai: aiResult.report,
      });
    }
    const backup = await createQuestionBankBackup({
      username: req.username,
      fileName,
      targetMode,
      targetBankId: req.body?.targetBankId || "",
      bankName,
      importedCount: normalizedQuestions.length,
    });
    bank.questions.push(...normalizedQuestions);
    if (targetMode === "existing") {
      bank.source = bank.source ? `${bank.source}; ${storedFile.relativePath}` : storedFile.relativePath;
    }
    writeQuestionBankPayload(payload);
    reloadQuestionBanks();
    const reloadedBank = banks.find((item) => item.id === bank.id);
    res.json({
      bank: publicBankMeta(reloadedBank),
      defaultBankId: questionBankPayload.defaultBankId,
      importedCount: normalizedQuestions.length,
      warnings: parsed.warnings || [],
      ai: aiResult.report,
      backup,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/status", (req, res) => {
  if (!configuredUsers.size) return res.json({ authenticated: true, enabled: false, username: "local" });
  const username = req.signedCookies.solvemate_user;
  res.json({
    authenticated: Boolean(username && configuredUsers.has(username)),
    enabled: true,
    username: username || "",
  });
});

app.post("/api/auth/login", async (req, res) => {
  if (!configuredUsers.size) return res.status(403).json({ error: "authentication is not configured" });
  const { username, password } = req.body || {};
  if (!password) return res.status(400).json({ error: "password is required" });
  const fallbackUsername = configuredUsers.size === 1 ? [...configuredUsers.keys()][0] : "";
  const verifiedUsername = await verifyConfiguredUser(configuredUsers, username || fallbackUsername, password);
  if (!verifiedUsername) return res.status(401).json({ error: "invalid username or password" });
  await ensureUser(verifiedUsername);
  res.cookie("solvemate_user", verifiedUsername, {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    maxAge: AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
  res.json({ authenticated: true, username: verifiedUsername });
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("solvemate_user", { path: "/" });
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, async (req, res, next) => {
  try {
    res.json(await getUserState(req.username));
  } catch (error) {
    next(error);
  }
});

app.post("/api/me/favorite", requireAuth, async (req, res, next) => {
  try {
    const question = getQuestionOrThrow(req.body?.questionId);
    res.json(await setFavorite(req.username, question.id, Boolean(req.body?.favorite)));
  } catch (error) {
    next(error);
  }
});

app.post("/api/me/attempt", requireAuth, async (req, res, next) => {
  try {
    const question = getQuestionOrThrow(req.body?.questionId);
    res.json(
      await recordAttempt(req.username, {
        questionId: question.id,
        bankId: question.bankId,
        answer: req.body?.answer,
        correct: req.body?.correct,
        seconds: req.body?.seconds,
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.post("/api/me/progress", requireAuth, async (req, res, next) => {
  try {
    if (req.body?.questionId) getQuestionOrThrow(req.body.questionId);
    res.json(await saveProgress(req.username, req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.post("/api/me/checkin", requireAuth, async (req, res, next) => {
  try {
    res.json(await checkIn(req.username));
  } catch (error) {
    next(error);
  }
});

app.post("/api/me/reset", requireAuth, async (req, res, next) => {
  try {
    res.json(await resetUser(req.username));
  } catch (error) {
    next(error);
  }
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
  if (process.env.AI_PREGENERATE_ON_START === "true" && getLlmConfig().configured) {
    runExplanationPrewarm().catch((error) => {
      pregenState.running = false;
      pregenState.lastError = error.message;
    });
  }
});

function reloadQuestionBanks() {
  questionBankPayload = loadQuestionBanks();
  banks = questionBankPayload.banks;
  questions = questionBankPayload.questions;
  byId = new Map(questions.map((question) => [question.id, question]));
  pregenState.total = questions.length;
}

function getQuestionOrThrow(id) {
  const question = byId.get(id);
  if (!question) {
    const error = new Error("question not found");
    error.status = 404;
    throw error;
  }
  return question;
}

function sanitizeText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeFileName(value) {
  const fileName = path.basename(String(value || "")).replace(/[^\w.\-\u4e00-\u9fa5（）() ]/g, "_");
  if (!fileName) return "";
  const ext = path.extname(fileName).toLowerCase();
  if (![".xlsx", ".xlsm", ".csv", ".docx", ".txt", ".md"].includes(ext)) {
    const error = new Error("unsupported file type; use xlsx, xlsm, csv, docx, txt or md");
    error.status = 400;
    throw error;
  }
  return fileName;
}

async function saveImportFile(fileName, buffer) {
  const dir = path.join(process.cwd(), "Question Bank", "imports");
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = crypto.randomBytes(4).toString("hex");
  const storedName = `${stamp}-${suffix}-${fileName}`;
  const absolutePath = path.join(dir, storedName);
  await fs.writeFile(absolutePath, buffer);
  return {
    absolutePath,
    relativePath: path.relative(process.cwd(), absolutePath),
  };
}

async function parseImportFile(filePath) {
  const scriptPath = path.join(process.cwd(), "scripts", "parse_question_import.py");
  const { stdout } = await execFileAsync("python3", [scriptPath, filePath], {
    cwd: process.cwd(),
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function createQuestionBankBackup(meta) {
  const backupId = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(4).toString("hex")}`;
  const backupDir = path.join(process.cwd(), "data", "import-backups", backupId);
  const questionBanksPath = path.join(process.cwd(), "data", "question-banks.json");
  await fs.mkdir(backupDir, { recursive: true });
  await fs.copyFile(questionBanksPath, path.join(backupDir, "question-banks.json"));
  const manifest = {
    id: backupId,
    createdAt: new Date().toISOString(),
    type: "pre-import",
    ...meta,
  };
  await fs.writeFile(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    id: backupId,
    path: path.relative(process.cwd(), backupDir),
  };
}

async function maybeParseWithLlm({ aiAssist, fileName, parsedQuestions, sourceText, warnings, required }) {
  const report = {
    used: false,
    configured: getLlmConfig().configured,
    reason: "",
    count: 0,
  };
  if (!aiAssist) {
    report.reason = "disabled";
    return { questions: [], report };
  }
  if (!getLlmConfig().configured) {
    report.reason = "LLM_API_KEY is not configured";
    return { questions: [], report };
  }
  if (!sourceText.trim()) {
    report.reason = "no source text available";
    return { questions: [], report };
  }
  if (!required) {
    report.reason = "rule parser produced clean result";
    return { questions: [], report };
  }

  try {
    const content = await chatCompletion(
      [
        {
          role: "system",
          content:
            "你是题库导入清洗助手。只返回 JSON，不要 Markdown。JSON 格式为 {\"questions\":[{\"prompt\":\"\",\"rawType\":\"\",\"type\":\"single|multiple|judge|fill|short|unknown\",\"options\":[{\"key\":\"A\",\"text\":\"\"}],\"answer\":\"\"}],\"warnings\":[\"\"]}。必须保留中文原意，不要编造题目或答案；无法确定答案的题目不要输出。",
        },
        {
          role: "user",
          content: `文件名：${fileName}\n以下是待清洗题库文本，请提取可确定答案的题目：\n\n${sourceText.slice(0, 18000)}`,
        },
      ],
      { temperature: 0 },
    );

    const parsed = JSON.parse(stripJsonFence(content));
    const questions = normalizeLlmQuestions(parsed.questions || []);
    report.used = true;
    report.count = questions.length;
    report.reason = questions.length ? "used llm result" : "llm result contained no importable questions";
    return {
      questions,
      report,
    };
  } catch (error) {
    report.reason = `AI parse failed: ${error.message}`;
    return { questions: [], report };
  }
}

function normalizeLlmQuestions(items) {
  return items
    .map((item, index) => {
      const prompt = sanitizeText(item?.prompt, 2000);
      const answer = sanitizeText(item?.answer, 2000);
      const options = Array.isArray(item?.options)
        ? item.options
            .map((option, optionIndex) => ({
              key: sanitizeText(option?.key, 1).toUpperCase() || "ABCDEFG"[optionIndex] || "",
              text: sanitizeText(option?.text, 1000),
            }))
            .filter((option) => option.key && option.text)
        : [];
      const type = normalizeQuestionType(item?.type, item?.rawType, prompt, answer, options);
      if (!prompt || !answer) return null;
      return {
        sourceIndex: index + 1,
        prompt,
        rawType: sanitizeText(item?.rawType, 32) || defaultRawType(type),
        type,
        options: type === "judge" && !options.length ? judgeOptions() : options,
        answer: type === "judge" ? normalizeJudgeAnswer(answer) : answer,
        answerKeys: answerKeys(answer, type),
      };
    })
    .filter(Boolean);
}

function normalizeImportedQuestions(items, bank, sourcePath) {
  const existingIds = new Set((bank.questions || []).map((question) => question.id));
  const startIndex = (bank.questions || []).length;
  return items
    .map((item, index) => {
      const prompt = sanitizeText(item.prompt, 3000);
      const answer = sanitizeText(item.answer, 3000);
      const type = normalizeQuestionType(item.type, item.rawType, prompt, answer, item.options);
      const options = normalizeOptions(item.options, type);
      if (!prompt || !answer) return null;
      const sourceIndex = startIndex + index + 1;
      let id = stableQuestionId(bank.id, sourceIndex, prompt, answer);
      let counter = 1;
      while (existingIds.has(id)) {
        id = stableQuestionId(bank.id, `${sourceIndex}-${counter}`, prompt, answer);
        counter += 1;
      }
      existingIds.add(id);
      const normalizedAnswer = type === "judge" ? normalizeJudgeAnswer(answer) : answer;
      return {
        id,
        bankId: bank.id,
        excelRow: item.excelRow || undefined,
        sourceIndex,
        prompt,
        rawType: sanitizeText(item.rawType, 32) || defaultRawType(type),
        type,
        options,
        answer: normalizedAnswer,
        answerKeys: answerKeys(normalizedAnswer, type),
        source: sourcePath,
      };
    })
    .filter(Boolean);
}

function createBankId(name, existingBanks) {
  const slug =
    String(name || "import")
      .trim()
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36) || "import";
  const existingIds = new Set(existingBanks.map((bank) => bank.id));
  let id = `${slug}-${crypto.randomBytes(3).toString("hex")}`;
  while (existingIds.has(id)) id = `${slug}-${crypto.randomBytes(3).toString("hex")}`;
  return id;
}

function stableQuestionId(bankId, sourceIndex, prompt, answer) {
  return crypto.createHash("sha1").update(`${bankId}:${sourceIndex}:${prompt}:${answer}`).digest("hex").slice(0, 12);
}

function normalizeOptions(options, type) {
  if (type === "judge") return judgeOptions();
  if (!Array.isArray(options)) return [];
  const seen = new Set();
  return options
    .map((option, index) => ({
      key: sanitizeText(option?.key, 1).toUpperCase() || "ABCDEFG"[index] || "",
      text: sanitizeText(option?.text, 1000),
    }))
    .filter((option) => {
      if (!option.key || !option.text || seen.has(option.key)) return false;
      seen.add(option.key);
      return true;
    });
}

function normalizeQuestionType(type, rawType, prompt, answer, options = []) {
  const value = `${type || ""} ${rawType || ""} ${prompt || ""}`.toLowerCase();
  if (/multiple|多选|多项/.test(value)) return "multiple";
  if (/single|单选|单项/.test(value)) return "single";
  if (/judge|判断|对错|是非/.test(value)) return "judge";
  if (/fill|填空/.test(value)) return "fill";
  if (/short|简答|问答|计算|论述|分析/.test(value)) return "short";
  if (Array.isArray(options) && options.length) return answerKeys(answer, "single").length > 1 ? "multiple" : "single";
  if (/正确|错误|√|×|对|错/.test(String(answer || "")) && /[（(]\s*[）)]|判断/.test(String(prompt || ""))) return "judge";
  return "short";
}

function defaultRawType(type) {
  return {
    single: "单选题",
    multiple: "多选题",
    judge: "判断题",
    fill: "填空题",
    short: "简答题",
    unknown: "其他",
  }[type || "unknown"];
}

function judgeOptions() {
  return [
    { key: "A", text: "正确" },
    { key: "B", text: "错误" },
  ];
}

function normalizeJudgeAnswer(answer) {
  const value = String(answer || "");
  if (/√|对|正确|是|true/i.test(value)) return "正确";
  if (/×|错|错误|否|false/i.test(value)) return "错误";
  return sanitizeText(value, 1000);
}

function answerKeys(answer, questionType) {
  if (!["single", "multiple"].includes(questionType)) return [];
  return Array.from(String(answer || "").toUpperCase().matchAll(/[A-G]/g), (match) => match[0]);
}

function stripJsonFence(text) {
  return String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
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
