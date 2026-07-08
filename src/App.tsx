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
  History,
  Library,
  ListChecks,
  ListFilter,
  LogOut,
  Menu,
  MessageSquareText,
  RefreshCcw,
  RotateCw,
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
type View = "practice" | "bank" | "stats" | "mistakes" | "favorites" | "ai";

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
};

type PeriodStat = { attempts: number; correct: number; totalSeconds: number };
type QuestionStat = PeriodStat & { lastAt?: string; lastAnswer?: string };
type PracticeSession = { currentQuestionId: string; order: string[]; index: number; updatedAt?: string };

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

const viewLabels: Record<View, string> = {
  practice: "练习",
  bank: "题库",
  stats: "统计",
  mistakes: "错题",
  favorites: "收藏",
  ai: "AI",
};

export function App() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [banks, setBanks] = useState<BankMeta[]>([]);
  const [activeBankId, setActiveBankId] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [activeView, setActiveView] = useState<View>("practice");
  const [typeFilter, setTypeFilter] = useState<QuestionType | "all">("all");
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("random");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
  const activeOrder = useMemo(
    () => getPracticeOrder(filtered, userState.progress.sessions?.[practiceKey], practiceMode),
    [filtered, userState.progress.sessions, practiceKey, practiceMode],
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
        session: { key: practiceKey, currentQuestionId: currentId, order, index },
      }),
    }).then(setUserState);
  }, [activeBankId, currentId, practiceMode, typeFilter, practiceKey]);

  useEffect(() => {
    if (!booted.current || !filtered.length) return;
    const savedSession = userState.progress.sessions?.[practiceKey];
    if (savedSession?.currentQuestionId && filtered.some((question) => question.id === savedSession.currentQuestionId)) {
      if (currentId !== savedSession.currentQuestionId) setCurrentId(savedSession.currentQuestionId);
      return;
    }
    if (filtered.some((question) => question.id === currentId)) return;
    const session = createPracticeSession(filtered, practiceMode, savedSession);
    if (session.currentQuestionId) setCurrentId(session.currentQuestionId);
  }, [filtered, practiceMode, practiceKey, userState.progress.sessions]);

  const current = useMemo(
    () => filtered.find((question) => question.id === currentId) || filtered[0] || questions[0],
    [questions, currentId, filtered],
  );
  const currentIndex = useMemo(() => activeOrder.findIndex((id) => id === current?.id), [activeOrder, current]);
  const bankQuestions = useMemo(() => {
    const term = normalizeSearch(bankSearch);
    const source = typeFilter === "all" ? questions : questions.filter((question) => question.type === typeFilter);
    if (!term) return source;
    return source.filter((question) =>
      normalizeSearch(`${question.sourceIndex} ${question.rawType} ${question.prompt} ${question.answer}`).includes(term),
    );
  }, [questions, typeFilter, bankSearch]);
  const visibleMistakes = useMemo(
    () => Object.keys(userState.mistakes).map((id) => questions.find((question) => question.id === id)).filter(Boolean) as Question[],
    [questions, userState.mistakes],
  );
  const favoriteQuestions = useMemo(
    () => userState.favorites.map((id) => questions.find((question) => question.id === id)).filter(Boolean) as Question[],
    [questions, userState.favorites],
  );

  const accuracy = userState.stats.attempts ? Math.round((userState.stats.correct / userState.stats.attempts) * 100) : 0;
  const averageSeconds = userState.stats.attempts ? Math.round(userState.stats.totalSeconds / userState.stats.attempts) : 0;
  const isFavorite = current ? userState.favorites.includes(current.id) : false;
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

  async function switchBank(bankId: string) {
    const savedQuestion = userState.progress.currentByBank[bankId] || "";
    await loadBank(bankId, savedQuestion);
    setActiveView("practice");
  }

  function chooseQuestion(id: string) {
    setCurrentId(id);
    setActiveView("practice");
  }

  function openView(view: View) {
    setActiveView(view);
    setMobileNavOpen(false);
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
    setResult({ correct, message: correct ? "回答正确" : `回答错误，正确答案：${current.answer}` });
    await recordAttempt(current, userAnswer, correct);
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
      setResult({ correct, score: payload.score, feedback: payload.feedback, message: `AI 评分：${payload.score ?? 0} 分` });
      await recordAttempt(current, textAnswer, correct);
      setStatus("");
      void loadExplanationForQuestion(current);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "评分失败");
    }
  }

  async function recordAttempt(question: Question, userAnswer: string, correct: boolean) {
    const seconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
    const nextState = await authJson("/api/me/attempt", {
      method: "POST",
      body: JSON.stringify({ questionId: question.id, answer: userAnswer, correct, seconds }),
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

  async function startPrewarm() {
    const payload = await authJson("/api/explanations/prewarm", { method: "POST" });
    setStatus(payload.started ? "已开始后台初始化解析。" : "初始化任务已经在运行。");
    void refreshHealth();
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

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Brain size={28} />
          <div>
            <strong>SolveMate</strong>
            <span>{userState.username || "local"} · {questions.length} 题</span>
          </div>
          <button className="mobile-menu-toggle" onClick={() => setMobileNavOpen((open) => !open)} title="展开导航">
            <Menu size={18} />
            <span>菜单</span>
          </button>
        </div>

        <div className={mobileNavOpen ? "mobile-nav-panel open" : "mobile-nav-panel"}>
          <div className="bank-switcher">
            {banks.map((bank) => (
              <button
                key={bank.id}
                className={bank.id === activeBankId ? "bank-tab active" : "bank-tab"}
                onClick={() => {
                  switchBank(bank.id);
                  setMobileNavOpen(false);
                }}
              >
                {bank.isLegacy ? <History size={16} /> : <Library size={16} />}
                <span>{bank.isLegacy ? "过往题库" : "当前题库"}</span>
              </button>
            ))}
          </div>

          <nav className="nav">
            <button className={activeView === "practice" ? "active" : ""} onClick={() => openView("practice")}>
              <Target size={18} /> 练习
            </button>
            <button className={activeView === "bank" ? "active" : ""} onClick={() => openView("bank")}>
              <Library size={18} /> 题库
            </button>
            <button className={activeView === "stats" ? "active" : ""} onClick={() => openView("stats")}>
              <BarChart3 size={18} /> 统计
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
            <strong>{emptyPoolMessage(practiceMode)}</strong>
            <span>可以切换题型、切换模式，或收藏题目后再进入收藏刷题。</span>
          </section>
        )}

        {activeView === "practice" && filtered.length > 0 && (
          <div className="practice-layout">
            <section className={["question-panel", result ? "answered" : "", result?.correct ? "answered-correct" : result ? "answered-wrong" : ""].filter(Boolean).join(" ")}>
              <div className="question-card-head">
                <div className="question-meta">
                  <span>{current.rawType}</span>
                  <span>#{current.sourceIndex}</span>
                  {currentIndex >= 0 && <span>{currentIndex + 1}/{filtered.length}</span>}
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
                      <input value={answer} placeholder={`填写第 ${index + 1} 空`} onChange={(event) => updateFillAnswer(index, event.target.value)} />
                    </label>
                  ))}
                </div>
              )}

              {current.type === "short" && (
                <textarea className="answer-box" value={textAnswer} rows={7} placeholder="输入答案，提交后调用 AI 快速评分" onChange={(event) => setTextAnswer(event.target.value)} />
              )}

              {result && (
                <div className={result.correct ? "result correct" : "result wrong"}>
                  {result.correct ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                  <div>
                    <strong>{result.message}</strong>
                    {result.feedback && <p>{result.feedback}</p>}
                    {!result.correct && <p>标准答案：{current.answer}</p>}
                  </div>
                </div>
              )}

              <div className="question-actions">
                <button className="primary" onClick={submitAnswer} disabled={Boolean(result)}>
                  {current.type === "short" ? "AI 评分" : "提交答案"}
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
          <QuestionBank questions={bankQuestions} total={questions.length} search={bankSearch} currentId={current.id} onSearch={setBankSearch} onChoose={chooseQuestion} />
        )}

        {activeView === "stats" && (
          <StatsView
            questions={questions}
            state={userState}
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
            renderMeta={(question) => `错误 ${userState.mistakes[question.id]?.count || 0} 次`}
          />
        )}

        {activeView === "favorites" && <QuestionList title="收藏题目" questions={favoriteQuestions} empty="当前题库还没有收藏题目。" onChoose={chooseQuestion} />}

        {activeView === "ai" && <AiStatus health={health} onRefresh={refreshHealth} onPrewarm={startPrewarm} />}
      </section>
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
      <div className="explanation">{explanationLoading ? "解析加载中..." : explanation || "暂无解析内容。"}</div>

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
  accuracy,
  averageSeconds,
  calendarMonth,
  onCalendarMonth,
  onReset,
  onChoose,
}: {
  questions: Question[];
  state: UserState;
  accuracy: number;
  averageSeconds: number;
  calendarMonth: string;
  onCalendarMonth: (month: string) => void;
  onReset: () => void;
  onChoose: (id: string) => void;
}) {
  const today = state.stats.daily[chinaDateKey()] || { attempts: 0, correct: 0, totalSeconds: 0 };
  const month = state.stats.monthly[chinaMonthKey()] || { attempts: 0, correct: 0, totalSeconds: 0 };
  const practiced = Object.entries(state.stats.byQuestion)
    .map(([id, stat]) => ({ question: questions.find((item) => item.id === id), stat }))
    .filter((item) => item.question)
    .sort((a, b) => b.stat.attempts - a.stat.attempts)
    .slice(0, 10);

  return (
    <section className="dashboard">
      <div className="metric-grid">
        <Metric label="总作答" value={state.stats.attempts.toString()} icon={<ListChecks size={18} />} />
        <Metric label="总正确率" value={`${accuracy}%`} icon={<Trophy size={18} />} />
        <Metric label="平均用时" value={formatSeconds(averageSeconds)} icon={<Timer size={18} />} />
        <Metric label="连续签到" value={`${state.checkins.streak} 天`} icon={<CalendarCheck size={18} />} />
        <Metric label="今日作答" value={today.attempts.toString()} icon={<Target size={18} />} />
        <Metric label="今日正确率" value={formatAccuracy(today)} icon={<CheckCircle2 size={18} />} />
        <Metric label="本月作答" value={month.attempts.toString()} icon={<BarChart3 size={18} />} />
        <Metric label="错题数" value={Object.keys(state.mistakes).length.toString()} icon={<XCircle size={18} />} />
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

function QuestionBank({
  questions,
  total,
  search,
  currentId,
  onSearch,
  onChoose,
}: {
  questions: Question[];
  total: number;
  search: string;
  currentId: string;
  onSearch: (value: string) => void;
  onChoose: (id: string) => void;
}) {
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
      </div>

      {questions.length === 0 ? (
        <p className="empty">没有匹配的题目。</p>
      ) : (
        <div className="bank-list">
          {questions.map((question) => (
            <button key={question.id} className={question.id === currentId ? "bank-row active" : "bank-row"} onClick={() => onChoose(question.id)}>
              <span className="bank-row-index">#{question.sourceIndex}</span>
              <span className="bank-row-main">
                <strong>{question.prompt}</strong>
                <em>{question.rawType}{question.type === "fill" ? ` · ${getBlankCount(question)} 空` : ""}</em>
              </span>
              <span className="bank-row-answer">{question.answer}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function AiStatus({ health, onRefresh, onPrewarm }: { health: Health | null; onRefresh: () => void; onPrewarm: () => void }) {
  return (
    <section className="dashboard">
      <div className="metric-grid">
        <Metric label="AI 状态" value={health?.ai.configured ? "已配置" : "未配置"} icon={<Sparkles size={18} />} />
        <Metric label="缓存解析" value={`${health?.explanationCacheCount || 0}/${health?.questionCount || 0}`} icon={<Library size={18} />} />
        <Metric label="预生成进度" value={`${health?.pregen.done || 0}/${health?.pregen.total || 0}`} icon={<RotateCw size={18} />} />
        <Metric label="失败数" value={`${health?.pregen.failed || 0}`} icon={<XCircle size={18} />} />
      </div>
      <div className="table-panel">
        <div className="table-head">
          <strong>解析初始化</strong>
          <div className="inline-actions">
            <button className="icon-text" onClick={onRefresh}><RotateCw size={18} /> 刷新</button>
            <button className="primary" onClick={onPrewarm}>初始化全部解析</button>
          </div>
        </div>
        <p className="muted">模型：{health?.ai.model || "未设置"}，服务：{health?.ai.baseUrl || "未设置"}</p>
        {health?.pregen.running && <p className="muted">后台任务运行中，已处理 {health.pregen.done} 道题，其中跳过缓存 {health.pregen.cached} 道。</p>}
        {health?.pregen.lastError && <p className="error-text">{health.pregen.lastError}</p>}
      </div>
    </section>
  );
}

function QuestionList({
  title,
  questions,
  empty,
  onChoose,
  renderMeta,
}: {
  title: string;
  questions: Question[];
  empty: string;
  onChoose: (id: string) => void;
  renderMeta?: (question: Question) => string;
}) {
  return (
    <section className="table-panel">
      <div className="table-head">
        <strong>{title}</strong>
        <span>{questions.length} 道</span>
      </div>
      {questions.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        questions.map((question) => (
          <button key={question.id} className="row-item" onClick={() => onChoose(question.id)}>
            <span>{question.prompt}</span>
            <em>{renderMeta?.(question) || question.rawType}</em>
          </button>
        ))
      )}
    </section>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="metric">
      <span>{icon}{label}</span>
      <strong>{value}</strong>
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
