import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock3,
  LockKeyhole,
  Plus,
  Search,
  Trash2,
  UserRound,
  Users,
  Video,
  X,
} from "lucide-react";
import "./App.css";

type Training = {
  id: string;
  title: string;
  shortTitle: string;
  instructor: string;
  accent: string;
  mode: "Live" | "Video";
};
type Session = {
  id: string;
  trainingId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  status: "active" | "cancelled";
  training?: Training;
};
type Booking = {
  id: string;
  sessionId: string;
  oem: string;
  requesterName: string;
  requesterEmail: string;
  createdAt: string;
  status: "confirmed" | "cancelled";
};
type BookingLookup = Booking & { session?: Session; training?: Training };
type SchedulerData = {
  trainings: Training[];
  sessions: Session[];
  bookings: Booking[];
};
type Day = { date: string; day: string; weekday: string };
type Clock = { label: string; timeZone: string; time: string };

const weekdays: Day[] = [
  ["2026-09-14", "Mon"],
  ["2026-09-15", "Tue"],
  ["2026-09-16", "Wed"],
  ["2026-09-17", "Thu"],
  ["2026-09-18", "Fri"],
  ["2026-09-21", "Mon"],
  ["2026-09-22", "Tue"],
  ["2026-09-23", "Wed"],
  ["2026-09-24", "Thu"],
  ["2026-09-25", "Fri"],
  ["2026-09-28", "Mon"],
  ["2026-09-29", "Tue"],
  ["2026-09-30", "Wed"],
  ["2026-10-01", "Thu"],
  ["2026-10-02", "Fri"],
].map(([date, weekday]) => ({ date, day: date.slice(-2), weekday }));
const weekGroups: { label: string; days: Day[] }[] = [
  { label: "14–18 SEP", days: weekdays.slice(0, 5) },
  { label: "21–25 SEP", days: weekdays.slice(5, 10) },
  { label: "28 SEP–02 OCT", days: weekdays.slice(10, 15) },
];
const userError = (code: string) =>
  ({
    SCHEDULER_AUTH_REQUIRED: "Scheduler mode is required to manage sessions.",
    INVALID_PASSWORD: "The scheduler password is incorrect.",
    REQUIRED_FIELDS_MISSING: "Please complete all required fields.",
    SESSION_NOT_FOUND: "This session is no longer available.",
    DUPLICATE_SESSION: "This course already has a session at that time.",
    INSTRUCTOR_CONFLICT: "This instructor already has a session at that time.",
    BOOKING_NOT_FOUND: "This booking could not be found.",
  })[code] ?? "Something went wrong. Please try again.";
const api = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(userError(payload.error ?? "REQUEST_FAILED"));
  }
  return response.status === 204 ? (undefined as T) : response.json();
};
const slotTop = (startTime: string) => {
  const [hours, minutes] = startTime.split(":").map(Number);
  return `${(hours - 9) * 51 + (minutes / 60) * 51}px`;
};
const monthLabel = (date: string) => (date.startsWith("2026-10") ? "OCT" : "SEP");
const timeZones = [
  ["TW/CN Time", "Asia/Taipei"],
  ["JP/KR Time", "Asia/Tokyo"],
  ["U.S. West Coast Time", "America/Los_Angeles"],
] as const;
const formatClock = (timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());

function App() {
  const [data, setData] = useState<SchedulerData | null>(null);
  const [selectedTraining, setSelectedTraining] = useState<Training | null>(
    null,
  );
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [query, setQuery] = useState("");
  const [weekIndex, setWeekIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"pc" | "phone">("pc");
  const [modal, setModal] = useState<"session" | "booking" | "login" | "my-bookings" | "cancel-booking" | null>(
    null,
  );
  const [sessionDraft, setSessionDraft] = useState({
    date: "2026-09-14",
    startTime: "09:00",
  });
  const [bookingDraft, setBookingDraft] = useState({
    oem: "",
    requesterName: "",
    requesterEmail: "",
  });
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState("");
  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupResults, setLookupResults] = useState<BookingLookup[] | null>(null);
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
  const [clocks, setClocks] = useState<Clock[]>(() => timeZones.map(([label, timeZone]) => ({ label, timeZone, time: formatClock(timeZone) })));
  const refresh = async () => {
    const next = await api<SchedulerData>("/api/scheduler");
    setData(next);
    const activeSessions = next.sessions.filter(
      (session) => session.status === "active",
    );
    const latest = activeSessions[activeSessions.length - 1];
    if (latest) {
      setSelectedSession(latest);
      setSelectedTraining(latest.training ?? null);
      setWeekIndex(
        Math.max(
          0,
          weekGroups.findIndex((week) =>
            week.days.some((day) => day.date === latest.date),
          ),
        ),
      );
    }
  };
  useEffect(() => {
    refresh().catch((cause: Error) => setError(cause.message));
    api<{ authenticated: boolean }>("/api/auth/status")
      .then((result) => setAuthenticated(result.authenticated))
      .catch(() => undefined);
  }, []);
  useEffect(() => { const updateClocks = () => setClocks(timeZones.map(([label, timeZone]) => ({ label, timeZone, time: formatClock(timeZone) }))); const interval = window.setInterval(updateClocks, 1000); return () => window.clearInterval(interval); }, []);
  useEffect(() => {
    if (!selectedTraining && data?.trainings[0])
      setSelectedTraining(data.trainings[0]);
  }, [data, selectedTraining]);
  useEffect(() => {
    const sessions =
      data?.sessions.filter((session) => session.status === "active") ?? [];
    if (!selectedSession && sessions.length) {
      const latest = sessions[sessions.length - 1];
      setSelectedSession(latest);
      setSelectedTraining(latest.training ?? null);
      setWeekIndex(
        Math.max(
          0,
          weekGroups.findIndex((week) =>
            week.days.some((day) => day.date === latest.date),
          ),
        ),
      );
    }
  }, [data, selectedSession]);
  useEffect(() => {
    if (data?.trainings.length)
      document
        .querySelector<HTMLButtonElement>(".primary-button")
        ?.removeAttribute("disabled");
  }, [data]);
  useEffect(() => {
    const columns = Array.from(
      document.querySelectorAll<HTMLElement>(".day-column"),
    );
    const handlers = columns.map((column) => {
      const move = (event: MouseEvent) => {
        const rect = column.getBoundingClientRect();
        const row = Math.max(
          0,
          Math.min(16, Math.floor((event.clientY - rect.top) / 25.5)),
        );
        column.style.setProperty("--hover-row", String(row));
      };
      const leave = () => column.style.removeProperty("--hover-row");
      column.addEventListener("mousemove", move);
      column.addEventListener("mouseleave", leave);
      return { column, move, leave };
    });
    return () =>
      handlers.forEach(({ column, move, leave }) => {
        column.removeEventListener("mousemove", move);
        column.removeEventListener("mouseleave", leave);
      });
  }, [data, weekIndex]);
  useEffect(() => {
    const app = document.querySelector<HTMLElement>(".app-shell");
    const topbar = document.querySelector<HTMLElement>(".topbar");
    if (!app || !topbar) return;
    const replaceOem = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.includes("OEM"))
        node.textContent = node.textContent.replaceAll("OEM", "Customer");
      node.childNodes.forEach(replaceOem);
    };
    replaceOem(app);
    const guideButton = document.createElement("button");
    guideButton.className = "guide-button";
    guideButton.type = "button";
    guideButton.textContent = "User guide";
    topbar.append(guideButton);
    const guide = document.createElement("div");
    guide.className = "guide-backdrop";
    guide.innerHTML =
      '<div class="guide-modal" role="dialog" aria-modal="true"><button class="guide-close" type="button" aria-label="Close user guide">×</button><div class="guide-kicker">TRAINING SCHEDULER</div><h2>User guide</h2><div class="guide-tabs"><button class="active" data-language="en">English</button><button data-language="zh">繁體中文</button><button data-language="ko">한국어</button><button data-language="ja">日本語</button></div><div class="guide-content"></div></div>';
    document.body.append(guide);
    const content: Record<string, string> = {
      en: "<h3>Book a training session</h3><p>Choose a course, select an available session, and click <b>Book this session</b>. Enter the customer or team name, requester name, and requester email.</p><h3>Create a session</h3><p>Scheduler mode lets you click an empty half-hour on the calendar and create a 30-minute session. Use the arrows to switch weeks.</p>",
      zh: "<h3>預約培訓課程</h3><p>選擇課程與可用場次，點擊「Book this session」。填寫客戶或團隊名稱、預約人姓名與 email。</p><h3>建立場次</h3><p>Scheduler mode 可在週曆空白的半小時區塊建立 30 分鐘場次，並使用箭頭切換週次。</p>",
      ko: "<h3>교육 세션 예약</h3><p>과정과 예약 가능한 세션을 선택한 후 “Book this session”을 클릭하세요. 고객 또는 팀 이름, 신청자 이름과 이메일을 입력합니다.</p><h3>세션 만들기</h3><p>Scheduler mode에서 캘린더의 빈 30분 구간을 클릭하면 세션을 만들 수 있습니다. 화살표로 주간을 전환하세요.</p>",
      ja: "<h3>トレーニングを予約</h3><p>コースと空いているセッションを選択し、「Book this session」をクリックします。顧客またはチーム名、申請者名、メールアドレスを入力してください。</p><h3>セッションを作成</h3><p>Scheduler modeでは、カレンダーの空いている30分枠をクリックしてセッションを作成できます。矢印で週を切り替えます。</p>",
    };
    const contentElement = guide.querySelector<HTMLElement>(".guide-content");
    const tabs = Array.from(
      guide.querySelectorAll<HTMLButtonElement>("[data-language]"),
    );
    const setLanguage = (language: string) => {
      if (contentElement) contentElement.innerHTML = content[language];
      tabs.forEach((tab) =>
        tab.classList.toggle("active", tab.dataset.language === language),
      );
    };
    tabs.forEach((tab) =>
      tab.addEventListener("click", () =>
        setLanguage(tab.dataset.language ?? "en"),
      ),
    );
    const close = () => guide.classList.remove("open");
    guideButton.addEventListener("click", () => {
      setLanguage("en");
      guide.classList.add("open");
    });
    guide.querySelector(".guide-close")?.addEventListener("click", close);
    guide.addEventListener("click", (event) => {
      if (event.target === guide) close();
    });
    return () => {
      guideButton.remove();
      guide.remove();
    };
  }, []);
  useEffect(() => {
    const app = document.querySelector<HTMLElement>(".app-shell");
    const replaceOem = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.includes("OEM"))
        node.textContent = node.textContent.replaceAll("OEM", "Customer");
      node.childNodes.forEach(replaceOem);
    };
    if (app) replaceOem(app);
  }, [data, modal]);
  useEffect(() => {
    const banner = document.querySelector<HTMLElement>(".error-banner");
    if (!banner) return;
    delete banner.dataset.errorCode;
  }, [error]);
  useEffect(() => {
    const shell = document.querySelector(".app-shell");
    const topbar = document.querySelector(".topbar");
    if (!shell || !topbar) return;
    shell.classList.toggle("phone-preview", viewMode === "phone");
    shell.classList.toggle("pc-preview", viewMode === "pc");
    let switcher = topbar.querySelector<HTMLButtonElement>(".device-switcher");
    if (!switcher) {
      switcher = document.createElement("button");
      switcher.className = "device-switcher";
      switcher.type = "button";
      switcher.setAttribute("aria-label", "Switch between PC and phone view");
      topbar.append(switcher);
    }
    switcher.innerHTML = viewMode === "pc" ? "▣ Phone view" : "▯ PC view";
    switcher.onclick = () => setViewMode(viewMode === "pc" ? "phone" : "pc");
    return () => switcher?.remove();
  }, [viewMode]);
  const trainings = data?.trainings ?? [];
  const sessions =
    data?.sessions.filter((session) => session.status === "active") ?? [];
  const bookings = data?.bookings ?? [];
  const filteredTrainings = useMemo(
    () =>
      trainings.filter((training) =>
        `${training.title} ${training.instructor}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [trainings, query],
  );
  const selectedBookings = selectedSession
    ? bookings.filter((booking) => booking.sessionId === selectedSession.id)
    : [];
  const currentWeek = weekGroups[weekIndex];
  const createSession = async () => {
    if (!selectedTraining) return;
    try {
      await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          ...sessionDraft,
          trainingId: selectedTraining.id,
        }),
      });
      await refresh();
      setModal(null);
    } catch (cause) {
      const message = (cause as Error).message;
      setModal(message === "SCHEDULER_AUTH_REQUIRED" ? "login" : "session");
      setError(
        message === "SCHEDULER_AUTH_REQUIRED"
          ? "Scheduler mode is required to create a session."
          : message,
      );
    }
  };
  const createBooking = async () => {
    if (!selectedSession) return;
    try {
      await api("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          ...bookingDraft,
          sessionId: selectedSession.id,
        }),
      });
      await refresh();
      setModal(null);
      setBookingDraft({ oem: "", requesterName: "", requesterEmail: "" });
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const cancelBooking = async (email: string) => {
    if (!bookingToCancel) return;
    try {
      await api(`/api/bookings/${bookingToCancel.id}`, { method: "DELETE", body: JSON.stringify({ requesterEmail: email }) });
      await refresh();
      setSelectedSession((current) => current ? { ...current } : null);
      setBookingToCancel(null);
      setModal(null);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const login = async (password: string) => {
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setAuthenticated(true);
      setModal(null);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const deleteSession = async () => {
    if (selectedSession) {
      await api(`/api/sessions/${selectedSession.id}`, { method: "DELETE" });
      await refresh();
      setSelectedSession(null);
    }
  };
  const openSession = (date: string, startTime: string) => {
    setSessionDraft({ date, startTime });
    setModal("session");
  };
  const lookupBookings = async () => {
    try {
      const result = await api<{ bookings: BookingLookup[] }>(`/api/bookings?email=${encodeURIComponent(lookupEmail)}`);
      setLookupResults(result.bookings);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="world-clocks" aria-label="Current local times">
          {clocks.map((clock) => <span className="world-clock" key={clock.label}><b>{clock.label}</b><time>{clock.time}</time></span>)}
        </div>
        <button
          className="user-menu"
          type="button"
          onClick={() => setModal("login")}
        >
          <span className="avatar">
            {authenticated ? "SC" : <LockKeyhole size={13} />}
          </span>
          <span>{authenticated ? "Scheduler mode" : "Public view"}</span>
        </button>
      </header>
      <main className="main-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">TEAM OPERATIONS / TRAINING</p>
            <h1>Training schedule</h1>
            <p className="lede">
              Coordinate technical enablement across your OEM network.
            </p>
          </div>
          <div className="heading-actions">
            <button className="secondary-button" type="button" onClick={() => { setLookupResults(null); setModal("my-bookings"); }}>
              <CalendarDays size={16} /> My bookings
            </button>
            <button className="primary-button" type="button" disabled={!selectedTraining} onClick={() => openSession(currentWeek.days[0].date, "09:00")}>
              <Plus size={17} /> New session
            </button>
          </div>
        </div>
        {error && (
          <div className="error-banner">
            {error}
            <button type="button" onClick={() => setError("")}>
              <X size={14} />
            </button>
          </div>
        )}
        <section className="stats-row">
          <div className="stat">
            <span className="stat-icon coral-bg">
              <CalendarDays size={19} />
            </span>
            <div>
              <strong>Sep 14 — Oct 02</strong>
              <span>Active window</span>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon blue-bg">
              <Clock3 size={19} />
            </span>
            <div>
              <strong>30 min</strong>
              <span>Standard duration</span>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon mint-bg">
              <Users size={19} />
            </span>
            <div>
              <strong>{trainings.length} courses</strong>
              <span>Available to book</span>
            </div>
          </div>
          <div className="stat capacity">
            <div className="capacity-label">
              <strong>{bookings.length} bookings</strong>
              <span>Shared schedule</span>
            </div>
            <div className="progress">
              <span
                style={{ width: `${Math.min(bookings.length * 8, 100)}%` }}
              />
            </div>
          </div>
        </section>
        <div className="workspace">
          <aside className="course-panel">
            <div className="panel-title">
              <div>
                <span className="section-kicker">CATALOG</span>
                <h2>Training courses</h2>
              </div>
            </div>
            <label className="search-field">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search courses"
              />
            </label>
            <div className="course-list">
              {filteredTrainings.map((training) => (
                <button
                  className={`course-item ${selectedTraining?.id === training.id ? "selected" : ""}`}
                  key={training.id}
                  type="button"
                  onClick={() => setSelectedTraining(training)}
                >
                  <span className={`course-dot ${training.accent}`} />
                  <span className="course-copy">
                    <strong>{training.title}</strong>
                    <small>
                      <UserRound size={12} /> {training.instructor}{" "}
                      <span className="bullet">•</span>{" "}
                      {training.mode === "Live"
                        ? "Instructor-led"
                        : "Self-paced video"}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </aside>
          <section className="calendar-panel">
            <div className="calendar-toolbar">
              <div>
                <span className="section-kicker">SCHEDULE VIEW</span>
                <div className="month-title">
                  <h2>September 2026</h2>
                  <span className="current-chip">{currentWeek.label}</span>
                </div>
              </div>
              <div className="calendar-actions">
                <button
                  className="round-button"
                  type="button"
                  aria-label="Previous week"
                  disabled={weekIndex === 0}
                  onClick={() => setWeekIndex(Math.max(0, weekIndex - 1))}
                >
                  <ChevronLeft size={17} />
                </button>
                <span className="week-counter">
                  {weekIndex + 1} / {weekGroups.length}
                </span>
                <button
                  className="round-button"
                  type="button"
                  aria-label="Next week"
                  disabled={weekIndex === weekGroups.length - 1}
                  onClick={() =>
                    setWeekIndex(Math.min(weekGroups.length - 1, weekIndex + 1))
                  }
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
            <div className="week-group active-week">
              <div className="week-label">{currentWeek.label}</div>
              <div
                className="calendar-grid"
                style={{
                  gridTemplateColumns: `48px repeat(${currentWeek.days.length}, minmax(83px, 1fr))`,
                }}
              >
                <div className="time-axis" />
                {currentWeek.days.map((day) => (
                  <div className="day-head" key={day.date}>
                    <span>{day.weekday}</span>
                    <strong>{day.day}</strong>
                    <small>{monthLabel(day.date)}</small>
                  </div>
                ))}
                <div className="time-labels">
                  {[
                    "09:00",
                    "10:00",
                    "11:00",
                    "12:00",
                    "13:00",
                    "14:00",
                    "15:00",
                    "16:00",
                    "17:00",
                  ].map((time) => (
                    <span key={time}>{time}</span>
                  ))}
                </div>
                {currentWeek.days.map((day) => (
                  <div
                    className="day-column"
                    key={day.date}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest(".slot"))
                        return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      const halfHours = Math.max(
                        0,
                        Math.min(
                          16,
                          Math.round((event.clientY - rect.top) / 25.5),
                        ),
                      );
                      const total = 9 * 60 + halfHours * 30;
                      openSession(
                        day.date,
                        `${String(Math.floor(total / 60)).padStart(2, "0")}:${total % 60 ? "30" : "00"}`,
                      );
                    }}
                  >
                    {Array.from({ length: 17 }, (_, index) => (
                      <span className="hour-line" key={index} />
                    ))}
                    {Object.values(
                      sessions
                        .filter((session) => session.date === day.date)
                        .reduce<Record<string, Session[]>>((groups, session) => {
                          (groups[session.startTime] ??= []).push(session);
                          return groups;
                        }, {}),
                    ).flatMap((sameTimeSessions) =>
                      sameTimeSessions.map((session, segmentIndex) => {
                        const sessionBookings = bookings.filter(
                          (booking) => booking.sessionId === session.id,
                        );
                        const bookingCount = sessionBookings.length;
                        const customerNames = sessionBookings.map(
                          (booking) => booking.oem,
                        );
                        return (
                        <button
                          className={`slot ${session.training?.accent ?? ""} ${bookingCount > 0 ? "booked" : ""}`}
                          key={session.id}
                          type="button"
                          style={{
                            top: slotTop(session.startTime),
                            left: `calc(${(segmentIndex * 100) / sameTimeSessions.length}% + 3px)`,
                            width: `calc(${100 / sameTimeSessions.length}% - 6px)`,
                            right: "auto",
                          }}
                          onClick={() => {
                            setSelectedSession(session);
                            setSelectedTraining(session.training ?? null);
                          }}
                        >
                          <strong>
                            {session.training?.shortTitle} · {session.startTime} PT
                          </strong>
                          <small>
                            {bookingCount > 0 ? customerNames.join(", ") : "Open"}
                          </small>
                          <span className="slot-tooltip">
                            <b>{session.training?.title}</b>
                            <span>{session.startTime} PT · 30 min</span>
                            <span>Instructor: {session.training?.instructor}</span>
                            <span>Delivery: {session.training?.mode === "Live" ? "Instructor-led" : "CFE online video"}</span>
                            {sessionBookings.length > 0 ? sessionBookings.map((booking) => (
                              <span className="booking-info" key={booking.id}>
                                <b>Customer: {booking.oem}</b>
                                <span>Booked by: {booking.requesterEmail}</span>
                              </span>
                            )) : <span>No bookings yet</span>}
                          </span>
                        </button>
                        );
                      }),
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="calendar-footer">
              <span>
                <i className="legend-dot live" /> Instructor-led
              </span>
              <span>
                <i className="legend-dot video" /> CFE online video
              </span>
              <span>
                <i className="legend-dot booked" /> Booked
              </span>
              <span className="footer-note">Weekdays · 09:00–17:30 PT</span>
            </div>
          </section>
          <aside className="booking-panel">
            <div className="booking-panel-head">
              <div>
                <span className="section-kicker">
                  {selectedSession ? "SELECTED SESSION" : "SESSION DETAILS"}
                </span>
                <h2>
                  {selectedSession?.training?.title ??
                    selectedTraining?.title ??
                    "Choose a course"}
                </h2>
              </div>
              {selectedSession && (
                <span
                  className={`mode-tag ${selectedSession.training?.mode.toLowerCase()}`}
                >
                  {selectedSession.training?.mode === "Live" ? (
                    <UserRound size={13} />
                  ) : (
                    <Video size={13} />
                  )}
                  {selectedSession.training?.mode}
                </span>
              )}
            </div>
            {selectedSession ? (
              <>
                <div className="session-date">
                  <span className="date-block">
                    <b>{selectedSession.date.slice(-2)}</b>
                    <small>{monthLabel(selectedSession.date)}</small>
                  </span>
                  <div>
                    <strong>
                      {selectedSession.date} · {selectedSession.startTime} PT
                    </strong>
                    <span>
                      <Clock3 size={14} /> 30 min ·{" "}
                      {selectedSession.training?.instructor}
                    </span>
                  </div>
                </div>
                <div className="detail-list">
                  <div>
                    <Users size={16} />
                    <span>
                      Bookings
                      <strong>{selectedBookings.length} confirmed</strong>
                    </span>
                  </div>
                  {selectedBookings.map((booking) => (
                    <div className="booking-record" key={booking.id}>
                      <span>
                        <strong>{booking.oem}</strong>
                        {booking.requesterName}
                        <small>{booking.requesterEmail}</small>
                        <code>{booking.id}</code>
                      </span>
                    </div>
                  ))}
                </div>
                {authenticated && (
                  <button
                    className="delete-button"
                    type="button"
                    onClick={deleteSession}
                  >
                    <Trash2 size={15} /> Delete session
                  </button>
                )}
                {selectedBookings.map((booking) => (
                  <button className="cancel-booking-button" key={`cancel-${booking.id}`} type="button" onClick={() => { setBookingToCancel(booking); setModal("cancel-booking"); }}>
                    <Trash2 size={14} /> Cancel booking: {booking.oem}
                  </button>
                ))}
                {selectedBookings.length === 0 ? (
                  <button
                    className="book-button"
                    type="button"
                    onClick={() => setModal("booking")}
                  >
                    <Plus size={17} /> Book this session
                  </button>
                ) : (
                  <div className="booked-status">
                    <Check size={16} /> Session booked
                  </div>
                )}
              </>
            ) : (
              <div className="empty-session">
                <CalendarDays size={27} />
                <strong>No session selected</strong>
                <span>Select a course, then click an empty calendar slot.</span>
              </div>
            )}
            <p className="booking-hint">
              Bookings are shared with the team in real time.
            </p>
          </aside>
        </div>
      </main>
      {modal === "login" && (
        <Modal title="Scheduler mode" close={() => setModal(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              login(
                new FormData(event.currentTarget).get("password") as string,
              );
            }}
          >
            <label className="form-label">
              Password
              <input name="password" type="password" autoFocus />
            </label>
            <button className="book-button" type="submit">
              Unlock scheduler
            </button>
          </form>
        </Modal>
      )}
      {modal === "my-bookings" && (
        <Modal title="My bookings" close={() => setModal(null)}>
          <p className="modal-copy">Enter the email used when you made your bookings.</p>
          <form onSubmit={(event) => { event.preventDefault(); lookupBookings(); }}>
            <label className="form-label">Requester email<input type="email" value={lookupEmail} onChange={(event) => setLookupEmail(event.target.value)} placeholder="name@example.com" required autoFocus /></label>
            <button className="book-button" type="submit"><Search size={17} /> Find my bookings</button>
          </form>
          {lookupResults && <div className="lookup-results">{lookupResults.length === 0 ? <p className="empty-list">No active bookings found for this email.</p> : lookupResults.map((booking) => <div className="lookup-booking" key={booking.id}><strong>{booking.training?.title ?? "Training session"}</strong><span>{booking.session?.date} · {booking.session?.startTime} PT · {booking.session?.durationMinutes} min</span><span>Customer: {booking.oem}</span><code>{booking.id}</code></div>)}</div>}
        </Modal>
      )}
      {modal === "session" && (
        <Modal title="Create session" close={() => setModal(null)}>
          <p className="modal-copy">
            Sessions are 30 minutes and use the course instructor.
          </p>
          <p className="timezone-note">All session dates and times use Pacific Time (PT).</p>
          <label className="form-label">
            Course
            <select
              value={selectedTraining?.id ?? ""}
              onChange={(event) =>
                setSelectedTraining(
                  trainings.find(
                    (training) => training.id === event.target.value,
                  ) ?? null,
                )
              }
            >
              {trainings.map((training) => (
                <option value={training.id} key={training.id}>
                  {training.title}
                </option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Date
            <input
              type="date"
              value={sessionDraft.date}
              onChange={(event) =>
                setSessionDraft({ ...sessionDraft, date: event.target.value })
              }
            />
          </label>
          <label className="form-label">
            Start time
            <input
              type="time"
              step="1800"
              value={sessionDraft.startTime}
              onChange={(event) =>
                setSessionDraft({
                  ...sessionDraft,
                  startTime: event.target.value,
                })
              }
            />
          </label>
          <button className="book-button" type="button" onClick={createSession}>
            <Check size={17} /> Create session
          </button>
        </Modal>
      )}
      {modal === "booking" && (
        <Modal title="Book this session" close={() => setModal(null)}>
          <p className="modal-copy">
            Your booking will be visible to everyone using this schedule.
          </p>
          {(["oem", "requesterName", "requesterEmail"] as const).map(
            (field) => (
              <label className="form-label" key={field}>
                {field === "oem"
                  ? "OEM / team name"
                  : field === "requesterName"
                    ? "Requester name"
                    : "Requester email"}
                <input
                  type={field === "requesterEmail" ? "email" : "text"}
                  value={bookingDraft[field]}
                  onChange={(event) =>
                    setBookingDraft({
                      ...bookingDraft,
                      [field]: event.target.value,
                    })
                  }
                  required
                />
              </label>
            ),
          )}
          <button className="book-button" type="button" onClick={createBooking}>
            <Check size={17} /> Confirm booking
          </button>
        </Modal>
      )}
      {modal === "cancel-booking" && bookingToCancel && (
        <Modal title="Cancel booking" close={() => { setBookingToCancel(null); setModal(null); }}>
          <p className="modal-copy">Enter the email used for this booking to confirm cancellation.</p>
          <form onSubmit={(event) => { event.preventDefault(); cancelBooking(new FormData(event.currentTarget).get("requesterEmail") as string); }}>
            <div className="cancel-summary"><strong>{bookingToCancel.oem}</strong><span>{bookingToCancel.requesterName}</span></div>
            <label className="form-label">Requester email<input name="requesterEmail" type="email" required autoFocus /></label>
            <button className="cancel-confirm-button" type="submit"><Trash2 size={16} /> Cancel booking</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="modal-close"
          type="button"
          title="Close"
          onClick={close}
        >
          <X size={18} />
        </button>
        <span className="section-kicker">TRAINING DESK</span>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export default App;
