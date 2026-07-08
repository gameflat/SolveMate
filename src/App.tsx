import {
  ArrowLeft,
  BarChart3,
  Bookmark,
  Brain,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock3,
  FileUp,
  Library,
  ListChecks,
  ListFilter,
  LogOut,
  Menu,
  MessageSquareText,
  RefreshCcw,
  RotateCw,
  Save,
  Settings,
  Search,
  Sparkles,
  Star,
  Target,
  Timer,
  Trophy,
  X,
  XCircle,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type QuestionType = "single" | "multiple" | "judge" | "fill" | "short" | "unknown";
type PracticeMode = "random" | "sequential" | "favorites" | "mistakes";
type QuickBrowseFilter = "all" | "unanswered" | "answered";
type View = "practice" | "bank" | "manage" | "stats" | "mistakes" | "favorites" | "ai" | "feed";

type Question = {
  id: string;
  bankId: string;
  excelRow?: number;
  sourceIndex: number;
  prompt: string;
  rawType: string;
  type: QuestionType;
  options: { key: string; text: string }[];
  answer: string;
  answerKeys: string[];
};

type BankMeta = {
  id: string;
  name: string;
  label: string;
  source: string;
  isLegacy: boolean;
  questionCount: number;
  updatedAt?: string;
  importedAt?: string;
};

type PeriodStat = { attempts: number; correct: number; totalSeconds: number };
type QuestionStat = PeriodStat & { lastAt?: string; lastAnswer?: string };
type SessionResult = { correct: boolean; answer: string; message: string; score?: number; feedback?: string; updatedAt?: string };
type PracticeSession = { currentQuestionId: string; order: string[]; index: number; results?: Record<string, SessionResult>; updatedAt?: string };

type UserState = {
  username: string;
  favorites: string[];
  mistakes: Record<string, { count: number; lastAt: string; lastAnswer: string }>;
  stats: PeriodStat & {
    byQuestion: Record<string, QuestionStat>;
    daily: Record<string, PeriodStat>;
    weekly: Record<string, PeriodStat>;
    monthly: Record<string, PeriodStat>;
    recentAttempts: { questionId: string; bankId: string; correct: boolean; seconds: number; answer: string; at: string; dayKey: string }[];
  };
  progress: {
    lastBankId: string;
    lastQuestionId: string;
    currentByBank: Record<string, string>;
    mode: PracticeMode;
    typeFilter: QuestionType | "all";
    sessions?: Record<string, PracticeSession>;
  };
  checkins: { checkedToday: boolean; streak: number; days: string[]; requiredCorrect?: number; todayCorrect?: number; unlocked?: boolean };
};

type ResultState = {
  correct: boolean;
  message: string;
  score?: number;
  feedback?: string;
};

type Health = {
  questionCount: number;
  defaultBankId: string;
  banks: BankMeta[];
  ai: { configured: boolean; model: string; baseUrl: string };
  explanationCacheCount: number;
  pregen: { running: boolean; total: number; done: number; cached: number; failed: number; lastError: string };
};

type ChatMessage = { role: "user" | "assistant"; content: string };
type BankImportRequest = {
  file: File;
  targetMode: "new" | "existing";
  targetBankId: string;
  bankName: string;
  bankLabel: string;
  aiAssist: boolean;
};
type BankImportResult = {
  importedCount: number;
  warnings: { reason?: string; row?: number; block?: number; prompt?: string; text?: string }[];
  ai: { used: boolean; configured: boolean; reason: string; count: number };
  bank: BankMeta;
};

const EMPTY_STATE: UserState = {
  username: "",
  favorites: [],
  mistakes: {},
  stats: { attempts: 0, correct: 0, totalSeconds: 0, byQuestion: {}, daily: {}, weekly: {}, monthly: {}, recentAttempts: [] },
  progress: { lastBankId: "", lastQuestionId: "", currentByBank: {}, mode: "random", typeFilter: "all", sessions: {} },
  checkins: { checkedToday: false, streak: 0, days: [] },
};

const typeLabels: Record<QuestionType, string> = {
  single: "单选",
  multiple: "多选",
  judge: "判断",
  fill: "填空",
  short: "问答",
  unknown: "其他",
};

const modeLabels: Record<PracticeMode, string> = {
  random: "随机",
  sequential: "顺序",
  favorites: "收藏",
  mistakes: "错题",
};

const bankTypeOptions = ["all", "single", "multiple", "judge", "fill", "short", "unknown"] as const;

const viewLabels: Record<View, string> = {
  practice: "练习",
  bank: "题库",
  manage: "管理",
  stats: "用户主页",
  mistakes: "错题",
  favorites: "收藏",
  ai: "AI",
  feed: "投食",
};

export function App() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [banks, setBanks] = useState<BankMeta[]>([]);
  const [activeBankId, setActiveBankId] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [activeView, setActiveView] = useState<View>("practice");
  const [typeFilter, setTypeFilter] = useState<QuestionType | "all">("all");
  const [bankTypeFilter, setBankTypeFilter] = useState<QuestionType | "all">("all");
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("random");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [quickBrowserOpen, setQuickBrowserOpen] = useState(false);
  const [quickBrowserFilter, setQuickBrowserFilter] = useState<QuickBrowseFilter>("all");
  const [quickBrowserSearch, setQuickBrowserSearch] = useState("");
  const [currentId, setCurrentId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [textAnswer, setTextAnswer] = useState("");
  const [fillAnswers, setFillAnswers] = useState<string[]>([]);
  const [bankSearch, setBankSearch] = useState("");
  const [result, setResult] = useState<ResultState | null>(null);
  const [userState, setUserState] = useState<UserState>(EMPTY_STATE);
  const [explanation, setExplanation] = useState("");
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [authenticated, setAuthenticated] = useState<"loading" | true | false>("loading");
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => chinaMonthKey());
  const startedAt = useRef(Date.now());
  const currentIdRef = useRef("");
  const booted = useRef(false);
  const promptedCheckinKey = useRef("");

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!quickBrowserOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setQuickBrowserOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [quickBrowserOpen]);

  useEffect(() => {
    currentIdRef.current = currentId;
    startedAt.current = Date.now();
    setElapsed(0);
    setSelected([]);
    setTextAnswer("");
    const nextQuestion = questions.find((question) => question.id === currentId);
    setFillAnswers(Array.from({ length: nextQuestion?.type === "fill" ? getBlankCount(nextQuestion) : 0 }, () => ""));
    setResult(null);
    setExplanation("");
    setChat([]);
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [currentId, questions]);

  const activeBank = banks.find((bank) => bank.id === activeBankId);
  const filtered = useMemo(() => {
    const base = typeFilter === "all" ? questions : questions.filter((question) => question.type === typeFilter);
    if (practiceMode === "mistakes") return base.filter((question) => userState.mistakes[question.id]);
    if (practiceMode === "favorites") return base.filter((question) => userState.favorites.includes(question.id));
    return base;
  }, [questions, typeFilter, practiceMode, userState.mistakes, userState.favorites]);

  const practiceKey = getProgressKey(activeBankId, practiceMode, typeFilter);
  const activeSession = userState.progress.sessions?.[practiceKey];
  const activeOrder = useMemo(
    () => getPracticeOrder(filtered, activeSession, practiceMode),
    [filtered, activeSession, practiceMode],
  );

  useEffect(() => {
    if (!booted.current || !currentId) return;
    const order = activeOrder.length ? activeOrder : filtered.map((question) => question.id);
    const index = Math.max(0, order.indexOf(currentId));
    void authJson("/api/me/progress", {
      method: "POST",
      body: JSON.stringify({
        bankId: activeBankId,
        questionId: currentId,
        mode: practiceMode,
        typeFilter,
        session: { key: practiceKey, currentQuestionId: currentId, order, index, results: activeSession?.results || {} },
      }),
    }).then(setUserState);
  }, [activeBankId, currentId, practiceMode, typeFilter, practiceKey]);

  useEffect(() => {
    if (!booted.current || !filtered.length) return;
    const savedSession = activeSession;
    if (savedSession?.currentQuestionId && filtered.some((question) => question.id === savedSession.currentQuestionId)) {
      if (currentId !== savedSession.currentQuestionId) setCurrentId(savedSession.currentQuestionId);
      return;
    }
    if (filtered.some((question) => question.id === currentId)) return;
    const session = createPracticeSession(filtered, practiceMode, savedSession);
    if (session.currentQuestionId) setCurrentId(session.currentQuestionId);
  }, [filtered, practiceMode, practiceKey, activeSession]);

  const current = useMemo(
    () => filtered.find((question) => question.id === currentId) || filtered[0] || questions[0],
    [questions, currentId, filtered],
  );
  const currentIndex = useMemo(() => activeOrder.findIndex((id) => id === current?.id), [activeOrder, current]);
  const orderedPracticeQuestions = useMemo(() => {
    const byId = new Map(filtered.map((question) => [question.id, question]));
    const ordered = activeOrder.map((id) => byId.get(id)).filter(Boolean) as Question[];
    return ordered.length ? ordered : filtered;
  }, [activeOrder, filtered]);
  const bankQuestions = useMemo(() => {
    const term = normalizeSearch(bankSearch);
    const source = bankTypeFilter === "all" ? questions : questions.filter((question) => question.type === bankTypeFilter);
    if (!term) return source;
    return source.filter((question) =>
      normalizeSearch(`${question.sourceIndex} ${question.rawType} ${question.prompt} ${question.answer}`).includes(term),
    );
  }, [questions, bankTypeFilter, bankSearch]);
  const visibleMistakes = useMemo(
    () => Object.keys(userState.mistakes).map((id) => questions.find((question) => question.id === id)).filter(Boolean) as Question[],
    [questions, userState.mistakes],
  );
  const favoriteQuestions = useMemo(
    () => userState.favorites.map((id) => questions.find((question) => question.id === id)).filter(Boolean) as Question[],
    [questions, userState.favorites],
  );
  const practiceProgress = useMemo(() => {
    const total = filtered.length;
    const sessionResults = activeSession?.results || {};
    const completed = filtered.filter((question) => sessionResults[question.id]).length;
    const correct = filtered.filter((question) => sessionResults[question.id]?.correct).length;
    return {
      total,
      completed,
      correct,
      percent: total ? Math.round((completed / total) * 100) : 0,
    };
  }, [filtered, activeSession]);

  const accuracy = userState.stats.attempts ? Math.round((userState.stats.correct / userState.stats.attempts) * 100) : 0;
  const averageSeconds = userState.stats.attempts ? Math.round(userState.stats.totalSeconds / userState.stats.attempts) : 0;
  const isFavorite = current ? userState.favorites.includes(current.id) : false;
  const currentSessionResult = current ? activeSession?.results?.[current.id] : undefined;
  const rememberedResult = useMemo<ResultState | null>(() => {
    if (!current || result || !currentSessionResult) return null;
    const answerText = currentSessionResult.answer ? `你的答案：${currentSessionResult.answer}` : "";
    return {
      correct: currentSessionResult.correct,
      message: currentSessionResult.message || (currentSessionResult.correct ? "本模式已答对" : "本模式已答错"),
      score: currentSessionResult.score,
      feedback: [answerText, currentSessionResult.feedback].filter(Boolean).join(" · "),
    };
  }, [current, currentSessionResult, result]);
  const visibleResult = result || rememberedResult;
  const answeredFromHistory = Boolean(rememberedResult && !result);
  const checkinUnlocked = Boolean(userState.checkins.checkedToday || userState.checkins.unlocked);
  const checkinReady = checkinUnlocked && !userState.checkins.checkedToday;
  const checkinRequiredCorrect = userState.checkins.requiredCorrect || 10;

  async function bootstrap() {
    try {
      const authRes = await fetch("/api/auth/status");
      const authData = await authRes.json();
      if (!authData.authenticated) {
        setAuthenticated(false);
        return;
      }
      setAuthenticated(true);
      const [me, bankPayload, healthPayload] = await Promise.all([
        authJson("/api/me"),
        authJson("/api/banks"),
        fetch("/api/health").then((res) => res.json()),
      ]);
      setUserState(me);
      setBanks(bankPayload.banks);
      setHealth(healthPayload);
      setPracticeMode(normalizePracticeMode(me.progress.mode));
      setTypeFilter(me.progress.typeFilter || "all");
      if (!me.checkins.checkedToday) {
        const promptKey = `${me.username || "local"}:${chinaDateKey()}`;
        if (promptedCheckinKey.current !== promptKey) {
          promptedCheckinKey.current = promptKey;
          setShowCheckinModal(true);
        }
      }
      const nextBankId = me.progress.lastBankId || bankPayload.defaultBankId;
      await loadBank(nextBankId, me.progress.currentByBank[nextBankId] || me.progress.lastQuestionId);
      booted.current = true;
    } catch {
      setAuthenticated(false);
    }
  }

  async function loadBank(bankId: string, preferredQuestionId = "") {
    const payload = await authJson(`/api/questions?bankId=${encodeURIComponent(bankId)}`);
    setQuestions(payload.questions);
    setBanks(payload.banks);
    setActiveBankId(payload.activeBankId);
    const fallback = payload.questions[0]?.id || "";
    setCurrentId(payload.questions.some((question: Question) => question.id === preferredQuestionId) ? preferredQuestionId : fallback);
  }

  async function authJson(input: RequestInfo, init?: RequestInit) {
    const res = await fetch(input, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const payload = await res.json().catch(() => ({}));
    if (res.status === 401) {
      setAuthenticated(false);
      throw new Error("会话已过期，请重新登录");
    }
    if (!res.ok) throw new Error(payload.error || "请求失败");
    return payload;
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthenticated(false);
  }

  async function updateBankMeta(bankId: string, name: string, label: string) {
    const payload = await authJson(`/api/banks/${encodeURIComponent(bankId)}`, {
      method: "PATCH",
      body: JSON.stringify({ name, label }),
    });
    setBanks((old) => old.map((bank) => (bank.id === payload.bank.id ? payload.bank : bank)));
    setStatus("题库信息已保存。");
  }

  async function updateDefaultBank(bankId: string) {
    const payload = await authJson("/api/banks/default", {
      method: "POST",
      body: JSON.stringify({ bankId }),
    });
    setBanks(payload.banks);
    await loadBank(bankId);
    setStatus("默认题库已更新。");
  }

  async function importQuestionBank(request: BankImportRequest) {
    const contentBase64 = await fileToBase64(request.file);
    const payload = await authJson("/api/banks/import", {
      method: "POST",
      body: JSON.stringify({
        fileName: request.file.name,
        contentBase64,
        targetMode: request.targetMode,
        targetBankId: request.targetBankId,
        bankName: request.bankName,
        bankLabel: request.bankLabel,
        aiAssist: request.aiAssist,
      }),
    });
    const bankId = payload.bank.id;
    setStatus(`已导入 ${payload.importedCount} 道题。`);
    await loadBank(bankId);
    const banksPayload = await authJson("/api/banks");
    setBanks(banksPayload.banks);
    return payload as BankImportResult;
  }

  function chooseQuestion(id: string) {
    setCurrentId(id);
    setActiveView("practice");
  }

  function chooseQuestionFromBrowser(id: string) {
    chooseQuestion(id);
    setQuickBrowserOpen(false);
  }

  function openView(view: View) {
    setActiveView(view);
    setMobileNavOpen(false);
    setQuickBrowserOpen(false);
  }

  function changePracticeMode(mode: PracticeMode) {
    setPracticeMode(mode);
    setActiveView("practice");
    const pool = getPracticePool(questions, typeFilter, mode, userState);
    if (!pool.length) {
      setStatus(emptyPoolMessage(mode));
      return;
    }
    const key = getProgressKey(activeBankId, mode, typeFilter);
    const session = createPracticeSession(pool, mode, userState.progress.sessions?.[key]);
    setCurrentId(session.currentQuestionId);
  }

  function changeTypeFilter(type: QuestionType | "all") {
    setTypeFilter(type);
    const pool = getPracticePool(questions, type, practiceMode, userState);
    if (!pool.length) {
      setStatus("当前筛选条件下没有题目。");
      return;
    }
    const key = getProgressKey(activeBankId, practiceMode, type);
    const session = createPracticeSession(pool, practiceMode, userState.progress.sessions?.[key]);
    setCurrentId(session.currentQuestionId);
  }

  function chooseNext() {
    const next = nextQuestionId(activeOrder, current?.id || "", 1);
    if (next) chooseQuestion(next);
  }

  function choosePrevious() {
    const next = nextQuestionId(activeOrder, current?.id || "", -1);
    if (next) chooseQuestion(next);
  }

  function restartPractice() {
    const pool = getPracticePool(questions, typeFilter, practiceMode, userState);
    if (!pool.length) {
      setStatus(emptyPoolMessage(practiceMode));
      return;
    }
    const session = createPracticeSession(pool, practiceMode, null, true);
    setCurrentId(session.currentQuestionId);
    void authJson("/api/me/progress", {
      method: "POST",
      body: JSON.stringify({
        bankId: activeBankId,
        questionId: session.currentQuestionId,
        mode: practiceMode,
        typeFilter,
        session: { key: practiceKey, ...session },
      }),
    }).then(setUserState);
    setStatus(practiceMode === "random" ? "已重新打乱，开始重刷。" : "已清除当前模块进度，开始重刷。");
  }

  function toggleOption(key: string) {
    if (!current) return;
    if (current.type === "multiple") {
      setSelected((old) => (old.includes(key) ? old.filter((item) => item !== key) : [...old, key].sort()));
    } else {
      setSelected([key]);
    }
  }

  function updateFillAnswer(index: number, value: string) {
    setFillAnswers((old) => old.map((answer, answerIndex) => (answerIndex === index ? value : answer)));
  }

  async function submitAnswer() {
    if (!current || result) return;
    if (current.type === "short") {
      await gradeShortAnswer();
      return;
    }

    const userAnswer =
      current.type === "fill"
        ? fillAnswers.map((answer) => answer.trim()).join("；")
        : current.type === "judge"
          ? selected.map((key) => current.options.find((option) => option.key === key)?.text || key).join("")
          : selected.join("");
    if (current.type === "fill" && fillAnswers.some((answer) => !answer.trim())) return setStatus("请填写所有空。");
    if (!userAnswer.trim()) return setStatus("请先作答。");

    const correct =
      current.type === "multiple" || current.type === "single"
        ? normalizeChoice(userAnswer) === normalizeChoice(current.answer)
        : normalizeText(userAnswer) === normalizeText(current.answer);
    const nextResult = { correct, message: correct ? "回答正确" : "回答错误" };
    await recordAttempt(current, userAnswer, nextResult);
    setResult(nextResult);
    void loadExplanationForQuestion(current);
  }

  async function gradeShortAnswer() {
    if (!current || !textAnswer.trim()) return setStatus("请先填写答案。");
    setStatus("正在调用 AI 评分...");
    try {
      const payload = await authJson(`/api/questions/${current.id}/grade`, {
        method: "POST",
        body: JSON.stringify({ answer: textAnswer }),
      });
      const correct = Number(payload.score) >= 60;
      const nextResult = { correct, score: payload.score, feedback: payload.feedback, message: `AI 评分：${payload.score ?? 0} 分` };
      await recordAttempt(current, textAnswer, nextResult);
      setResult(nextResult);
      setStatus("");
      void loadExplanationForQuestion(current);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "评分失败");
    }
  }

  async function recordAttempt(question: Question, userAnswer: string, attemptResult: ResultState) {
    const seconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
    await authJson("/api/me/attempt", {
      method: "POST",
      body: JSON.stringify({ questionId: question.id, bankId: activeBankId, answer: userAnswer, correct: attemptResult.correct, seconds }),
    });
    const order = activeOrder.length ? activeOrder : filtered.map((item) => item.id);
    const index = Math.max(0, order.indexOf(question.id));
    const nextResults = {
      ...(activeSession?.results || {}),
      [question.id]: {
        correct: attemptResult.correct,
        answer: userAnswer,
        message: attemptResult.message,
        score: attemptResult.score,
        feedback: attemptResult.feedback,
        updatedAt: new Date().toISOString(),
      },
    };
    const nextState = await authJson("/api/me/progress", {
      method: "POST",
      body: JSON.stringify({
        bankId: activeBankId,
        questionId: question.id,
        mode: practiceMode,
        typeFilter,
        session: {
          key: practiceKey,
          currentQuestionId: question.id,
          order,
          index,
          results: nextResults,
        },
      }),
    });
    setUserState(nextState);
  }

  async function toggleFavorite() {
    if (!current) return;
    const nextState = await authJson("/api/me/favorite", {
      method: "POST",
      body: JSON.stringify({ questionId: current.id, favorite: !isFavorite }),
    });
    setUserState(nextState);
  }

  async function handleCheckin() {
    if (!checkinUnlocked) {
      setStatus(`今日答对 ${userState.checkins.requiredCorrect || 10} 题后可签到。`);
      return;
    }
    try {
      const nextState = await authJson("/api/me/checkin", { method: "POST" });
      setUserState(nextState);
      setShowCheckinModal(false);
      setStatus(nextState.checkin?.newlyChecked ? "签到成功，今天继续保持。" : "今天已经签到。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "签到失败");
    }
  }

  async function loadExplanation(refresh = false) {
    if (!current) return;
    await loadExplanationForQuestion(current, refresh);
  }

  async function loadExplanationForQuestion(question: Question, refresh = false) {
    setExplanationLoading(true);
    try {
      const payload = await authJson(`/api/questions/${question.id}/explanation${refresh ? "?refresh=1" : ""}`);
      if (currentIdRef.current !== question.id) return;
      setExplanation(payload.explanation);
      void refreshHealth();
    } catch (error) {
      if (currentIdRef.current === question.id) {
        setExplanation(error instanceof Error ? `解析加载失败：${error.message}` : "解析加载失败");
      }
    } finally {
      if (currentIdRef.current === question.id) setExplanationLoading(false);
    }
  }

  async function askAi(event: FormEvent) {
    event.preventDefault();
    if (!current || !chatInput.trim()) return;
    const message = chatInput.trim();
    const nextHistory: ChatMessage[] = [...chat, { role: "user", content: message }];
    setChat(nextHistory);
    setChatInput("");
    setChatLoading(true);
    try {
      const payload = await authJson(`/api/questions/${current.id}/chat`, {
        method: "POST",
        body: JSON.stringify({ message, history: chat }),
      });
      setChat([...nextHistory, { role: "assistant", content: payload.answer }]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "问答失败");
    } finally {
      setChatLoading(false);
    }
  }

  async function refreshHealth() {
    setHealth(await fetch("/api/health").then((res) => res.json()));
  }

  async function resetServerStats() {
    if (!confirm("确定清空当前账号的刷题记录、错题和收藏吗？")) return;
    setUserState(await authJson("/api/me/reset", { method: "POST" }));
  }

  if (authenticated === "loading") return <div className="loading">正在加载...</div>;
  if (!authenticated) return <LoginPage onLogin={bootstrap} />;
  if (!current) return <div className="loading">正在加载题库...</div>;
  const pageTitle = activeView === "practice" ? `${modeLabels[practiceMode]}练习` : viewLabels[activeView];
  const topbarStats =
    activeView === "practice"
      ? [
          activeBank?.isLegacy ? "过往题库" : "当前题库",
          `${currentIndex >= 0 ? currentIndex + 1 : 1}/${filtered.length}`,
          typeFilter === "all" ? "全部题型" : typeLabels[typeFilter],
        ]
      : activeView === "bank"
        ? [`显示 ${bankQuestions.length}/${questions.length} 题`, bankTypeFilter === "all" ? "全部题型" : typeLabels[bankTypeFilter]]
        : activeView === "manage"
          ? [`${banks.length} 个题库`, `当前 ${questions.length} 题`]
        : activeView === "stats"
          ? [`正确率 ${accuracy}%`, `连续 ${userState.checkins.streak} 天`]
          : activeView === "mistakes"
            ? [`${visibleMistakes.length} 道错题`, `${userState.stats.attempts} 次作答`]
            : activeView === "favorites"
              ? [`${favoriteQuestions.length} 道收藏`, `${questions.length} 题`]
              : activeView === "feed"
                ? ["温馨彩蛋", "感谢投食"]
                : [`缓存 ${health?.explanationCacheCount || 0}/${health?.questionCount || questions.length}`, health?.ai.configured ? "AI 已配置" : "AI 未配置"];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <Brain size={28} />
            <strong>SolveMate</strong>
          </div>
          <div className="brand-user">
            <UserAvatar username={userState.username || "local"} size="small" />
            <span>{userState.username || "local"}</span>
          </div>
          <button className="mobile-menu-toggle" onClick={() => setMobileNavOpen((open) => !open)} title="展开导航">
            <Menu size={18} />
            <span>菜单</span>
          </button>
        </div>

        <div className={mobileNavOpen ? "mobile-nav-panel open" : "mobile-nav-panel"}>
          <div className="bank-switcher">
            <button
              className="bank-tab active"
              onClick={() => {
                openView("bank");
                setMobileNavOpen(false);
              }}
              title={activeBank?.name || "当前题库"}
            >
              <Library size={16} />
              <span>当前题库</span>
            </button>
          </div>

          <nav className="nav">
            <button className={activeView === "practice" ? "active" : ""} onClick={() => openView("practice")}>
              <Target size={18} /> 练习
            </button>
            <button className={activeView === "bank" ? "active" : ""} onClick={() => openView("bank")}>
              <Library size={18} /> 题库
            </button>
            <button className={activeView === "manage" ? "active" : ""} onClick={() => openView("manage")}>
              <Settings size={18} /> 管理
            </button>
            <button className={activeView === "stats" ? "active" : ""} onClick={() => openView("stats")}>
              <BarChart3 size={18} /> 主页
            </button>
            <button className={activeView === "mistakes" ? "active" : ""} onClick={() => openView("mistakes")}>
              <XCircle size={18} /> 错题
            </button>
            <button className={activeView === "favorites" ? "active" : ""} onClick={() => openView("favorites")}>
              <Bookmark size={18} /> 收藏
            </button>
            <button className={activeView === "ai" ? "active" : ""} onClick={() => openView("ai")}>
              <Sparkles size={18} /> AI
            </button>
            <button className={activeView === "feed" ? "active easter-nav" : "easter-nav"} onClick={() => openView("feed")}>
              <Star size={18} /> 点我
            </button>
          </nav>
        </div>

        <div className="sidebar-footer">
          <span>正确率 {accuracy}%</span>
          <span>平均 {formatSeconds(averageSeconds)}/题</span>
          <button className="logout-button" onClick={handleLogout}>
            <LogOut size={16} /> 退出
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className={activeView === "practice" ? "topbar practice-topbar" : "topbar"}>
          <div className="top-context" aria-label="当前状态">
            {topbarStats.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <div className="title-block">
            <div className="eyebrow">{activeBank?.name}</div>
            <h1 className="page-title">{pageTitle}</h1>
          </div>
          <div className="top-actions">
            <button
              className={userState.checkins.checkedToday ? "action checked" : checkinReady ? "action checkin-ready" : "action locked"}
              onClick={handleCheckin}
              disabled={!checkinUnlocked}
              title={checkinUnlocked ? "签到" : `刷对${checkinRequiredCorrect}题后解锁签到`}
            >
              <CalendarCheck size={18} />
              {userState.checkins.checkedToday ? "已签" : checkinReady ? "签到" : "未解锁"}
            </button>
          </div>
        </header>

        {activeView === "practice" && (
          <button className="control-toggle" onClick={() => setControlsOpen((open) => !open)}>
            <ListFilter size={18} />
            <span>刷题设置</span>
            <em>{modeLabels[practiceMode]} · {typeFilter === "all" ? "全部" : typeLabels[typeFilter]}</em>
          </button>
        )}

        {activeView === "practice" && (
          <div className={controlsOpen ? "control-strip open" : "control-strip"}>
            <div className="segmented">
              {(["random", "sequential", "favorites", "mistakes"] as const).map((mode) => (
                <button key={mode} className={practiceMode === mode ? "active" : ""} onClick={() => changePracticeMode(mode)}>
                  {modeLabels[mode]}
                </button>
              ))}
            </div>
            <button className="icon-text restart-button" onClick={restartPractice}>
              <RefreshCcw size={17} />
              重刷当前
            </button>
            <div className="filters">
              {(["all", "single", "multiple", "judge", "fill", "short"] as const).map((type) => (
                <button key={type} className={typeFilter === type ? "chip active" : "chip"} onClick={() => changeTypeFilter(type)}>
                  {type === "all" ? "全部" : typeLabels[type]}
                </button>
              ))}
            </div>
          </div>
        )}

        {status && <FloatingNotice message={status} onClose={() => setStatus("")} />}

        {activeView === "practice" && filtered.length === 0 && (
          <section className="table-panel empty-practice">
            <EmptyState
              icon={<Target size={22} />}
              title={emptyPoolMessage(practiceMode)}
              description="可以切换题型、切换模式，或收藏题目后再进入收藏刷题。"
              actionLabel="查看题库"
              onAction={() => setActiveView("bank")}
            />
          </section>
        )}

        {activeView === "practice" && filtered.length > 0 && (
          <div className="practice-layout">
            <PracticeProgress
              progress={practiceProgress}
              mode={practiceMode}
              typeFilter={typeFilter}
              onOpen={() => setQuickBrowserOpen(true)}
            />
            <section className={["question-panel", visibleResult ? "answered" : "", visibleResult?.correct ? "answered-correct" : visibleResult ? "answered-wrong" : ""].filter(Boolean).join(" ")}>
              <div className="question-card-head">
                <div className="question-meta">
                  <span>{current.rawType}</span>
                  <span>#{current.sourceIndex}</span>
                  {currentIndex >= 0 && <span>{currentIndex + 1}/{filtered.length}</span>}
                  {answeredFromHistory && <span>已刷过</span>}
                  <span>
                    <Clock3 size={14} /> {formatSeconds(elapsed)}
                  </span>
                </div>
                <button className={isFavorite ? "favorite-star active" : "favorite-star"} onClick={toggleFavorite} title={isFavorite ? "取消收藏" : "收藏本题"}>
                  <Star size={21} fill={isFavorite ? "currentColor" : "none"} />
                </button>
              </div>

              <h2 className="question-title">{current.prompt}</h2>

              {current.type !== "fill" && current.type !== "short" && (
                <div className="options">
                  {current.options.map((option) => (
                    <button
                      key={option.key}
                      className={selected.includes(option.key) ? "option checked" : "option"}
                      onClick={() => toggleOption(option.key)}
                      disabled={Boolean(visibleResult)}
                    >
                      <span>{option.key}</span>
                      <p>{option.text}</p>
                    </button>
                  ))}
                </div>
              )}

              {current.type === "fill" && (
                <div className="fill-grid">
                  {fillAnswers.map((answer, index) => (
                    <label key={`${current.id}-${index}`} className="fill-input">
                      <span>空 {index + 1}</span>
                      <input value={answer} placeholder={`填写第 ${index + 1} 空`} disabled={Boolean(visibleResult)} onChange={(event) => updateFillAnswer(index, event.target.value)} />
                    </label>
                  ))}
                </div>
              )}

              {current.type === "short" && (
                <textarea className="answer-box" value={textAnswer} rows={7} placeholder="输入答案，提交后调用 AI 快速评分" disabled={Boolean(visibleResult)} onChange={(event) => setTextAnswer(event.target.value)} />
              )}

              {visibleResult && (
                <div className={visibleResult.correct ? "result correct" : "result wrong"}>
                  {visibleResult.correct ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                  <div>
                    <strong>{visibleResult.message}</strong>
                    {visibleResult.feedback && <p>{visibleResult.feedback}</p>}
                    <p>标准答案：{current.answer}</p>
                  </div>
                </div>
              )}

              <div className="question-actions">
                <button className="primary" onClick={submitAnswer} disabled={Boolean(visibleResult)}>
                  {answeredFromHistory ? "已完成" : current.type === "short" ? "AI 评分" : "提交答案"}
                </button>
              </div>
              <div className="practice-nav">
                <button className="nav-action" onClick={choosePrevious}>
                  <ArrowLeft size={19} />
                  上一题
                </button>
                <button className={result ? "nav-action primary-next" : "nav-action"} onClick={chooseNext}>
                  下一题
                  <ChevronRight size={19} />
                </button>
              </div>
              {result && (
                <AiPanel
                  explanation={explanation}
                  explanationLoading={explanationLoading}
                  chat={chat}
                  chatInput={chatInput}
                  chatLoading={chatLoading}
                  onAsk={askAi}
                  onChatInput={setChatInput}
                />
              )}
            </section>
          </div>
        )}

        {activeView === "bank" && (
          <QuestionBank
            questions={bankQuestions}
            allQuestions={questions}
            total={questions.length}
            search={bankSearch}
            typeFilter={bankTypeFilter}
            currentId={current.id}
            state={userState}
            onSearch={setBankSearch}
            onTypeFilter={setBankTypeFilter}
            onChoose={chooseQuestion}
          />
        )}

        {activeView === "manage" && (
          <BankManager
            banks={banks}
            activeBankId={activeBankId}
            aiConfigured={Boolean(health?.ai.configured)}
            onSaveMeta={updateBankMeta}
            onSetDefault={updateDefaultBank}
            onImport={importQuestionBank}
            onOpenBank={(bankId) => {
              void loadBank(bankId);
              setActiveView("bank");
            }}
          />
        )}

        {activeView === "stats" && (
          <StatsView
            questions={questions}
            state={userState}
            username={userState.username || "local"}
            accuracy={accuracy}
            averageSeconds={averageSeconds}
            calendarMonth={calendarMonth}
            onCalendarMonth={setCalendarMonth}
            onReset={resetServerStats}
            onChoose={chooseQuestion}
          />
        )}

        {activeView === "mistakes" && (
          <QuestionList
            title="错题记录"
            questions={visibleMistakes}
            empty="当前题库还没有错题记录。"
            onChoose={chooseQuestion}
            state={userState}
            currentId={current.id}
            variant="mistakes"
            extraMeta={(question) => `错误 ${userState.mistakes[question.id]?.count || 0} 次`}
            emptyIcon={<XCircle size={22} />}
            actionLabel="继续练习"
            onEmptyAction={() => setActiveView("practice")}
          />
        )}

        {activeView === "favorites" && (
          <QuestionList
            title="收藏题目"
            questions={favoriteQuestions}
            empty="当前题库还没有收藏题目。"
            onChoose={chooseQuestion}
            state={userState}
            currentId={current.id}
            variant="favorites"
            emptyIcon={<Bookmark size={22} />}
            actionLabel="浏览题库"
            onEmptyAction={() => setActiveView("bank")}
          />
        )}

        {activeView === "ai" && <AiStatus health={health} />}

        {activeView === "feed" && <FeedPage />}
      </section>
      {quickBrowserOpen && activeView === "practice" && (
        <QuickQuestionBrowser
          questions={orderedPracticeQuestions}
          results={activeSession?.results || {}}
          currentId={current.id}
          mode={practiceMode}
          typeFilter={typeFilter}
          filter={quickBrowserFilter}
          search={quickBrowserSearch}
          onFilter={setQuickBrowserFilter}
          onSearch={setQuickBrowserSearch}
          onChoose={chooseQuestionFromBrowser}
          onClose={() => setQuickBrowserOpen(false)}
        />
      )}
      {showCheckinModal && (
        <CheckinModal
          state={userState}
          calendarMonth={calendarMonth}
          onCalendarMonth={setCalendarMonth}
          onCheckin={handleCheckin}
          onClose={() => setShowCheckinModal(false)}
        />
      )}
    </main>
  );
}

function FeedPage() {
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [qrAvailable, setQrAvailable] = useState(true);
  const snowflakes = Array.from({ length: 34 }, (_, index) => ({
    id: index,
    left: `${(index * 29) % 100}%`,
    delay: `${-(index % 11) * 0.7}s`,
    duration: `${7 + (index % 6) * 0.8}s`,
    size: `${7 + (index % 5) * 2}px`,
  }));

  function openPayment() {
    setQrAvailable(true);
    setPaymentOpen(true);
  }

  return (
    <section className={paymentOpen ? "feed-page feeding" : "feed-page"}>
      {paymentOpen && (
        <div className="snow-stage" aria-hidden="true">
          {snowflakes.map((flake) => (
            <span
              key={flake.id}
              className="snowflake"
              style={{ left: flake.left, animationDelay: flake.delay, animationDuration: flake.duration, width: flake.size, height: flake.size }}
            />
          ))}
        </div>
      )}

      <div className="warm-glow one" aria-hidden="true" />
      <div className="warm-glow two" aria-hidden="true" />

      <div className="feed-center">
        <div className="pleading-stickman" aria-label="祈求投食的可爱火柴人">
          <span className="plead-shadow" />
          <span className="plead-sparkle one" />
          <span className="plead-sparkle two" />
          <span className="plead-head">
            <i className="plead-hair one" />
            <i className="plead-hair two" />
            <i className="plead-eye left" />
            <i className="plead-eye right" />
            <i className="plead-cheek left" />
            <i className="plead-cheek right" />
            <i className="plead-mouth" />
          </span>
          <span className="plead-body" />
          <span className="plead-arm left" />
          <span className="plead-arm right" />
          <span className="plead-leg left" />
          <span className="plead-leg right" />
          <span className="plead-heart one" />
          <span className="plead-heart two" />
        </div>

        <div className="feed-copy">
          <span>来自zhan的秘密入口</span>
          <h2>投食一下，继续认真刷题</h2>
          <p>一点点能量，会变成更多好看的题库和更稳定的 AI 解析。</p>
        </div>

        <button className="feed-button" onClick={openPayment}>
          <Star size={19} fill="currentColor" />
          喂食
        </button>
      </div>

      {paymentOpen && (
        <div className="payment-backdrop" role="presentation" onClick={() => setPaymentOpen(false)}>
          <section className="payment-card" role="dialog" aria-modal="true" aria-labelledby="payment-title" onClick={(event) => event.stopPropagation()}>
            <button className="payment-close" onClick={() => setPaymentOpen(false)} title="关闭">
              <X size={18} />
            </button>
            <span className="payment-kicker">谢谢投食</span>
            <h3 id="payment-title">扫码投喂 SolveMate</h3>
            <div className="payment-qr-frame">
              {qrAvailable ? (
                <img src="/payment-qr.jpg" alt="收款码二维码" onError={() => setQrAvailable(false)} />
              ) : (
                <div className="payment-qr-placeholder" aria-label="收款码二维码待上传">
                  <span />
                  <span />
                  <span />
                  <i />
                </div>
              )}
            </div>
            <p>感谢支持，每一口都算数。</p>
          </section>
        </div>
      )}
    </section>
  );
}

function FloatingNotice({ message, onClose }: { message: string; onClose: () => void }) {
  const tone = noticeTone(message);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const timer = window.setTimeout(() => onCloseRef.current(), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  return (
    <div className={`floating-notice ${tone}`} role="status" aria-live="polite">
      <span>{message}</span>
      <button className="notice-close" onClick={onClose} title="关闭提示">
        <X size={16} />
      </button>
    </div>
  );
}

function AiPanel({
  explanation,
  explanationLoading,
  chat,
  chatInput,
  chatLoading,
  onAsk,
  onChatInput,
}: {
  explanation: string;
  explanationLoading: boolean;
  chat: ChatMessage[];
  chatInput: string;
  chatLoading: boolean;
  onAsk: (event: FormEvent) => void;
  onChatInput: (value: string) => void;
}) {
  return (
    <section className="ai-panel">
      <div className="panel-title">
        <Sparkles size={18} />
        <strong>AI 解析</strong>
      </div>
      <div className={explanationLoading ? "explanation loading-lines" : "explanation"}>{explanationLoading ? "正在整理解析..." : explanation || "暂无解析内容。"}</div>

      <div className="panel-title qa-title">
        <MessageSquareText size={18} />
        <strong>追问</strong>
      </div>
      <div className="chat-log">
        {chat.map((message, index) => (
          <div key={`${message.role}-${index}`} className={message.role === "user" ? "bubble user" : "bubble assistant"}>
            {message.content}
          </div>
        ))}
        {chatLoading && <div className="bubble assistant">正在回答...</div>}
      </div>
      <form className="chat-form" onSubmit={onAsk}>
        <input value={chatInput} placeholder="围绕本题继续提问" onChange={(event) => onChatInput(event.target.value)} />
        <button className="primary" type="submit">发送</button>
      </form>
    </section>
  );
}

function StatsView({
  questions,
  state,
  username,
  accuracy,
  averageSeconds,
  calendarMonth,
  onCalendarMonth,
  onReset,
  onChoose,
}: {
  questions: Question[];
  state: UserState;
  username: string;
  accuracy: number;
  averageSeconds: number;
  calendarMonth: string;
  onCalendarMonth: (month: string) => void;
  onReset: () => void;
  onChoose: (id: string) => void;
}) {
  const today = state.stats.daily[chinaDateKey()] || { attempts: 0, correct: 0, totalSeconds: 0 };
  const month = state.stats.monthly[chinaMonthKey()] || { attempts: 0, correct: 0, totalSeconds: 0 };
  const practicedCount = questions.filter((question) => (state.stats.byQuestion[question.id]?.attempts || 0) > 0).length;
  const practicedPercent = questions.length ? Math.round((practicedCount / questions.length) * 100) : 0;
  const practiced = Object.entries(state.stats.byQuestion)
    .map(([id, stat]) => ({ question: questions.find((item) => item.id === id), stat }))
    .filter((item) => item.question)
    .sort((a, b) => b.stat.attempts - a.stat.attempts)
    .slice(0, 10);

  return (
    <section className="dashboard profile-dashboard">
      <section className="profile-hero">
        <div className="profile-identity">
          <UserAvatar username={username} size="large" />
          <div>
            <span className="eyebrow">用户主页</span>
            <h2>{username}</h2>
            <p>连续签到 {state.checkins.streak} 天 · 平均 {formatSeconds(averageSeconds)}/题</p>
          </div>
        </div>
        <div className="profile-score-card">
          <span><Trophy size={16} /> 总正确率</span>
          <strong>{accuracy}%</strong>
          <i style={{ width: `${accuracy}%` }} />
        </div>
      </section>

      <div className="profile-stat-grid">
        <ProfileStat label="总作答" value={state.stats.attempts.toString()} detail="累计练习次数" icon={<ListChecks size={17} />} />
        <ProfileStat label="已练题目" value={`${practicedCount}/${questions.length}`} detail={`完成 ${practicedPercent}%`} icon={<CheckCircle2 size={17} />} />
        <ProfileStat label="今日作答" value={today.attempts.toString()} detail={`正确率 ${formatAccuracy(today)}`} icon={<Target size={17} />} />
        <ProfileStat label="本月作答" value={month.attempts.toString()} detail={`正确率 ${formatAccuracy(month)}`} icon={<BarChart3 size={17} />} />
        <ProfileStat label="平均用时" value={formatSeconds(averageSeconds)} detail="每题平均耗时" icon={<Timer size={17} />} />
        <ProfileStat label="错题数" value={Object.keys(state.mistakes).length.toString()} detail="建议优先复盘" icon={<XCircle size={17} />} />
      </div>

      <ActivityCalendar
        title="练习日历"
        state={state}
        monthKey={calendarMonth}
        onMonthChange={onCalendarMonth}
        mode="stats"
      />

      <div className="table-panel">
        <div className="table-head">
          <strong>高频练习</strong>
          <button className="danger" onClick={onReset}>清空账号记录</button>
        </div>
        {practiced.length === 0 ? (
          <p className="empty">还没有作答记录。</p>
        ) : (
          practiced.map(({ question, stat }) => (
            <button key={question!.id} className="row-item" onClick={() => onChoose(question!.id)}>
              <span>{question!.prompt}</span>
              <em>{stat.correct}/{stat.attempts} · 平均 {formatSeconds(Math.round(stat.totalSeconds / stat.attempts))}</em>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function UserAvatar({ username, size = "small" }: { username: string; size?: "small" | "large" }) {
  const label = username.trim() || "local";
  const normalized = label.toLowerCase();

  if (normalized === "orange") {
    return (
      <div className={`user-avatar ${size} orange-avatar`} aria-label={`${label} 的头像`}>
        <span className="orange-leaf" />
        <span className="orange-face" />
      </div>
    );
  }

  if (normalized === "zhan") {
    return (
      <div className={`user-avatar ${size} stick-avatar`} aria-label={`${label} 的头像`}>
        <span className="stick-head" />
        <span className="stick-body" />
        <span className="stick-arm left" />
        <span className="stick-arm right" />
        <span className="stick-leg left" />
        <span className="stick-leg right" />
      </div>
    );
  }

  return (
    <div className={`user-avatar ${size} default-avatar`} aria-label={`${label} 的头像`}>
      <span>{label.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}

function ProfileStat({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return (
    <article className="profile-stat">
      <div className="profile-stat-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </article>
  );
}

function CheckinModal({
  state,
  calendarMonth,
  onCalendarMonth,
  onCheckin,
  onClose,
}: {
  state: UserState;
  calendarMonth: string;
  onCalendarMonth: (month: string) => void;
  onCheckin: () => void;
  onClose: () => void;
}) {
  const today = state.stats.daily[chinaDateKey()] || { attempts: 0, correct: 0, totalSeconds: 0 };
  const requiredCorrect = state.checkins.requiredCorrect || 10;
  const todayCorrect = state.checkins.todayCorrect ?? today.correct;
  const unlocked = Boolean(state.checkins.checkedToday || state.checkins.unlocked);
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="checkin-modal" role="dialog" aria-modal="true" aria-labelledby="checkin-title">
        <div className="checkin-hero">
          <div>
            <span className="eyebrow">今日签到</span>
            <h2 id="checkin-title">{unlocked ? "今日签到已解锁" : `刷对${requiredCorrect}题后解锁签到`}</h2>
          </div>
          <div className="streak-badge">
            <CalendarCheck size={20} />
            <strong>{state.checkins.streak}</strong>
            <span>连续天数</span>
          </div>
        </div>

        <ActivityCalendar
          title="本月记录"
          state={state}
          monthKey={calendarMonth}
          onMonthChange={onCalendarMonth}
          mode="checkin"
        />

        <div className="checkin-summary">
          <span>今日作答 {today.attempts} 题</span>
          <span>答对进度 {Math.min(todayCorrect, requiredCorrect)}/{requiredCorrect}</span>
          <span>今日用时 {formatSeconds(today.totalSeconds)}</span>
        </div>

        <div className="modal-actions">
          <button className="action" onClick={onClose}>稍后</button>
          <button className={unlocked ? "primary checkin-primary checkin-ready" : "primary checkin-primary"} onClick={onCheckin} disabled={!unlocked}>
            <CalendarCheck size={18} />
            {unlocked ? "完成签到" : `刷对${requiredCorrect}题后解锁签到`}
          </button>
        </div>
      </section>
    </div>
  );
}

function ActivityCalendar({
  title,
  state,
  monthKey,
  onMonthChange,
  mode,
}: {
  title: string;
  state: UserState;
  monthKey: string;
  onMonthChange: (month: string) => void;
  mode: "stats" | "checkin";
}) {
  const days = calendarDays(monthKey);
  const checkedDays = new Set(state.checkins.days);
  const monthStats = days.reduce(
    (total, day) => {
      if (!day.inMonth) return total;
      const stat = state.stats.daily[day.key] || { attempts: 0, correct: 0, totalSeconds: 0 };
      total.attempts += stat.attempts;
      total.correct += stat.correct;
      total.totalSeconds += stat.totalSeconds;
      return total;
    },
    { attempts: 0, correct: 0, totalSeconds: 0 },
  );

  function shiftMonth(delta: number) {
    onMonthChange(addMonths(monthKey, delta));
  }

  return (
    <section className={mode === "stats" ? "calendar-panel table-panel" : "calendar-panel compact"}>
      <div className="calendar-head">
        <div>
          <strong>{title}</strong>
          <span>{monthKey} · 本月 {monthStats.attempts} 题 · 正确率 {formatAccuracy(monthStats)}</span>
        </div>
        <div className="calendar-nav">
          <button className="icon-button compact" title="上个月" onClick={() => shiftMonth(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button className="icon-button compact" title="下个月" onClick={() => shiftMonth(1)}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="calendar-weekdays">
        {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {days.map((day) => {
          const stat = state.stats.daily[day.key] || { attempts: 0, correct: 0, totalSeconds: 0 };
          const checked = checkedDays.has(day.key);
          const intensity = stat.attempts >= 20 ? 4 : stat.attempts >= 10 ? 3 : stat.attempts >= 3 ? 2 : stat.attempts >= 1 ? 1 : 0;
          return (
            <div
              key={day.key}
              className={[
                "calendar-day",
                day.inMonth ? "" : "outside",
                day.key === chinaDateKey() ? "today" : "",
                checked ? "checked" : "",
                `level-${intensity}`,
              ].join(" ")}
              title={`${day.key}：${stat.attempts} 题，正确率 ${formatAccuracy(stat)}，用时 ${formatSeconds(stat.totalSeconds)}${checked ? "，已签到" : ""}`}
            >
              <span>{day.day}</span>
              {checked && <CalendarCheck size={13} />}
              {stat.attempts > 0 && <em>{stat.attempts}</em>}
            </div>
          );
        })}
      </div>
      <div className="calendar-legend">
        <span>少</span>
        <i className="level-0" />
        <i className="level-1" />
        <i className="level-2" />
        <i className="level-3" />
        <i className="level-4" />
        <span>多</span>
      </div>
    </section>
  );
}

function BankManager({
  banks,
  activeBankId,
  aiConfigured,
  onSaveMeta,
  onSetDefault,
  onImport,
  onOpenBank,
}: {
  banks: BankMeta[];
  activeBankId: string;
  aiConfigured: boolean;
  onSaveMeta: (bankId: string, name: string, label: string) => Promise<void>;
  onSetDefault: (bankId: string) => Promise<void>;
  onImport: (request: BankImportRequest) => Promise<BankImportResult>;
  onOpenBank: (bankId: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, { name: string; label: string }>>({});
  const [managerView, setManagerView] = useState<"import" | "manage">("import");
  const [targetMode, setTargetMode] = useState<"new" | "existing">("new");
  const [targetBankId, setTargetBankId] = useState(activeBankId);
  const [bankName, setBankName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BankImportResult | null>(null);

  useEffect(() => {
    setDrafts((old) => {
      const next = { ...old };
      banks.forEach((bank) => {
        if (!next[bank.id]) next[bank.id] = { name: bank.name, label: bank.label };
      });
      return next;
    });
    if (!targetBankId && banks[0]) setTargetBankId(banks[0].id);
  }, [banks, targetBankId]);

  async function submitImport(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const payload = await onImport({
        file,
        targetMode,
        targetBankId,
        bankName,
        bankLabel: "导入题库",
        aiAssist: aiConfigured,
      });
      setResult(payload);
      setFile(null);
      setBankName("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard bank-manager">
      <div className="manager-mode-switch" aria-label="题库管理功能">
        <button className={managerView === "import" ? "active" : ""} onClick={() => setManagerView("import")}>
          <FileUp size={18} />
          导入题库
        </button>
        <button className={managerView === "manage" ? "active" : ""} onClick={() => setManagerView("manage")}>
          <Library size={18} />
          题库管理
        </button>
      </div>

      {managerView === "import" && (
      <section className="table-panel manage-panel">
        <div className="table-head">
          <strong>导入题库</strong>
          <span className="muted">AI 清洗{aiConfigured ? "已开启" : "未配置"} · 支持 xlsx、xlsm、csv、docx、txt、md</span>
        </div>
        <form className="import-form" onSubmit={submitImport}>
          <label
            className={file ? "file-upload-control ready" : "file-upload-control"}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              setFile(event.dataTransfer.files?.[0] || null);
            }}
          >
            <input
              type="file"
              accept=".xlsx,.xlsm,.csv,.docx,.txt,.md"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <span className="file-upload-icon">
              <FileUp size={24} />
            </span>
            <strong>{file ? file.name : "选择题库文件"}</strong>
            <em>{file ? `${Math.max(1, Math.round(file.size / 1024))} KB` : "支持拖入文件或点击选择"}</em>
          </label>
          <label>
            <span>导入方式</span>
            <select value={targetMode} onChange={(event) => setTargetMode(event.target.value === "existing" ? "existing" : "new")}>
              <option value="new">导入到新题库</option>
              <option value="existing">导入到现有题库</option>
            </select>
          </label>
          {targetMode === "existing" ? (
            <label>
              <span>目标题库</span>
              <select value={targetBankId} onChange={(event) => setTargetBankId(event.target.value)}>
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              <span>新题库名称</span>
              <input value={bankName} placeholder="例如：7月考试题库" onChange={(event) => setBankName(event.target.value)} />
            </label>
          )}
          <button className="primary import-submit" type="submit" disabled={busy || !file || (targetMode === "new" && !bankName.trim())}>
            <FileUp size={18} />
            {busy ? "导入中..." : "开始导入"}
          </button>
        </form>
        {result && (
          <div className="import-result">
            <strong>{result.bank.name} · 已导入 {result.importedCount} 道</strong>
            <span>{result.ai.used ? `AI 已辅助处理 ${result.ai.count} 道` : `AI：${result.ai.reason || "规则解析完成"}`}</span>
            {result.warnings.length > 0 && <span>解析提示 {result.warnings.length} 条，建议抽查题目。</span>}
          </div>
        )}
      </section>
      )}

      {managerView === "manage" && (
      <section className="table-panel manage-panel">
        <div className="table-head">
          <strong>题库管理</strong>
          <span className="muted">在这里选择当前题库、修改题库名称</span>
        </div>
        <div className="manage-bank-list">
          {banks.map((bank) => {
            const draft = drafts[bank.id] || { name: bank.name, label: bank.label };
            return (
              <div key={bank.id} className={bank.id === activeBankId ? "manage-bank-row active" : "manage-bank-row"}>
                <div className="manage-bank-main">
                  <strong>{bank.name}</strong>
                  <span>{bank.questionCount} 题 · {bank.id === activeBankId ? "当前题库" : bank.label || "未设置标签"}</span>
                </div>
                <label>
                  <span>名称</span>
                  <input
                    value={draft.name}
                    onChange={(event) => setDrafts((old) => ({ ...old, [bank.id]: { ...draft, name: event.target.value } }))}
                  />
                </label>
                <label>
                  <span>标签</span>
                  <input
                    value={draft.label}
                    onChange={(event) => setDrafts((old) => ({ ...old, [bank.id]: { ...draft, label: event.target.value } }))}
                  />
                </label>
                <div className="manage-bank-actions">
                  <button className="icon-text" onClick={() => void onSaveMeta(bank.id, draft.name, draft.label)}>
                    <Save size={17} />
                    保存
                  </button>
                  <button className={bank.id === activeBankId ? "chip active" : "chip"} onClick={() => void onSetDefault(bank.id)}>
                    {bank.id === activeBankId ? "当前" : "设为当前"}
                  </button>
                  <button className="action" onClick={() => onOpenBank(bank.id)}>
                    浏览
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      )}
    </section>
  );
}

function QuestionBank({
  questions,
  allQuestions,
  total,
  search,
  typeFilter,
  currentId,
  state,
  onSearch,
  onTypeFilter,
  onChoose,
}: {
  questions: Question[];
  allQuestions: Question[];
  total: number;
  search: string;
  typeFilter: QuestionType | "all";
  currentId: string;
  state: UserState;
  onSearch: (value: string) => void;
  onTypeFilter: (value: QuestionType | "all") => void;
  onChoose: (id: string) => void;
}) {
  const typeCounts = useMemo(() => {
    const counts: Record<QuestionType | "all", number> = {
      all: allQuestions.length,
      single: 0,
      multiple: 0,
      judge: 0,
      fill: 0,
      short: 0,
      unknown: 0,
    };
    allQuestions.forEach((question) => {
      counts[question.type] += 1;
    });
    return counts;
  }, [allQuestions]);
  const visibleTypeOptions = bankTypeOptions.filter((type) => type === "all" || typeCounts[type] > 0);

  return (
    <section className="table-panel bank-panel">
      <div className="bank-toolbar">
        <div>
          <strong>题库浏览</strong>
          <span>显示 {questions.length}/{total} 道</span>
        </div>
        <label className="search-box">
          <Search size={18} />
          <input value={search} placeholder="搜索题干、答案、题型或编号" onChange={(event) => onSearch(event.target.value)} />
        </label>
        <div className="bank-filter" aria-label="题型筛选">
          {visibleTypeOptions.map((type) => (
            <button
              key={type}
              type="button"
              className={typeFilter === type ? "active" : ""}
              aria-pressed={typeFilter === type}
              onClick={() => onTypeFilter(type)}
            >
              <span>{type === "all" ? "全部" : typeLabels[type]}</span>
              <em>{typeCounts[type]}</em>
            </button>
          ))}
        </div>
      </div>

      {questions.length === 0 ? (
        <EmptyState icon={<Search size={22} />} title="没有匹配的题目" description="换一个关键词，或清空搜索后继续浏览题库。" />
      ) : (
        <QuestionRows questions={questions} state={state} currentId={currentId} onChoose={onChoose} />
      )}
    </section>
  );
}

function PracticeProgress({
  progress,
  mode,
  typeFilter,
  onOpen,
}: {
  progress: { total: number; completed: number; correct: number; percent: number };
  mode: PracticeMode;
  typeFilter: QuestionType | "all";
  onOpen: () => void;
}) {
  const typeText = typeFilter === "all" ? "全部题型" : typeLabels[typeFilter];

  return (
    <button
      type="button"
      className="practice-progress-panel clickable"
      aria-label="打开题目快速浏览"
      onClick={onOpen}
    >
      <div className="practice-progress-head">
        <div>
          <strong>{modeLabels[mode]}进度</strong>
          <span>{typeText}</span>
        </div>
        <em>{progress.percent}%</em>
      </div>
      <div className="practice-progress-track" aria-hidden="true">
        <i style={{ width: `${progress.percent}%` }} />
      </div>
      <div className="practice-progress-stats">
        <span>已刷 {progress.completed}/{progress.total}</span>
        <span>已通过 {progress.correct}</span>
        <span>剩余 {Math.max(0, progress.total - progress.completed)}</span>
      </div>
    </button>
  );
}

function QuickQuestionBrowser({
  questions,
  results,
  currentId,
  mode,
  typeFilter,
  filter,
  search,
  onFilter,
  onSearch,
  onChoose,
  onClose,
}: {
  questions: Question[];
  results: Record<string, SessionResult>;
  currentId: string;
  mode: PracticeMode;
  typeFilter: QuestionType | "all";
  filter: QuickBrowseFilter;
  search: string;
  onFilter: (filter: QuickBrowseFilter) => void;
  onSearch: (search: string) => void;
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const normalizedSearch = normalizeSearch(search);
  const rows = questions
    .map((question, index) => ({ question, index, result: results[question.id] }))
    .filter(({ question, result }) => {
      if (filter === "unanswered" && result) return false;
      if (filter === "answered" && !result) return false;
      if (!normalizedSearch) return true;
      return normalizeSearch(`${question.sourceIndex} ${question.rawType} ${question.prompt}`).includes(normalizedSearch);
    });
  const answered = questions.filter((question) => results[question.id]).length;
  const unanswered = Math.max(0, questions.length - answered);

  return (
    <div className="modal-backdrop quick-browser-backdrop" role="presentation" onClick={onClose}>
      <section className="quick-browser-modal" role="dialog" aria-modal="true" aria-labelledby="quick-browser-title" onClick={(event) => event.stopPropagation()}>
        <div className="quick-browser-head">
          <div>
            <span className="eyebrow">{modeLabels[mode]} · {typeFilter === "all" ? "全部题型" : typeLabels[typeFilter]}</span>
            <h2 id="quick-browser-title">题目快速浏览</h2>
          </div>
          <button type="button" className="icon-button compact" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="quick-browser-summary">
          <span>共 {questions.length} 题</span>
          <span>未刷 {unanswered}</span>
          <span>已刷 {answered}</span>
        </div>

        <div className="quick-browser-tools">
          <div className="quick-browser-tabs" aria-label="题目状态筛选">
            {([
              ["all", "全部"],
              ["unanswered", "未刷"],
              ["answered", "已刷"],
            ] as const).map(([value, label]) => (
              <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => onFilter(value)}>
                {label}
              </button>
            ))}
          </div>
          <label className="quick-browser-search">
            <Search size={17} />
            <input value={search} placeholder="搜索题号、题型或题干" onChange={(event) => onSearch(event.target.value)} />
          </label>
        </div>

        <div className="quick-question-list">
          {rows.length === 0 ? (
            <div className="quick-browser-empty">
              <Search size={22} />
              <strong>没有匹配的题目</strong>
              <span>切换筛选或清空搜索后再试。</span>
            </div>
          ) : (
            rows.map(({ question, index, result }) => {
              const active = question.id === currentId;
              const statusClass = result ? (result.correct ? "correct" : "wrong") : "pending";
              const statusText = result ? (result.correct ? "答对" : "答错") : "未刷";
              return (
                <button type="button" key={question.id} className={active ? "quick-question-row active" : "quick-question-row"} onClick={() => onChoose(question.id)}>
                  <span className="quick-question-number">{index + 1}</span>
                  <span className="quick-question-body">
                    <strong>{question.prompt}</strong>
                    <span className="quick-question-tags">
                      <em>{typeLabels[question.type]}</em>
                      <em>#{question.sourceIndex}</em>
                      {active && <em className="current">当前</em>}
                      <span className={`quick-question-status ${statusClass}`}>{statusText}</span>
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

function AiStatus({ health }: { health: Health | null }) {
  const questionCount = health?.questionCount || 0;
  const explanationCacheCount = health?.explanationCacheCount || 0;
  const cachePercent = questionCount ? Math.min(100, Math.round((explanationCacheCount / questionCount) * 100)) : 0;
  const pregenTotal = health?.pregen.total || 0;
  const pregenDone = health?.pregen.done || 0;
  const pregenPercent = pregenTotal ? Math.min(100, Math.round((pregenDone / pregenTotal) * 100)) : 0;
  const taskLabel = health?.pregen.running ? "运行中" : "空闲";
  const hasError = Boolean(health?.pregen.lastError);

  return (
    <section className="dashboard ai-status-dashboard">
      <section className={`ai-status-hero ${health?.ai.configured ? "online" : "offline"}`}>
        <div className="ai-status-icon">
          <Sparkles size={24} />
        </div>
        <div>
          <span>AI 服务状态</span>
          <strong>{health?.ai.configured ? "已配置" : "未配置"}</strong>
          <p>{health?.ai.configured ? "解析、问答和简答评分服务可用。" : "配置模型服务后可启用 AI 能力。"}</p>
        </div>
        <em>{taskLabel}</em>
      </section>

      <div className="ai-status-grid">
        <article className="ai-status-card">
          <div className="ai-status-card-head">
            <span><Library size={16} /> 缓存解析</span>
            <strong>{cachePercent}%</strong>
          </div>
          <div className="ai-status-progress" aria-hidden="true">
            <i style={{ width: `${cachePercent}%` }} />
          </div>
          <p>{explanationCacheCount}/{questionCount} 道题已有 AI 解析缓存。</p>
        </article>

        <article className="ai-status-card">
          <div className="ai-status-card-head">
            <span><RotateCw size={16} /> 后台任务</span>
            <strong>{pregenDone}/{pregenTotal}</strong>
          </div>
          <div className="ai-status-progress" aria-hidden="true">
            <i style={{ width: `${pregenPercent}%` }} />
          </div>
          <div className="ai-status-tags">
            <span>跳过缓存 {health?.pregen.cached || 0}</span>
            <span>失败 {health?.pregen.failed || 0}</span>
          </div>
        </article>

        <article className="ai-status-card">
          <div className="ai-status-card-head">
            <span><Brain size={16} /> 模型信息</span>
            <strong>{health?.ai.model || "未设置"}</strong>
          </div>
          <p>{health?.ai.baseUrl || "未设置服务地址"}</p>
        </article>

        <article className={`ai-status-card ${hasError ? "warning" : ""}`}>
          <div className="ai-status-card-head">
            <span><XCircle size={16} /> 错误状态</span>
            <strong>{hasError ? "需查看" : "正常"}</strong>
          </div>
          <p>{health?.pregen.lastError || "暂无后台任务错误。"}</p>
        </article>
      </div>
    </section>
  );
}

function QuestionList({
  title,
  questions,
  empty,
  onChoose,
  state,
  currentId,
  variant = "default",
  extraMeta,
  emptyIcon,
  actionLabel,
  onEmptyAction,
}: {
  title: string;
  questions: Question[];
  empty: string;
  onChoose: (id: string) => void;
  state: UserState;
  currentId: string;
  variant?: "default" | "mistakes" | "favorites";
  extraMeta?: (question: Question) => string;
  emptyIcon?: ReactNode;
  actionLabel?: string;
  onEmptyAction?: () => void;
}) {
  return (
    <section className="table-panel">
      <div className="table-head">
        <strong>{title}</strong>
        <span>{questions.length} 道</span>
      </div>
      {questions.length === 0 ? (
        <EmptyState icon={emptyIcon || <Library size={22} />} title={empty} description="这里会随着你的练习记录自动更新。" actionLabel={actionLabel} onAction={onEmptyAction} />
      ) : (
        <QuestionRows questions={questions} state={state} currentId={currentId} variant={variant} extraMeta={extraMeta} onChoose={onChoose} />
      )}
    </section>
  );
}

function QuestionRows({
  questions,
  state,
  currentId,
  variant = "default",
  extraMeta,
  onChoose,
}: {
  questions: Question[];
  state: UserState;
  currentId: string;
  variant?: "default" | "mistakes" | "favorites";
  extraMeta?: (question: Question) => string;
  onChoose: (id: string) => void;
}) {
  return (
    <div className="question-list">
      {questions.map((question) => (
        <QuestionRow
          key={question.id}
          question={question}
          state={state}
          active={question.id === currentId}
          variant={variant}
          extraMeta={extraMeta?.(question)}
          onChoose={onChoose}
        />
      ))}
    </div>
  );
}

function QuestionRow({
  question,
  state,
  active,
  variant,
  extraMeta,
  onChoose,
}: {
  question: Question;
  state: UserState;
  active: boolean;
  variant: "default" | "mistakes" | "favorites";
  extraMeta?: string;
  onChoose: (id: string) => void;
}) {
  const stat = state.stats.byQuestion[question.id];
  const answered = Boolean(stat?.attempts);
  const favorite = state.favorites.includes(question.id);
  const mistake = Boolean(state.mistakes[question.id]);
  const tags = [
    <span key="type" className={`type-badge ${question.type}`}>{typeLabels[question.type]}</span>,
    question.type === "fill" ? <span key="blank" className="state-badge subtle">{getBlankCount(question)} 空</span> : null,
    active ? <span key="current" className="state-badge current">当前</span> : null,
    answered ? <span key="answered" className="state-badge answered">已答 {stat?.attempts || 0}</span> : null,
    mistake ? <span key="mistake" className="state-badge mistake">{variant === "mistakes" ? `错 ${state.mistakes[question.id]?.count || 0}` : "错题"}</span> : null,
    favorite ? <span key="favorite" className="state-badge favorite">收藏</span> : null,
  ].filter(Boolean);
  const metaItems = extraMeta ? [extraMeta] : [];
  return (
    <button className={active ? "question-row active" : "question-row"} onClick={() => onChoose(question.id)}>
      <span className="question-row-index">#{question.sourceIndex}</span>
      <span className="question-row-body">
        <strong>{question.prompt}</strong>
        <span className="question-row-tags">{tags}</span>
      </span>
      {metaItems.length > 0 && (
        <span className="question-row-meta">
          {metaItems.map((item) => <em key={item}>{item}</em>)}
        </span>
      )}
    </button>
  );
}

function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <strong>{title}</strong>
      <p>{description}</p>
      {actionLabel && onAction && (
        <button className="icon-text" onClick={onAction}>
          {actionLabel}
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  const percent = value.endsWith("%") ? Math.max(0, Math.min(100, Number.parseInt(value, 10) || 0)) : null;
  return (
    <div className="metric">
      <span>{icon}{label}</span>
      <strong>{value}</strong>
      {percent !== null && (
        <div className="metric-bar" aria-hidden="true">
          <i style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password: password.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "登录失败");
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      {error && <FloatingNotice message={error} onClose={() => setError("")} />}
      <form className="login-card" onSubmit={handleSubmit}>
        <h1><Brain size={32} /><span>SolveMate</span></h1>
        <p>用户名由服务端配置，登录后会分别保存刷题记录</p>
        <input value={username} placeholder="用户名（单用户可留空）" autoFocus onChange={(event) => setUsername(event.target.value)} />
        <input type="password" value={password} placeholder="请输入密码" onChange={(event) => setPassword(event.target.value)} />
        <button type="submit" disabled={loading}>{loading ? "验证中..." : "进入"}</button>
      </form>
    </div>
  );
}

function normalizeChoice(value: string) {
  return value.replace(/[^A-Ga-g]/g, "").toUpperCase().split("").sort().join("");
}

function normalizeText(value: string) {
  return value.replace(/\s|；|;|。|，|,/g, "").toLowerCase();
}

function normalizeSearch(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function getPracticePool(questions: Question[], typeFilter: QuestionType | "all", mode: PracticeMode, state: UserState) {
  const byType = typeFilter === "all" ? questions : questions.filter((question) => question.type === typeFilter);
  if (mode === "mistakes") return byType.filter((question) => state.mistakes[question.id]);
  if (mode === "favorites") return byType.filter((question) => state.favorites.includes(question.id));
  return byType;
}

function getProgressKey(bankId: string, mode: PracticeMode, typeFilter: QuestionType | "all") {
  return `${bankId || "bank"}:${mode}:${typeFilter}`;
}

function getPracticeOrder(pool: Question[], session: PracticeSession | undefined, mode: PracticeMode) {
  const poolIds = pool.map((question) => question.id);
  const poolSet = new Set(poolIds);
  if (mode !== "random") return poolIds;
  const saved = session?.order?.filter((id) => poolSet.has(id)) || [];
  const savedSet = new Set(saved);
  const missing = poolIds.filter((id) => !savedSet.has(id));
  return [...saved, ...shuffleIds(missing)];
}

function createPracticeSession(pool: Question[], mode: PracticeMode, saved?: PracticeSession | null, reset = false): PracticeSession {
  const order = reset || mode === "random" && !saved?.order?.length
    ? mode === "random" ? shuffleIds(pool.map((question) => question.id)) : pool.map((question) => question.id)
    : getPracticeOrder(pool, saved || undefined, mode);
  const currentQuestionId = !reset && saved?.currentQuestionId && order.includes(saved.currentQuestionId)
    ? saved.currentQuestionId
    : order[0] || "";
  return {
    currentQuestionId,
    order,
    index: Math.max(0, order.indexOf(currentQuestionId)),
    results: reset ? {} : saved?.results || {},
  };
}

function nextQuestionId(order: string[], currentId: string, direction: 1 | -1) {
  if (!order.length) return "";
  const index = order.indexOf(currentId);
  if (index < 0) return order[0];
  return order[(index + direction + order.length) % order.length];
}

function shuffleIds(ids: string[]) {
  const copy = [...ids];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function normalizePracticeMode(mode: unknown): PracticeMode {
  if (mode === "custom") return "favorites";
  if (mode === "random" || mode === "sequential" || mode === "favorites" || mode === "mistakes") return mode;
  return "random";
}

function emptyPoolMessage(mode: PracticeMode) {
  if (mode === "mistakes") return "当前题型下还没有错题。";
  if (mode === "favorites") return "当前题型下还没有收藏题。";
  return "当前筛选条件下没有题目。";
}

function getBlankCount(question: Question) {
  const promptBlanks = question.prompt.match(/（\s*）|\(\s*\)|_{2,}|【\s*】/g)?.length || 0;
  const answerParts = question.answer.split(/[;；]/).map((part) => part.trim()).filter(Boolean).length;
  return Math.max(1, promptBlanks, answerParts);
}

function formatSeconds(seconds: number) {
  if (!seconds) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatAccuracy(stat: PeriodStat) {
  return stat.attempts ? `${Math.round((stat.correct / stat.attempts) * 100)}%` : "0%";
}

function noticeTone(message: string) {
  if (/失败|错误|过期|拒绝|未配置|未解锁/.test(message)) return "danger";
  if (/请|后可|已经|运行/.test(message)) return "warning";
  if (/成功|已读取|已生成|已显示|已开始/.test(message)) return "success";
  return "info";
}

function chinaDateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function chinaMonthKey() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const data = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${data.year}-${data.month}`;
}

function calendarDays(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = first.getUTCDay() || 7;
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - firstWeekday + 1);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return {
      key,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month - 1,
    };
  });
}

function addMonths(monthKey: string, delta: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",").pop() || "");
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}
