import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  History,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Wallet,
  X,
  AlertCircle,
  Eye,
  Trash2,
  Pencil,
  ExternalLink,
} from "lucide-react";
import type {
  Ledger,
  LedgerEvent,
  Period,
  Transaction,
  TransactionType,
  User,
} from "./types";
import { books, bookFor, type BookId } from "./books";
import { typeLabel } from "./types";
import {
  categoryTotals,
  filterTransactions,
  money,
  parseAmount,
  periodFor,
  summary,
  today,
  validDate,
} from "./ledger";
import { demoLedger } from "./demo";
import { api } from "./api";
import { LedgerCache } from "./ledger-cache";
import { BrandMotion } from "./BrandMotion";

const navigation = [
  { id: "overview", label: "财务总览", icon: LayoutDashboard },
  { id: "ledger", label: "账目明细", icon: BookOpen },
  { id: "reports", label: "财政报告", icon: FileText },
  { id: "activity", label: "修改记录", icon: History },
  { id: "settings", label: "账本设置", icon: Settings },
];
const palette = [
  "#2563eb",
  "#06b6d4",
  "#7c5ce7",
  "#13366d",
  "#799aed",
  "#bcccf0",
];
const emptyForm = {
  date: today(),
  type: "expense" as TransactionType,
  category: "教职员福利",
  description: "",
  amount: "",
  party: "",
  note: "",
};
type FormValues = typeof emptyForm;
type Session = { user: User | null; configured: boolean; ledger?: Ledger };
const initialSession = api<Session>("session");
const syncTime = (at = Date.now()) =>
  new Date(at).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    closeRef = useRef(onClose),
    busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const root = ref.current;
    const nodes = () =>
      Array.from(
        root?.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,[tabindex="0"]',
        ) || [],
      ).filter((x) => !x.hasAttribute("disabled"));
    nodes()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) closeRef.current();
      if (e.key === "Tab") {
        const n = nodes(),
          first = n[0],
          last = n[n.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function App() {
  const [bookId, setBookId] = useState<BookId>("teachers");
  const selectedBook = books[bookId];
  const { incomeCategories, expenseCategories } = selectedBook;
  const requestGeneration = useRef(0);
  const demoBooks = useRef<Partial<Record<BookId, Ledger>>>({});
  const bookCache = useRef(new LedgerCache());
  const [session, setSession] = useState<Session | null>(null),
    [bootError, setBootError] = useState("");
  const [demo, setDemo] = useState(false),
    [ledger, setLedger] = useState<Ledger | null>(null),
    [view, setView] = useState("overview"),
    [mobileNav, setMobileNav] = useState(false);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [lastSync, setLastSync] = useState("");
  const [year, setYear] = useState(Number(today().slice(0, 4))),
    [mode, setMode] = useState("year"),
    [month, setMonth] = useState(Number(today().slice(5, 7))),
    [customStart, setCustomStart] = useState(today().slice(0, 4) + "-01-01"),
    [customEnd, setCustomEnd] = useState(today());
  const [query, setQuery] = useState(""),
    [typeFilter, setTypeFilter] = useState<TransactionType | "all">("all"),
    [category, setCategory] = useState(""),
    [statusFilter, setStatusFilter] = useState("active"),
    [page, setPage] = useState(1);
  const [form, setForm] = useState<FormValues | null>(null),
    [editing, setEditing] = useState<Transaction | null>(null),
    [saving, setSaving] = useState(false),
    [formError, setFormError] = useState(""),
    [voidTarget, setVoidTarget] = useState<Transaction | null>(null),
    [voidReason, setVoidReason] = useState("");
  const [printKind, setPrintKind] = useState<"report" | "search">("report");
  const eventId = useRef("");
  const period = periodFor(year, mode, month, customStart, customEnd);
  const periodValid =
    validDate(period.start) &&
    validDate(period.end) &&
    period.start <= period.end &&
    (!ledger || period.start >= ledger.openingDate);
  const user = demo
    ? { username: "demo", displayName: "演示财政", role: "admin" as const }
    : session?.user;
  const canWrite = user?.role !== "viewer";
  useEffect(() => {
    initialSession
      .then(setSession)
      .catch(() => setBootError("暂时无法连接，请刷新页面重试。"));
  }, []);
  useEffect(() => {
    if (session?.user && !demo) {
      if (bookCache.current.fresh(bookId)) setLoading(false);
      else void refresh();
    }
  }, [session?.user, demo, bookId]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(
    () => setPage(1),
    [
      query,
      typeFilter,
      category,
      statusFilter,
      year,
      mode,
      month,
      customStart,
      customEnd,
    ],
  );
  async function refresh() {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError("");
    try {
      const data = await api<Ledger>("ledger", {}, bookId);
      if (generation !== requestGeneration.current) return;
      if (data.id !== bookId) throw new Error("账本载入不一致，请重新连接");
      bookCache.current.set(bookId, data);
      setLedger(data);
      setLastSync(
        new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    } catch (e) {
      if (generation === requestGeneration.current)
        setError((e as Error).message);
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }
  function startDemo() {
    setDemo(true);
    const data = demoLedger(bookId);
    demoBooks.current = { [bookId]: data };
    setLedger(data);
    setLastSync("");
    setError("");
  }
  async function logout() {
    try {
      if (!demo) await api("logout", { method: "POST" });
      ++requestGeneration.current;
      bookCache.current.clear();
      demoBooks.current = {};
      setDemo(false);
      setSession((s) => ({ configured: s?.configured ?? true, user: null }));
      setLedger(null);
      setView("overview");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function navigate(id: string) {
    setView(id);
    setMobileNav(false);
  }
  function switchBook(id: BookId) {
    if (id === bookId || saving || form || voidTarget) return;
    ++requestGeneration.current;
    if (demo && ledger) demoBooks.current[bookId] = ledger;
    setBookId(id);
    const cached = bookCache.current.get(id);
    setLedger(
      demo
        ? (demoBooks.current[id] ||= demoLedger(id))
        : (cached?.ledger ?? null),
    );
    setLoading(!demo && !bookCache.current.fresh(id));
    setLastSync(!demo && cached ? syncTime(cached.at) : "");
    setError("");
    setToast("");
    setQuery("");
    setCategory("");
    setTypeFilter("all");
    setStatusFilter("active");
    setPage(1);
  }
  function openForm(t?: Transaction) {
    setEditing(t || null);
    setForm(
      t
        ? {
            date: t.date,
            type: t.type,
            category: t.category,
            description: t.description,
            amount: (t.amountCents / 100).toFixed(2),
            party: t.party,
            note: t.note,
          }
        : { ...emptyForm, date: today(), category: expenseCategories[0] },
    );
    setFormError("");
    eventId.current = crypto.randomUUID();
  }
  function closeForm() {
    if (saving) return;
    setForm(null);
    setEditing(null);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form || !ledger) return;
    setFormError("");
    try {
      if (!validDate(form.date) || form.date < ledger.openingDate)
        throw new Error("日期必须有效，且不得早于账本启用日期");
      if (!form.description.trim()) throw new Error("请填写账目项目");
      const amountCents = parseAmount(form.amount);
      ++requestGeneration.current;
      setLoading(false);
      setSaving(true);
      const now = new Date().toISOString();
      const transaction: Transaction = {
        id: editing?.id || "CHB-" + crypto.randomUUID(),
        date: form.date,
        type: form.type,
        category: form.category,
        description: form.description.trim(),
        amountCents,
        party: form.party.trim(),
        note: form.note.trim(),
        status: "active",
        version: editing?.version || 0,
        createdAt: editing?.createdAt || now,
        updatedAt: now,
        operator: user!.displayName,
        source: editing?.source || "app",
      };
      const data = demo
        ? applyDemo(transaction, editing ? "edit" : "create")
        : await api<Ledger>("transactions", {
            method: "POST",
            body: JSON.stringify({
              ledgerId: bookId,
              eventId: eventId.current,
              action: editing ? "edit" : "create",
              transaction,
              expectedVersion: editing?.version || 0,
            }),
          });
      if (!demo) bookCache.current.set(bookId, data);
      setLedger(data);
      setForm(null);
      setEditing(null);
      setToast(
        demo
          ? "演示账目已保存，仅在本次页面有效"
          : "账目已保存至 Google Sheets",
      );
      if (!demo)
        setLastSync(
          new Date().toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function applyDemo(t: Transaction, action: string): Ledger {
    const updated = { ...t, version: t.version + 1 };
    const event: LedgerEvent = {
      eventId: eventId.current,
      action,
      transaction: updated,
      at: new Date().toISOString(),
      actor: user!.displayName,
    };
    return {
      ...ledger!,
      transactions: [
        ...ledger!.transactions.filter((x) => x.id !== t.id),
        updated,
      ],
      events: [event, ...ledger!.events],
    };
  }
  async function voidEntry() {
    if (!voidTarget || !voidReason.trim()) return;
    ++requestGeneration.current;
    setLoading(false);
    setSaving(true);
    setFormError("");
    try {
      const transaction = {
        ...voidTarget,
        status: "void" as const,
        note: [voidTarget.note, "作废原因：" + voidReason.trim()]
          .filter(Boolean)
          .join("\n"),
      };
      const data = demo
        ? applyDemo(transaction, "void")
        : await api<Ledger>("transactions", {
            method: "POST",
            body: JSON.stringify({
              ledgerId: bookId,
              eventId: eventId.current,
              action: "void",
              transaction,
              expectedVersion: voidTarget.version,
            }),
          });
      if (!demo) bookCache.current.set(bookId, data);
      setLedger(data);
      if (!demo) setLastSync(syncTime());
      setVoidTarget(null);
      setToast("账目已作废，原始记录仍可查询");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const stats = useMemo(
    () => (ledger ? summary(ledger, period) : null),
    [ledger, period.start, period.end],
  );
  const periodRows =
    ledger?.transactions.filter(
      (t) => t.date >= period.start && t.date <= period.end,
    ) || [];
  const filtered = filterTransactions(
    periodRows,
    query,
    typeFilter,
    category,
    statusFilter,
  );
  const filterIncome = filtered
      .filter((t) => t.status === "active" && t.type === "income")
      .reduce((s, t) => s + t.amountCents, 0),
    filterExpense = filtered
      .filter((t) => t.status === "active" && t.type === "expense")
      .reduce((s, t) => s + t.amountCents, 0);
  function print(kind: "report" | "search") {
    setPrintKind(kind);
    setTimeout(() => window.print(), 100);
  }
  function exportCsv() {
    const esc = (v: string | number) =>
      '"' +
      String(v)
        .replace(/^\s*[=+@-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const rows = [
      [
        "账目编号",
        "日期",
        "类型",
        "分类",
        "项目",
        "金额 RM",
        "往来人",
        "备注",
        "状态",
      ],
      ...filtered.map((t) => [
        t.id,
        t.date,
        typeLabel(t.type),
        t.category,
        t.description,
        (t.amountCents / 100).toFixed(2),
        t.party,
        t.note,
        t.status === "active" ? "有效" : "已作废",
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(
        ["\ufeff" + rows.map((r) => r.map(esc).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedBook.name}_${period.start}_${period.end}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!user)
    return (
      <Login
        configured={session?.configured ?? true}
        checking={!session && !bootError}
        connectionError={bootError}
        onLogin={(s) => {
          ++requestGeneration.current;
          bookCache.current.clear();
          setBookId("teachers");
          setError("");
          if (s.ledger?.id === "teachers") {
            bookCache.current.set("teachers", s.ledger);
            setLedger(s.ledger);
            setLastSync(syncTime());
          }
          setSession({ user: s.user, configured: s.configured });
        }}
        onDemo={startDemo}
      />
    );
  const title = navigation.find((n) => n.id === view)?.label || "财务总览";
  return (
    <>
      <div className="app-shell no-print">
        <aside className={"sidebar " + (mobileNav ? "open" : "")}>
          <div className="brand">
            <img
              src="/icons/icon-blue-192.png"
              alt="中华账簿"
              width="48"
              height="48"
            />
            <div>
              <strong>中华账簿</strong>
            </div>
            <button
              className="icon-button mobile-close"
              aria-label="关闭导航"
              onClick={() => setMobileNav(false)}
            >
              <X />
            </button>
          </div>
          <div className="sidebar-school">文林望中华学校</div>
          <nav>
            {navigation.map((n) => (
              <button
                key={n.id}
                className={view === n.id ? "active" : ""}
                onClick={() => navigate(n.id)}
              >
                <n.icon size={19} />
                <span>{n.label}</span>
                {view === n.id && <span className="nav-active-dot" />}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button className="user-card" onClick={logout} title="退出登录">
              <span className="avatar">{user.displayName.slice(0, 1)}</span>
              <span>
                {user.displayName}
                <small>
                  {demo
                    ? "退出演示"
                    : user.role === "viewer"
                      ? "只读成员"
                      : "财政管理人员"}
                </small>
              </span>
              <LogOut size={17} />
            </button>
          </div>
        </aside>
        {mobileNav && (
          <div className="nav-scrim" onClick={() => setMobileNav(false)} />
        )}
        <main className="workspace">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-menu"
                aria-label="打开导航"
                onClick={() => setMobileNav(true)}
              >
                <Menu />
              </button>
              <span>{selectedBook.name}</span>
              <ChevronRight size={14} />
              <strong>{title}</strong>
            </div>
            <div className="topbar-right">
              <span className="today">
                <CalendarDays size={15} />
                {today().replaceAll("-", " / ")}
              </span>
              <span className={"sync-badge " + (error ? "error" : "")}>
                <span />
                {demo
                  ? "演示模式"
                  : loading
                    ? "正在同步"
                    : lastSync
                      ? "已同步 " + lastSync
                      : "等待同步"}
              </span>
              <button
                className="icon-button"
                aria-label="刷新账本"
                disabled={loading || demo || saving}
                onClick={() => void refresh()}
              >
                <RefreshCw size={17} className={loading ? "spin" : ""} />
              </button>
            </div>
          </header>
          <div className="workspace-body">
            <div className="book-switcher" aria-label="选择账本">
              {(Object.keys(books) as BookId[]).map((id, i) => (
                <button
                  key={id}
                  className={"book-choice " + (bookId === id ? "selected" : "")}
                  aria-pressed={bookId === id}
                  disabled={saving || !!form || !!voidTarget}
                  onClick={() => switchBook(id)}
                >
                  <span className="book-number">0{i + 1}</span>
                  <span>
                    <strong>{books[id].name}</strong>
                  </span>
                  {bookId === id && <CheckCircle2 size={18} />}
                </button>
              ))}
            </div>
            {demo && (
              <div className="demo-banner">
                <Eye size={16} />
                <span>
                  你正在体验演示账本，所有金额均为虚构，操作不会写入学校账目。
                </span>
                <button onClick={logout}>
                  退出演示 <ArrowRight size={14} />
                </button>
              </div>
            )}
            <div className="page-heading">
              <div>
                <h1>{title}</h1>
              </div>
              <div className="heading-actions">
                {(view === "overview" || view === "ledger") && (
                  <>
                    <button
                      className="secondary"
                      disabled={!stats || !periodValid}
                      onClick={() => {
                        setView("reports");
                      }}
                    >
                      <FileText size={17} />
                      查看报告
                    </button>
                    {canWrite && (
                      <button
                        className="primary"
                        disabled={!ledger}
                        onClick={() => openForm()}
                      >
                        <Plus size={19} />
                        记一笔
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            {error && (
              <div className="alert" role="alert">
                <AlertCircle size={18} />
                {error}
                <button onClick={() => void refresh()}>重试</button>
              </div>
            )}
            {ledger && !!ledger.reviewNotes?.length && (
              <details className="review-notes">
                <summary>
                  <AlertCircle size={17} />
                  历史资料待核对 · {ledger.reviewNotes.length} 项
                </summary>
                <ul>
                  {ledger.reviewNotes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
                <p>报表会保留这些说明；可在账目明细中修改已确认的记录。</p>
              </details>
            )}
            {!!stats?.adjustment && (
              <div className="alert">
                本期间跨越历史结转点，另含结转核对差额 RM{" "}
                {money(stats.adjustment)}
                。此差额不列为收入或支出，请参阅报告说明。
              </div>
            )}
            {!ledger ? (
              <div className="loading-state">
                <LoaderCircle className="spin" />
                <p>
                  {loading ? "正在读取学校账本…" : "连接尚未完成，请重试。"}
                </p>
              </div>
            ) : (
              <>
                {["overview", "ledger", "reports"].includes(view) && (
                  <>
                    <div className="period-toolbar">
                      <div className="period-tabs">
                        {[
                          ["month", "月度"],
                          ["h1", "上半年"],
                          ["h2", "下半年"],
                          ["year", "全年"],
                          ["custom", "自定义"],
                        ].map(([key, label]) => (
                          <button
                            key={key}
                            className={mode === key ? "selected" : ""}
                            onClick={() => setMode(key)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="period-selects">
                        {mode === "custom" ? (
                          <>
                            <label>
                              <span className="sr-only">开始日期</span>
                              <input
                                type="date"
                                value={customStart}
                                onChange={(e) => setCustomStart(e.target.value)}
                              />
                            </label>
                            <span>至</span>
                            <label>
                              <span className="sr-only">结束日期</span>
                              <input
                                type="date"
                                value={customEnd}
                                onChange={(e) => setCustomEnd(e.target.value)}
                              />
                            </label>
                          </>
                        ) : (
                          <>
                            <label className="select-wrap">
                              <CalendarDays size={16} />
                              <select
                                aria-label="选择年份"
                                value={year}
                                onChange={(e) =>
                                  setYear(Number(e.target.value))
                                }
                              >
                                {Array.from(
                                  {
                                    length: Math.max(
                                      Number(today().slice(0, 4)) +
                                        2 -
                                        Number(ledger.openingDate.slice(0, 4)),
                                      3,
                                    ),
                                  },
                                  (_, i) =>
                                    Number(ledger.openingDate.slice(0, 4)) + i,
                                ).map((y) => (
                                  <option key={y} value={y}>
                                    {y} 年
                                  </option>
                                ))}
                              </select>
                            </label>
                            {mode === "month" && (
                              <select
                                aria-label="选择月份"
                                value={month}
                                onChange={(e) =>
                                  setMonth(Number(e.target.value))
                                }
                              >
                                {Array.from({ length: 12 }, (_, i) => (
                                  <option key={i + 1} value={i + 1}>
                                    {i + 1} 月
                                  </option>
                                ))}
                              </select>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    {!periodValid && (
                      <div className="alert" role="alert">
                        请选择有效的起止日期，开始日期不能早于账本启用日{" "}
                        {ledger.openingDate}。
                      </div>
                    )}
                  </>
                )}
                {view === "overview" && stats && periodValid && (
                  <>
                    <section className="metric-grid">
                      <div className="balance-card">
                        <div className="balance-top">
                          <span>
                            <Wallet size={18} />
                            期末结余
                          </span>
                          <span className="balance-period">{period.label}</span>
                        </div>
                        <div className="balance-number">
                          <span>RM</span>
                          {money(stats.closing)}
                        </div>
                        <div className="balance-bottom">
                          <span>
                            期初结余 <b>RM {money(stats.opening)}</b>
                          </span>
                          <span className="balance-symbol">↗</span>
                        </div>
                        <div className="balance-orbit" aria-hidden="true" />
                      </div>
                      <MetricCard
                        type="income"
                        value={stats.income}
                        count={
                          stats.rows.filter((t) => t.type === "income").length
                        }
                      />
                      <MetricCard
                        type="expense"
                        value={stats.expense}
                        count={
                          stats.rows.filter((t) => t.type === "expense").length
                        }
                      />
                    </section>
                    <section className="charts-grid">
                      <div className="panel trend-panel">
                        <div className="panel-heading">
                          <div>
                            <h2>收支趋势</h2>
                            <p>{year} 年各月收入与支出</p>
                          </div>
                          <div className="chart-legend">
                            <span>
                              <i className="income-dot" />
                              收入
                            </span>
                            <span>
                              <i className="expense-dot" />
                              支出
                            </span>
                          </div>
                        </div>
                        <TrendChart ledger={ledger} year={year} />
                      </div>
                      <div className="panel category-panel">
                        <div className="panel-heading">
                          <div>
                            <h2>支出分布</h2>
                            <p>{period.label}</p>
                          </div>
                          <span className="small-icon">
                            <BarChart3 size={18} />
                          </span>
                        </div>
                        <CategoryChart rows={stats.rows} />
                      </div>
                    </section>
                    <section className="panel recent-panel">
                      <div className="panel-heading">
                        <div className="inline-title">
                          <h2>最近账目</h2>
                          <span className="count-badge">
                            {stats.rows.length} 笔
                          </span>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => {
                            setView("ledger");
                            setQuery("");
                          }}
                        >
                          查看全部 <ArrowRight size={16} />
                        </button>
                      </div>
                      <TransactionTable
                        rows={[...stats.rows].reverse().slice(0, 5)}
                        canWrite={canWrite}
                        onEdit={openForm}
                        onVoid={(t) => {
                          setVoidTarget(t);
                          setVoidReason("");
                          setFormError("");
                          eventId.current = crypto.randomUUID();
                        }}
                      />
                    </section>
                  </>
                )}
                {view === "ledger" && periodValid && (
                  <section className="panel ledger-panel">
                    <div className="search-toolbar">
                      <label className="search-input">
                        <Search size={18} />
                        <input
                          placeholder="搜索项目、姓名、备注或金额…"
                          aria-label="搜索账目"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                        {query && (
                          <button
                            aria-label="清除搜索"
                            className="icon-button"
                            onClick={() => setQuery("")}
                          >
                            <X size={16} />
                          </button>
                        )}
                      </label>
                      <select
                        aria-label="收支类型"
                        value={typeFilter}
                        onChange={(e) => {
                          setTypeFilter(
                            e.target.value as TransactionType | "all",
                          );
                          setCategory("");
                        }}
                      >
                        <option value="all">全部收支</option>
                        <option value="income">收入</option>
                        <option value="expense">支出</option>
                        <option value="transfer">账户转账</option>
                      </select>
                      <select
                        aria-label="账目分类"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        <option value="">全部分类</option>
                        {[
                          ...(typeFilter === "all" || typeFilter === "income"
                            ? incomeCategories
                            : []),
                          ...(typeFilter === "all" || typeFilter === "expense"
                            ? expenseCategories
                            : []),
                          ...(typeFilter === "all" || typeFilter === "transfer"
                            ? ["账户内部转账"]
                            : []),
                        ].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                      <select
                        aria-label="账目状态"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                      >
                        <option value="active">有效账目</option>
                        <option value="all">包括已作废</option>
                        <option value="void">已作废</option>
                      </select>
                    </div>
                    <div className="result-summary">
                      <span>
                        找到 <b>{filtered.length}</b> 笔账目
                      </span>
                      <span>
                        收入{" "}
                        <b className="income-text">RM {money(filterIncome)}</b>
                      </span>
                      <span>
                        支出{" "}
                        <b className="expense-text">
                          RM {money(filterExpense)}
                        </b>
                      </span>
                      <div className="result-actions">
                        <button className="text-button" onClick={exportCsv}>
                          <Download size={16} />
                          导出 CSV
                        </button>
                        <button
                          className="text-button"
                          onClick={() => print("search")}
                        >
                          <Printer size={16} />
                          打印结果
                        </button>
                      </div>
                    </div>
                    <TransactionTable
                      rows={filtered.slice((page - 1) * 12, page * 12)}
                      canWrite={canWrite}
                      onEdit={openForm}
                      onVoid={(t) => {
                        setVoidTarget(t);
                        setVoidReason("");
                        setFormError("");
                        eventId.current = crypto.randomUUID();
                      }}
                    />
                    <div className="pagination">
                      <span>
                        第{" "}
                        {Math.min(
                          page,
                          Math.max(1, Math.ceil(filtered.length / 12)),
                        )}{" "}
                        / {Math.max(1, Math.ceil(filtered.length / 12))} 页
                      </span>
                      <button
                        className="icon-button"
                        aria-label="上一页"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        <ChevronLeft size={17} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="下一页"
                        disabled={page * 12 >= filtered.length}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        <ChevronRight size={17} />
                      </button>
                    </div>
                  </section>
                )}
                {view === "reports" && stats && periodValid && (
                  <>
                    <div className="report-actions">
                      <div>
                        <ShieldCheck size={18} />
                        <span>
                          期初 + 收入 − 支出
                          {stats.adjustment ? " + 结转核对差额" : ""} = 期末结余
                        </span>
                      </div>
                      <button
                        className="primary"
                        onClick={() => print("report")}
                      >
                        <Printer size={17} />
                        打印 / 保存 PDF
                      </button>
                    </div>
                    <p className="print-tip">
                      在打印窗口选择“另存为 PDF”即可下载；报告会自动按 A4 分页。
                    </p>
                    <Report ledger={ledger} period={period} demo={demo} />
                  </>
                )}
                {view === "activity" && (
                  <section className="panel activity-panel">
                    <div className="panel-heading">
                      <h2>操作记录</h2>
                      <span className="count-badge">
                        {ledger.events.length} 条
                      </span>
                    </div>
                    {ledger.events.length ? (
                      <div className="timeline">
                        {[...ledger.events]
                          .sort((a, b) => b.at.localeCompare(a.at))
                          .map((e) => (
                            <div className="timeline-row" key={e.eventId}>
                              <div
                                className={
                                  "timeline-icon " +
                                  (e.action === "void" ? "void" : "")
                                }
                              >
                                <History size={17} />
                              </div>
                              <div>
                                <strong>
                                  {e.actor}{" "}
                                  <span>
                                    {e.action === "create"
                                      ? "新增了"
                                      : e.action === "edit"
                                        ? "修改了"
                                        : e.action === "void"
                                          ? "作废了"
                                          : "导入了"}
                                    一笔
                                    {typeLabel(e.transaction.type)}
                                  </span>
                                </strong>
                                <p>
                                  {e.transaction.description}{" "}
                                  <b>RM {money(e.transaction.amountCents)}</b>
                                </p>
                                <small>
                                  {new Date(e.at).toLocaleString("zh-CN", {
                                    timeZone: "Asia/Kuala_Lumpur",
                                  })}{" "}
                                  · 版本 {e.transaction.version}
                                </small>
                                {e.transaction.note && (
                                  <p className="event-note">
                                    {e.transaction.note}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <Empty
                        title="还没有操作记录"
                        text="新增、修改或作废账目后，会在这里留下记录。"
                      />
                    )}
                  </section>
                )}
                {view === "settings" && (
                  <div className="settings-grid">
                    <section className="panel settings-panel">
                      <div className="panel-heading">
                        <h2>学校与账本</h2>
                        <ShieldCheck size={20} />
                      </div>
                      <div className="school-profile">
                        <img src="/school-logo.jpg" alt="校徽" />
                        <div>
                          <h3>文林望中华学校</h3>
                          <p>SJK(C) CHUNG HWA BELEMANG</p>
                          <span>{selectedBook.name}</span>
                        </div>
                      </div>
                      <dl>
                        <div>
                          <dt>币种</dt>
                          <dd>马来西亚令吉（MYR / RM）</dd>
                        </div>
                        <div>
                          <dt>时区</dt>
                          <dd>马来西亚 · UTC+8</dd>
                        </div>
                        <div>
                          <dt>账本启用日</dt>
                          <dd>{ledger.openingDate}</dd>
                        </div>
                        <div>
                          <dt>启用时结余</dt>
                          <dd>RM {money(ledger.openingCents)}</dd>
                        </div>
                        <div>
                          <dt>保存位置</dt>
                          <dd>
                            {demo ? "本次演示页面" : "Google Sheets 私有账本"}
                          </dd>
                        </div>
                      </dl>
                      {ledger.spreadsheetUrl && !demo && (
                        <a
                          className="secondary"
                          href={ledger.spreadsheetUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          打开 Google Sheets <ExternalLink size={16} />
                        </a>
                      )}
                      <div className="source-note">
                        <h3>导入说明</h3>
                        <p>{ledger.sourceNote}</p>
                      </div>
                    </section>
                    <section className="panel settings-panel">
                      <div className="panel-heading">
                        <h2>账户与分类</h2>
                        <Settings size={20} />
                      </div>
                      <dl>
                        <div>
                          <dt>当前账户</dt>
                          <dd>{user.displayName}</dd>
                        </div>
                        <div>
                          <dt>权限</dt>
                          <dd>
                            {user.role === "viewer"
                              ? "查询与打印"
                              : "记账、查询、修改与打印"}
                          </dd>
                        </div>
                      </dl>
                      <h3 className="setting-section-title">收入分类</h3>
                      <div className="category-tags">
                        {incomeCategories.map((c) => (
                          <span key={c}>{c}</span>
                        ))}
                      </div>
                      <h3 className="setting-section-title">支出分类</h3>
                      <div className="category-tags">
                        {expenseCategories.map((c) => (
                          <span key={c}>{c}</span>
                        ))}
                      </div>
                      <div className="source-note">
                        <h3>账户交接</h3>
                        <p>
                          人员权限与期初设置由账本管理员维护。作废记录仍会保留，方便核对与交接。
                        </p>
                      </div>
                    </section>
                  </div>
                )}
              </>
            )}
            <footer className="app-footer">
              <span>文林望中华学校 · {selectedBook.name}</span>
              <span>{demo ? "演示模式" : "财政管理"}</span>
            </footer>
          </div>
        </main>
      </div>
      {toast && (
        <div className="toast no-print" role="status">
          <CheckCircle2 size={19} />
          {toast}
        </div>
      )}
      {form && (
        <Modal
          title={`${selectedBook.name} · ${editing ? "修改账目" : "记一笔"}`}
          onClose={closeForm}
          busy={saving}
        >
          <form onSubmit={submit}>
            <div className="type-toggle">
              {(["income", "expense", "transfer"] as TransactionType[]).map(
                (t) => (
                  <button
                    type="button"
                    key={t}
                    className={form.type === t ? "selected " + t : ""}
                    onClick={() =>
                      setForm({
                        ...form,
                        type: t,
                        category:
                          t === "transfer"
                            ? "账户内部转账"
                            : t === "income"
                              ? incomeCategories[0]
                              : expenseCategories[0],
                      })
                    }
                  >
                    {t === "income" ? (
                      <ArrowDownLeft size={18} />
                    ) : (
                      <ArrowUpRight size={18} />
                    )}{" "}
                    {typeLabel(t)}
                  </button>
                ),
              )}
            </div>
            {form.type === "transfer" && (
              <p className="muted">
                用于同一账本内的现金与银行账户互转，不计入收入、支出或总余额。请在备注写明转出与转入账户。
              </p>
            )}
            <div className="amount-input">
              <label htmlFor="amount">金额</label>
              <div>
                <span>RM</span>
                <input
                  id="amount"
                  required
                  inputMode="decimal"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
            </div>
            <div className="form-grid">
              <label>
                日期
                <input
                  type="date"
                  required
                  min={ledger?.openingDate}
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </label>
              <label>
                分类
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
                  }
                >
                  {(form.type === "transfer"
                    ? ["账户内部转账"]
                    : form.type === "income"
                      ? incomeCategories
                      : expenseCategories
                  ).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="full-width">
                项目
                <input
                  required
                  maxLength={160}
                  placeholder="例如：教师生日红包"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </label>
              <label className="full-width">
                往来人 <span className="optional">选填</span>
                <input
                  maxLength={80}
                  placeholder="个人、商家或单位名称"
                  value={form.party}
                  onChange={(e) => setForm({ ...form, party: e.target.value })}
                />
              </label>
              <label className="full-width">
                备注 <span className="optional">选填</span>
                <textarea
                  rows={3}
                  maxLength={1000}
                  placeholder="补充说明、收据编号等"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </label>
            </div>
            {formError && (
              <div className="alert" role="alert">
                <AlertCircle size={17} />
                {formError}
              </div>
            )}
            <div className="form-footer">
              <span>
                <ShieldCheck size={15} />
                {demo ? "仅保存到演示空间" : "保存后同步到 Google Sheets"}
              </span>
              <button type="submit" className="primary" disabled={saving}>
                {saving ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Check size={18} />
                )}{" "}
                {saving ? "正在保存…" : "保存账目"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {voidTarget && (
        <Modal
          title="作废这笔账目"
          onClose={() => {
            if (!saving) setVoidTarget(null);
          }}
          busy={saving}
        >
          <p className="void-description">
            {voidTarget.description} · RM {money(voidTarget.amountCents)}
          </p>
          <p className="muted">
            作废后不计入收支，原始记录与操作记录仍会保留。
          </p>
          <label className="void-reason">
            作废原因
            <textarea
              value={voidReason}
              maxLength={300}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="请填写原因"
              rows={3}
            />
          </label>
          {formError && (
            <div className="alert" role="alert">
              {formError}
            </div>
          )}
          <div className="form-footer">
            <button
              className="secondary"
              disabled={saving}
              onClick={() => setVoidTarget(null)}
            >
              取消
            </button>
            <button
              className="danger-button"
              disabled={saving || !voidReason.trim()}
              onClick={() => void voidEntry()}
            >
              {saving ? "正在保存…" : "确认作废"}
            </button>
          </div>
        </Modal>
      )}
      {ledger && periodValid && (
        <div className="print-only">
          <Report
            ledger={ledger}
            period={period}
            demo={demo}
            filtered={printKind === "search" ? filtered : undefined}
            query={query}
          />
        </div>
      )}
    </>
  );
}

function Login({
  configured,
  checking,
  connectionError,
  onLogin,
  onDemo,
}: {
  configured: boolean;
  checking: boolean;
  connectionError: string;
  onLogin: (s: Session) => void;
  onDemo: () => void;
}) {
  const [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(
        await api<Session>("login", {
          method: "POST",
          body: JSON.stringify({
            username: name,
            password,
            ledgerId: "teachers",
            includeLedger: true,
          }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <header className="login-school">
        <img src="/school-logo.jpg" alt="文林望中华学校校徽" />
        <div>文林望中华学校</div>
      </header>
      <div className="login-card">
        <section className="login-art" aria-label="中华账簿">
          <BrandMotion />
          <div className="login-art-caption">
            <strong>中华账簿</strong>
            <div className="login-books">
              <span>教师联谊会</span>
              <span>家协</span>
              <span>贩卖部</span>
            </div>
          </div>
        </section>
        <section className="login-form-area">
          <div className="login-form">
            <div className="login-heading">
              <img
                className="login-app-icon"
                src="/icons/icon-blue-192.png"
                alt="中华账簿 App 图标"
                width="64"
                height="64"
              />
              <h1>财政管理</h1>
            </div>
            {connectionError && (
              <div className="alert" role="alert">
                {connectionError}{" "}
                <button type="button" onClick={() => location.reload()}>
                  重新连接
                </button>
              </div>
            )}
            {configured ? (
              <form onSubmit={login}>
                <label>
                  账户
                  <input
                    required
                    autoComplete="username"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="输入账户名称"
                  />
                </label>
                <label>
                  密码
                  <input
                    required
                    autoComplete="current-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="输入登录密码"
                  />
                </label>
                {error && (
                  <div className="alert" role="alert">
                    {error}
                  </div>
                )}
                <button
                  className="primary login-submit"
                  disabled={busy || checking}
                >
                  {busy || checking ? (
                    <>
                      <LoaderCircle className="spin" size={18} />
                      {busy ? "正在安全登录…" : "正在连接…"}
                    </>
                  ) : (
                    <>
                      登录 <ArrowRight size={18} />
                    </>
                  )}
                </button>
                <p className="login-progress" role="status">
                  {busy ? "正在读取账本…" : "12 小时内保持登录"}
                </p>
              </form>
            ) : (
              <div className="setup-notice">
                <AlertCircle size={20} />
                <div>
                  <strong>正式账本尚未连接</strong>
                  <p>
                    管理员完成 Google Sheets
                    连接后即可登录。目前可先体验完整的演示账本。
                  </p>
                </div>
              </div>
            )}
            <button
              className="secondary demo-button"
              disabled={busy}
              onClick={onDemo}
            >
              <Eye size={18} />
              演示账本
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  type,
  value,
  count,
}: {
  type: TransactionType;
  value: number;
  count: number;
}) {
  return (
    <div className="metric-card">
      <div className="metric-label">
        <span>本期{type === "income" ? "收入" : "支出"}</span>
        <span className={"metric-icon " + type}>
          {type === "income" ? (
            <ArrowDownLeft size={21} />
          ) : (
            <ArrowUpRight size={21} />
          )}
        </span>
      </div>
      <div className="metric-number">
        <small>RM</small>
        {money(value)}
      </div>
      <div className="metric-bottom">
        <span>
          {count} 笔{type === "income" ? "收入" : "支出"}记录
        </span>
        <span className={"mini-indicator " + type}>
          {type === "income" ? "+" : "−"}
        </span>
      </div>
    </div>
  );
}
function TrendChart({ ledger, year }: { ledger: Ledger; year: number }) {
  const values = Array.from({ length: 12 }, (_, m) => {
    const s = summary(ledger, periodFor(year, "month", m + 1));
    return { month: m + 1, income: s.income, expense: s.expense };
  });
  const max = Math.max(10000, ...values.flatMap((v) => [v.income, v.expense]));
  const ceiling = Math.ceil(max / 50000) * 50000;
  return (
    <div className="trend-chart">
      <div className="chart-unit">RM</div>
      <svg
        viewBox="0 0 740 235"
        role="img"
        aria-label={`${year}年每月收入与支出柱状图`}
      >
        <title>月度收支趋势</title>
        {[0, 1, 2, 3, 4].map((i) => {
          const y = 190 - i * 42;
          return (
            <g key={i}>
              <line
                x1="45"
                y1={y}
                x2="728"
                y2={y}
                stroke="#e6ecf6"
                strokeDasharray={i ? "3 5" : "0"}
              />
              <text
                x="34"
                y={y + 4}
                textAnchor="end"
                fill="#73829b"
                fontSize="11"
              >
                {((ceiling * i) / 4 / 100).toLocaleString()}
              </text>
            </g>
          );
        })}
        {values.map((v, i) => (
          <g key={i}>
            <rect
              x={58 + i * 56}
              y={190 - (v.income / ceiling) * 168}
              width="13"
              height={Math.max(0, (v.income / ceiling) * 168)}
              rx="3"
              fill="#2563eb"
            >
              <title>
                {v.month}月收入 RM {money(v.income)}
              </title>
            </rect>
            <rect
              x={75 + i * 56}
              y={190 - (v.expense / ceiling) * 168}
              width="13"
              height={Math.max(0, (v.expense / ceiling) * 168)}
              rx="3"
              fill="#8aacef"
            >
              <title>
                {v.month}月支出 RM {money(v.expense)}
              </title>
            </rect>
            <text
              x={73 + i * 56}
              y="217"
              textAnchor="middle"
              fill="#73829b"
              fontSize="12"
            >
              {v.month}月
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
function CategoryChart({ rows }: { rows: Transaction[] }) {
  const categories = categoryTotals(rows, "expense"),
    total = categories.reduce((s, c) => s + c[1], 0);
  let cursor = 0;
  const gradient = categories
    .map(([, amount], i) => {
      const before = cursor;
      cursor += (amount / total) * 100;
      return `${palette[i % palette.length]} ${before}% ${cursor}%`;
    })
    .join(",");
  return (
    <div className="category-content">
      <div
        className="donut"
        style={{
          background: total ? `conic-gradient(${gradient})` : "#e7ecec",
        }}
      >
        <div>
          <span>总支出</span>
          <strong>
            {total ? categories.length + "" : "0"}
            <small> 类</small>
          </strong>
        </div>
      </div>
      <div className="category-legend">
        {categories.length ? (
          categories.slice(0, 6).map(([name, amount], i) => (
            <div key={name}>
              <span>
                <i style={{ background: palette[i % palette.length] }} />
                {name}
              </span>
              <b>
                {Math.round((amount / total) * 100)}
                <small>%</small>
              </b>
            </div>
          ))
        ) : (
          <p className="muted">本期暂无支出</p>
        )}
      </div>
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <BookOpen size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function TransactionTable({
  rows,
  canWrite,
  onEdit,
  onVoid,
}: {
  rows: Transaction[];
  canWrite: boolean;
  onEdit: (t: Transaction) => void;
  onVoid: (t: Transaction) => void;
}) {
  return rows.length ? (
    <div className="table-scroll">
      <table className="transaction-table">
        <thead>
          <tr>
            <th>项目 / 分类</th>
            <th>日期</th>
            <th>类型</th>
            <th className="amount-column">金额（RM）</th>
            <th className="action-column">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className={t.status === "void" ? "void-row" : ""}>
              <td>
                <div className="transaction-description">
                  <span className={"transaction-icon " + t.type}>
                    {t.type === "income" ? (
                      <ArrowDownLeft size={19} />
                    ) : (
                      <ArrowUpRight size={19} />
                    )}
                  </span>
                  <div>
                    <strong>{t.description}</strong>
                    <small>
                      {t.category}
                      {t.party ? " · " + t.party : ""}
                      {t.status === "void" ? " · 已作废" : ""}
                    </small>
                    {t.note && (
                      <small className="table-note" title={t.note}>
                        {t.note}
                      </small>
                    )}
                  </div>
                </div>
              </td>
              <td className="date-cell">{t.date.replaceAll("-", ".")}</td>
              <td>
                <span className={"type-badge " + t.type}>
                  {typeLabel(t.type)}
                </span>
              </td>
              <td
                className={
                  "amount-column transaction-amount " +
                  (t.type === "income" ? "income-text" : "")
                }
              >
                {t.type === "transfer" ? "↔" : t.type === "income" ? "+" : "−"}{" "}
                {money(t.amountCents)}
              </td>
              <td className="action-column">
                {canWrite && t.status === "active" ? (
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      aria-label={`修改 ${t.description}`}
                      title="修改账目"
                      onClick={() => onEdit(t)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button danger-icon"
                      aria-label={`作废 ${t.description}`}
                      title="作废账目"
                      onClick={() => onVoid(t)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ) : (
                  <MoreHorizontal size={17} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="没有找到相关账目"
      text="试试其他关键词或日期，或新增一笔账目。"
    />
  );
}

function Report({
  ledger,
  period,
  demo,
  filtered,
  query,
}: {
  ledger: Ledger;
  period: Period;
  demo: boolean;
  filtered?: Transaction[];
  query?: string;
}) {
  const s = summary(ledger, period),
    rows = filtered
      ? [...filtered].sort((a, b) => a.date.localeCompare(b.date))
      : s.rows;
  const income = filtered
      ? rows
          .filter((t) => t.status === "active" && t.type === "income")
          .reduce((n, t) => n + t.amountCents, 0)
      : s.income,
    expense = filtered
      ? rows
          .filter((t) => t.status === "active" && t.type === "expense")
          .reduce((n, t) => n + t.amountCents, 0)
      : s.expense;
  return (
    <article className="report-paper">
      <div className="report-school">
        <img src="/school-logo.jpg" alt="文林望中华学校校徽" />
        <div>
          <h2>文林望中华学校</h2>
          <p>SJK(C) CHUNG HWA BELEMANG</p>
          <h3>
            {bookFor(ledger.id).name}
            {filtered ? "账目查询结果" : "财政报告"}
          </h3>
        </div>
      </div>
      <div className="report-period">
        <strong>
          {period.label}
          {demo ? " · 演示报告" : ""}
        </strong>
        <span>
          {period.start} 至 {period.end}
        </span>
      </div>
      {period.end > today() && (
        <p className="report-note">
          本期间尚未结束 · 数据截至 {today()}，未来日期账目如有录入亦列于明细。
        </p>
      )}
      {filtered && (
        <p className="report-note">
          查询关键词：{query || "无"} · 共 {rows.length}{" "}
          笔（作废账目不计入合计）
        </p>
      )}
      <div className={"report-stats " + (filtered ? "filtered-stats" : "")}>
        {!filtered && (
          <div>
            <span>期初结余</span>
            <strong>RM {money(s.opening)}</strong>
          </div>
        )}
        <div>
          <span>{filtered ? "结果" : "本期"}收入</span>
          <strong>RM {money(income)}</strong>
        </div>
        <div>
          <span>{filtered ? "结果" : "本期"}支出</span>
          <strong>RM {money(expense)}</strong>
        </div>
        {!filtered && (
          <div>
            <span>期末结余</span>
            <strong>RM {money(s.closing)}</strong>
          </div>
        )}
      </div>
      <h4>收支明细</h4>
      {!!ledger.reviewNotes?.length && (
        <div className="report-review">
          <strong>历史资料待核对</strong>
          <ul>
            {ledger.reviewNotes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      {!!s.adjustment && !filtered && (
        <p className="report-note">
          本期结转核对差额：RM {money(s.adjustment)}（独立列示，不计入收支）。
        </p>
      )}
      {!!ledger.balanceCheckpoints?.length && !filtered && (
        <p className="report-note">
          结转依据：
          {ledger.balanceCheckpoints
            .map((p) => `${p.date} 期初 RM ${money(p.amountCents)}；${p.note}`)
            .join("。")}
        </p>
      )}
      <table className="report-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>项目与备注</th>
            <th>收入（RM）</th>
            <th>支出（RM）</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((t) => (
              <tr key={t.id} className={t.status === "void" ? "void-row" : ""}>
                <td>{t.date}</td>
                <td>
                  {t.description}
                  {t.type === "transfer"
                    ? `（账户转账 RM ${money(t.amountCents)}，不计收支）`
                    : ""}
                  {t.status === "void" ? "（已作废）" : ""}
                  <small>
                    {t.category}
                    {t.party ? " · " + t.party : ""}
                    {t.note ? " · " + t.note : ""}
                  </small>
                </td>
                <td>{t.type === "income" ? money(t.amountCents) : "—"}</td>
                <td>{t.type === "expense" ? money(t.amountCents) : "—"}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4} className="empty-report">
                本期间没有账目
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>合计</td>
            <td>{money(income)}</td>
            <td>{money(expense)}</td>
          </tr>
        </tfoot>
      </table>
      {!filtered && (
        <>
          <h4>分类汇总</h4>
          <div className="report-categories">
            {(["income", "expense"] as TransactionType[]).map((type) => (
              <div key={type}>
                <strong>{type === "income" ? "收入" : "支出"}</strong>
                {categoryTotals(rows, type).map(([c, n]) => (
                  <div key={c}>
                    <span>{c}</span>
                    <span>RM {money(n)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="report-equation">
            期初 RM {money(s.opening)} ＋ 收入 RM {money(s.income)} − 支出 RM{" "}
            {money(s.expense)}
            {s.adjustment
              ? ` ＋ 结转核对差额 RM ${money(s.adjustment)}`
              : ""}{" "}
            ＝ <b>结余 RM {money(s.closing)}</b>
          </div>
          <div className="report-signatures">
            {["财政", "主席", "查账员"].map((x) => (
              <div key={x}>
                <span />
                <p>{x}</p>
              </div>
            ))}
          </div>
        </>
      )}
      <footer>
        <span>
          文林望中华学校 · {bookFor(ledger.id).name}
          {demo ? " · 虚构数据，仅供演示" : ""}
        </span>
        <span>生成日期：{today()}</span>
      </footer>
    </article>
  );
}
export default App;
