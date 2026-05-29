import {
  ArrowLeft,
  BarChart3,
  Bookmark,
  BookmarkCheck,
  Brain,
  CheckCircle2,
  Clock3,
  Library,
  MessageSquareText,
  RefreshCcw,
  RotateCw,
  Search,
  Shuffle,
  Sparkles,
  Target,
  XCircle,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type QuestionType = "single" | "multiple" | "judge" | "fill" | "short" | "unknown";

type Question = {
  id: string;
  excelRow: number;
  prompt: string;
  rawType: string;
  type: QuestionType;
  options: { key: string; text: string }[];
  answer: string;
  answerKeys: string[];
};

type UserState = {
  favorites: string[];
  mistakes: Record<string, { count: number; lastAt: string; lastAnswer: string }>;
  stats: {
    attempts: number;
    correct: number;
    totalSeconds: number;
    byQuestion: Record<string, { attempts: number; correct: number; totalSeconds: number }>;
  };
};

type ResultState = {
  correct: boolean;
  message: string;
  score?: number;
  feedback?: string;
};

type Health = {
  questionCount: number;
  ai: { configured: boolean; model: string; baseUrl: string };
  explanationCacheCount: number;
  pregen: { running: boolean; total: number; done: number; cached: number; failed: number; lastError: string };
};

type ChatMessage = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "solvemate-state-v1";
const EMPTY_STATE: UserState = {
  favorites: [],
  mistakes: {},
  stats: { attempts: 0, correct: 0, totalSeconds: 0, byQuestion: {} },
};

const typeLabels: Record<QuestionType, string> = {
  single: "单选",
  multiple: "多选",
  judge: "判断",
  fill: "填空",
  short: "简答",
  unknown: "其他",
};

export function App() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [activeView, setActiveView] = useState<"practice" | "bank" | "stats" | "mistakes" | "favorites" | "ai">("practice");
  const [typeFilter, setTypeFilter] = useState<QuestionType | "all">("all");
  const [currentId, setCurrentId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [textAnswer, setTextAnswer] = useState("");
  const [fillAnswers, setFillAnswers] = useState<string[]>([]);
  const [bankSearch, setBankSearch] = useState("");
  const [result, setResult] = useState<ResultState | null>(null);
  const [state, setState] = useState<UserState>(() => loadState());
  const [explanation, setExplanation] = useState("");
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(Date.now());
  const currentIdRef = useRef("");

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

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
    const timer = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [currentId, questions]);

  const filtered = useMemo(() => {
    return typeFilter === "all" ? questions : questions.filter((question) => question.type === typeFilter);
  }, [questions, typeFilter]);

  const current = useMemo(
    () => questions.find((question) => question.id === currentId) || filtered[0] || questions[0],
    [questions, currentId, filtered],
  );

  const currentIndex = useMemo(() => filtered.findIndex((question) => question.id === current?.id), [filtered, current]);

  const bankQuestions = useMemo(() => {
    const term = normalizeSearch(bankSearch);
    if (!term) return filtered;
    return filtered.filter((question) =>
      normalizeSearch(`${question.excelRow} ${question.rawType} ${question.prompt} ${question.answer}`).includes(term),
    );
  }, [filtered, bankSearch]);

  const visibleMistakes = useMemo(
    () => Object.keys(state.mistakes).map((id) => questions.find((question) => question.id === id)).filter(Boolean) as Question[],
    [questions, state.mistakes],
  );

  const favoriteQuestions = useMemo(
    () => state.favorites.map((id) => questions.find((question) => question.id === id)).filter(Boolean) as Question[],
    [questions, state.favorites],
  );

  const accuracy = state.stats.attempts ? Math.round((state.stats.correct / state.stats.attempts) * 100) : 0;
  const isFavorite = current ? state.favorites.includes(current.id) : false;

  async function bootstrap() {
    const [questionPayload, healthPayload] = await Promise.all([
      fetch("/api/questions").then((res) => res.json()),
      fetch("/api/health").then((res) => res.json()),
    ]);
    setQuestions(questionPayload.questions);
    setCurrentId(questionPayload.questions[0]?.id || "");
    setHealth(healthPayload);
  }

  function chooseQuestion(id: string) {
    setCurrentId(id);
    setActiveView("practice");
  }

  function chooseRandom() {
    const pool = filtered.length ? filtered : questions;
    const next = pool[Math.floor(Math.random() * pool.length)];
    if (next) chooseQuestion(next.id);
  }

  function chooseNext() {
    const pool = filtered.length ? filtered : questions;
    const index = pool.findIndex((question) => question.id === current?.id);
    const nextIndex = index >= 0 ? (index + 1) % pool.length : 0;
    chooseQuestion(pool[nextIndex]?.id || pool[0]?.id);
  }

  function choosePrevious() {
    const pool = filtered.length ? filtered : questions;
    const index = pool.findIndex((question) => question.id === current?.id);
    const previousIndex = index >= 0 ? (index - 1 + pool.length) % pool.length : pool.length - 1;
    chooseQuestion(pool[previousIndex]?.id || pool[0]?.id);
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
    if (current.type === "fill" && fillAnswers.some((answer) => !answer.trim())) {
      setStatus("请填写所有空。");
      return;
    }
    if (!userAnswer.trim()) {
      setStatus("请先作答。");
      return;
    }

    const correct =
      current.type === "multiple" || current.type === "single"
        ? normalizeChoice(userAnswer) === normalizeChoice(current.answer)
        : normalizeText(userAnswer) === normalizeText(current.answer);
    const nextResult = {
      correct,
      message: correct ? "回答正确" : `回答错误，正确答案：${current.answer}`,
    };
    setResult(nextResult);
    recordAttempt(current, userAnswer, correct);
    void loadCachedExplanation(current);
  }

  async function gradeShortAnswer() {
    if (!current || !textAnswer.trim()) {
      setStatus("请先填写简答题答案。");
      return;
    }

    setStatus("正在调用 AI 评分...");
    try {
      const res = await fetch(`/api/questions/${current.id}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: textAnswer }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "评分失败");
      const correct = Number(payload.score) >= 60;
      setResult({
        correct,
        score: payload.score,
        feedback: payload.feedback,
        message: `AI 评分：${payload.score ?? 0} 分`,
      });
      recordAttempt(current, textAnswer, correct);
      setStatus("");
      void loadCachedExplanation(current);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "评分失败");
    }
  }

  function recordAttempt(question: Question, userAnswer: string, correct: boolean) {
    const seconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
    setState((old) => {
      const previous = old.stats.byQuestion[question.id] || { attempts: 0, correct: 0, totalSeconds: 0 };
      const mistakes = { ...old.mistakes };
      if (!correct) {
        const mistake = mistakes[question.id] || { count: 0, lastAt: "", lastAnswer: "" };
        mistakes[question.id] = {
          count: mistake.count + 1,
          lastAt: new Date().toISOString(),
          lastAnswer: userAnswer,
        };
      }

      return {
        ...old,
        mistakes,
        stats: {
          attempts: old.stats.attempts + 1,
          correct: old.stats.correct + (correct ? 1 : 0),
          totalSeconds: old.stats.totalSeconds + seconds,
          byQuestion: {
            ...old.stats.byQuestion,
            [question.id]: {
              attempts: previous.attempts + 1,
              correct: previous.correct + (correct ? 1 : 0),
              totalSeconds: previous.totalSeconds + seconds,
            },
          },
        },
      };
    });
  }

  function toggleFavorite() {
    if (!current) return;
    setState((old) => {
      const exists = old.favorites.includes(current.id);
      return {
        ...old,
        favorites: exists ? old.favorites.filter((id) => id !== current.id) : [...old.favorites, current.id],
      };
    });
  }

  async function loadExplanation(refresh = false) {
    if (!current) return;
    setExplanationLoading(true);
    setStatus(refresh ? "正在重新生成解析..." : "正在读取 AI 解析...");
    try {
      const res = await fetch(`/api/questions/${current.id}/explanation${refresh ? "?refresh=1" : ""}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "解析生成失败");
      setExplanation(payload.explanation);
      setStatus(payload.cached ? "已读取缓存解析。" : "已生成并缓存解析。");
      void refreshHealth();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "解析生成失败");
    } finally {
      setExplanationLoading(false);
    }
  }

  async function loadCachedExplanation(question: Question) {
    try {
      const res = await fetch(`/api/questions/${question.id}/explanation?cacheOnly=1`);
      if (!res.ok) return;
      const payload = await res.json();
      if (currentIdRef.current !== question.id) return;
      setExplanation(payload.explanation);
      setStatus("已显示缓存解析。");
      void refreshHealth();
    } catch {
      // Cached explanation loading is opportunistic after answering.
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
      const res = await fetch(`/api/questions/${current.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history: chat }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "问答失败");
      setChat([...nextHistory, { role: "assistant", content: payload.answer }]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "问答失败");
    } finally {
      setChatLoading(false);
    }
  }

  async function startPrewarm() {
    const res = await fetch("/api/explanations/prewarm", { method: "POST" });
    const payload = await res.json();
    setStatus(payload.started ? "已开始后台初始化解析。" : "初始化任务已经在运行。");
    void refreshHealth();
  }

  async function refreshHealth() {
    const payload = await fetch("/api/health").then((res) => res.json());
    setHealth(payload);
  }

  function resetLocalStats() {
    if (!confirm("确定清空本地刷题记录、错题和收藏吗？")) return;
    setState(EMPTY_STATE);
  }

  if (!current) {
    return <div className="loading">正在加载题库...</div>;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Brain size={28} />
          <div>
            <strong>SolveMate</strong>
            <span>{questions.length} 题</span>
          </div>
        </div>

        <nav className="nav">
          <button className={activeView === "practice" ? "active" : ""} onClick={() => setActiveView("practice")}>
            <Target size={18} /> 练习
          </button>
          <button className={activeView === "bank" ? "active" : ""} onClick={() => setActiveView("bank")}>
            <Library size={18} /> 题库
          </button>
          <button className={activeView === "stats" ? "active" : ""} onClick={() => setActiveView("stats")}>
            <BarChart3 size={18} /> 统计
          </button>
          <button className={activeView === "mistakes" ? "active" : ""} onClick={() => setActiveView("mistakes")}>
            <XCircle size={18} /> 错题
          </button>
          <button className={activeView === "favorites" ? "active" : ""} onClick={() => setActiveView("favorites")}>
            <Bookmark size={18} /> 收藏
          </button>
          <button className={activeView === "ai" ? "active" : ""} onClick={() => setActiveView("ai")}>
            <Sparkles size={18} /> AI
          </button>
        </nav>

        <div className="sidebar-footer">
          <span>正确率 {accuracy}%</span>
          <span>用时 {formatSeconds(state.stats.totalSeconds)}</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="filters">
            {(["all", "single", "multiple", "judge", "fill", "short"] as const).map((type) => (
              <button key={type} className={typeFilter === type ? "chip active" : "chip"} onClick={() => setTypeFilter(type)}>
                {type === "all" ? "全部" : typeLabels[type]}
              </button>
            ))}
          </div>
          <div className="top-actions">
            <button className="icon-button" title="随机刷题" onClick={chooseRandom}>
              <Shuffle size={18} />
            </button>
            <button className="action" onClick={choosePrevious}>
              <ArrowLeft size={18} />
              上一题
            </button>
            <button className="action" onClick={chooseNext}>
              下一题
            </button>
          </div>
        </header>

        {status && <div className="status-line">{status}</div>}

        {activeView === "practice" && (
          <div className="practice-layout">
            <section className="question-panel">
              <div className="question-meta">
                <span>{current.rawType}</span>
                <span>Excel 第 {current.excelRow} 行</span>
                {currentIndex >= 0 && <span>{currentIndex + 1}/{filtered.length}</span>}
                <span>
                  <Clock3 size={14} /> {formatSeconds(elapsed)}
                </span>
              </div>

              <h1>{current.prompt}</h1>

              {current.type !== "fill" && current.type !== "short" && (
                <div className="options">
                  {current.options.map((option) => {
                    const checked = selected.includes(option.key);
                    return (
                      <button key={option.key} className={checked ? "option checked" : "option"} onClick={() => toggleOption(option.key)}>
                        <span>{option.key}</span>
                        <p>{option.text}</p>
                      </button>
                    );
                  })}
                </div>
              )}

              {current.type === "fill" && (
                <div className="fill-grid">
                  {fillAnswers.map((answer, index) => (
                    <label key={`${current.id}-${index}`} className="fill-input">
                      <span>空 {index + 1}</span>
                      <input
                        value={answer}
                        placeholder={`填写第 ${index + 1} 空`}
                        onChange={(event) => updateFillAnswer(index, event.target.value)}
                      />
                    </label>
                  ))}
                </div>
              )}

              {current.type === "short" && (
                <textarea
                  className="answer-box"
                  value={textAnswer}
                  rows={7}
                  placeholder="输入简答题答案，提交后调用 AI 快速评分"
                  onChange={(event) => setTextAnswer(event.target.value)}
                />
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
                <button className="icon-text" onClick={toggleFavorite}>
                  {isFavorite ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
                  {isFavorite ? "已收藏" : "收藏"}
                </button>
                <button className="icon-text" onClick={() => loadExplanation(false)} disabled={explanationLoading}>
                  <Sparkles size={18} />
                  AI 解析
                </button>
              </div>
            </section>

            <section className="ai-panel">
              <div className="panel-title">
                <Sparkles size={18} />
                <strong>AI 解析</strong>
                <button title="重新生成" className="icon-button compact" onClick={() => loadExplanation(true)}>
                  <RefreshCcw size={16} />
                </button>
              </div>
              <div className="explanation">
                {explanationLoading ? "正在处理..." : explanation || "点击“AI 解析”读取缓存或生成解析。"}
              </div>

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
              <form className="chat-form" onSubmit={askAi}>
                <input value={chatInput} placeholder="围绕本题继续提问" onChange={(event) => setChatInput(event.target.value)} />
                <button className="primary" type="submit">
                  发送
                </button>
              </form>
            </section>
          </div>
        )}

        {activeView === "bank" && (
          <QuestionBank
            questions={bankQuestions}
            total={filtered.length}
            search={bankSearch}
            currentId={current.id}
            onSearch={setBankSearch}
            onChoose={chooseQuestion}
          />
        )}

        {activeView === "stats" && (
          <StatsView
            questions={questions}
            state={state}
            accuracy={accuracy}
            onReset={resetLocalStats}
            onChoose={chooseQuestion}
          />
        )}

        {activeView === "mistakes" && (
          <QuestionList
            title="错题记录"
            questions={visibleMistakes}
            empty="还没有错题记录。"
            onChoose={chooseQuestion}
            renderMeta={(question) => `错误 ${state.mistakes[question.id]?.count || 0} 次`}
          />
        )}

        {activeView === "favorites" && (
          <QuestionList title="收藏题目" questions={favoriteQuestions} empty="还没有收藏题目。" onChoose={chooseQuestion} />
        )}

        {activeView === "ai" && (
          <AiStatus health={health} onRefresh={refreshHealth} onPrewarm={startPrewarm} />
        )}
      </section>
    </main>
  );
}

function StatsView({
  questions,
  state,
  accuracy,
  onReset,
  onChoose,
}: {
  questions: Question[];
  state: UserState;
  accuracy: number;
  onReset: () => void;
  onChoose: (id: string) => void;
}) {
  const practiced = Object.entries(state.stats.byQuestion)
    .map(([id, stat]) => ({ question: questions.find((item) => item.id === id), stat }))
    .filter((item) => item.question)
    .sort((a, b) => b.stat.attempts - a.stat.attempts)
    .slice(0, 8);

  return (
    <section className="dashboard">
      <div className="metric-grid">
        <Metric label="总作答" value={state.stats.attempts.toString()} />
        <Metric label="正确率" value={`${accuracy}%`} />
        <Metric label="累计用时" value={formatSeconds(state.stats.totalSeconds)} />
        <Metric label="错题数" value={Object.keys(state.mistakes).length.toString()} />
      </div>

      <div className="table-panel">
        <div className="table-head">
          <strong>高频练习</strong>
          <button className="danger" onClick={onReset}>
            清空本地记录
          </button>
        </div>
        {practiced.length === 0 ? (
          <p className="empty">还没有作答记录。</p>
        ) : (
          practiced.map(({ question, stat }) => (
            <button key={question!.id} className="row-item" onClick={() => onChoose(question!.id)}>
              <span>{question!.prompt}</span>
              <em>
                {stat.correct}/{stat.attempts} · {formatSeconds(stat.totalSeconds)}
              </em>
            </button>
          ))
        )}
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
          <span>
            显示 {questions.length}/{total} 道
          </span>
        </div>
        <label className="search-box">
          <Search size={18} />
          <input value={search} placeholder="搜索题干、答案、题型或 Excel 行号" onChange={(event) => onSearch(event.target.value)} />
        </label>
      </div>

      {questions.length === 0 ? (
        <p className="empty">没有匹配的题目。</p>
      ) : (
        <div className="bank-list">
          {questions.map((question) => (
            <button
              key={question.id}
              className={question.id === currentId ? "bank-row active" : "bank-row"}
              onClick={() => onChoose(question.id)}
            >
              <span className="bank-row-index">#{question.excelRow}</span>
              <span className="bank-row-main">
                <strong>{question.prompt}</strong>
                <em>
                  {question.rawType}
                  {question.type === "fill" ? ` · ${getBlankCount(question)} 空` : ""}
                </em>
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
        <Metric label="AI 状态" value={health?.ai.configured ? "已配置" : "未配置"} />
        <Metric label="缓存解析" value={`${health?.explanationCacheCount || 0}/${health?.questionCount || 0}`} />
        <Metric label="预生成进度" value={`${health?.pregen.done || 0}/${health?.pregen.total || 0}`} />
        <Metric label="失败数" value={`${health?.pregen.failed || 0}`} />
      </div>
      <div className="table-panel">
        <div className="table-head">
          <strong>解析初始化</strong>
          <div className="inline-actions">
            <button className="icon-text" onClick={onRefresh}>
              <RotateCw size={18} /> 刷新
            </button>
            <button className="primary" onClick={onPrewarm}>
              初始化全部解析
            </button>
          </div>
        </div>
        <p className="muted">模型：{health?.ai.model || "未设置"}，服务：{health?.ai.baseUrl || "未设置"}</p>
        {health?.pregen.running && <p className="muted">后台任务运行中，已处理 {health.pregen.done} 道题。</p>}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function loadState(): UserState {
  try {
    return { ...EMPTY_STATE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return EMPTY_STATE;
  }
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

function getBlankCount(question: Question) {
  const promptBlanks = question.prompt.match(/（\s*）|\(\s*\)|_{2,}|【\s*】/g)?.length || 0;
  const answerParts = question.answer
    .split(/[;；]/)
    .map((part) => part.trim())
    .filter(Boolean).length;
  return Math.max(1, promptBlanks, answerParts);
}

function formatSeconds(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
