import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock3,
  ExternalLink,
  FolderOpen,
  LockKeyhole,
  Plus,
  Search,
  Trash2,
  UserRound,
  Users,
  Video,
  X,
} from "lucide-react";
import { dump, load } from "js-yaml";
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
  odm?: string;
  requesterName: string;
  requesterEmail: string;
  createdAt: string;
  status: "pending" | "confirmed" | "cancelled";
  verificationToken?: string;
  tokenExpiresAt?: string;
  instructorEmail?: string | null;
};
type UnavailableDay = {
  date: string;
  label: string;
  warning: string;
};
type BookingLookup = Booking & { session?: Session; training?: Training };
type SlotTooltip = { session: Session; bookings: Booking[] };
type RecipientRow = { id: string; trainingId: string; oem: string; odm: string; email: string };
type SchedulerData = {
  trainings: Training[];
  sessions: Session[];
  bookings: Booking[];
  unavailableDays?: UnavailableDay[];
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
const OEM_OPTIONS = ["Dell", "HP", "Asus", "Acer", "Fujitsu", "VAIO", "Panasonic", "NEC", "Samsung", "LG", "Honor", "Wiko", "Dynabook", "Google", "Microsoft", "MSFT Surface", "MSI", "Xiaomi", "Lenovo China", "Lenovo Japan", "NA"] as const;
const ODM_OPTIONS = ["Quanta", "Pegatron", "Wistron", "Inventec", "Compal", "LCFC", "Luxshare", "Huaqin", "Longcheer", "NA"] as const;
type OemOption = (typeof OEM_OPTIONS)[number];
type OdmOption = (typeof ODM_OPTIONS)[number];
type OemFilterOption = "" | OemOption;
type OdmFilterOption = "" | OdmOption;
type TrainingVideoEntry = { title: string; url: string };
type TrainingVideoSubject = { subject: string; english?: TrainingVideoEntry; mandarin?: TrainingVideoEntry };
type TrainingVideoCatalog = { libraryUrl: string; videos: TrainingVideoSubject[] };
const userError = (code: string) =>
  ({
    SCHEDULER_AUTH_REQUIRED: "Scheduler mode is required to manage sessions.",
    INVALID_PASSWORD: "The scheduler password is incorrect.",
    REQUIRED_FIELDS_MISSING: "Please complete all required fields.",
    INVALID_CUSTOMER_SELECTION: "Please choose a valid OEM and ODM.",
    SESSION_NOT_FOUND: "This session is no longer available.",
    DUPLICATE_SESSION: "This course already has a session at that time.",
    INSTRUCTOR_CONFLICT: "This instructor already has a session at that time.",
    BOOKING_NOT_FOUND: "This booking could not be found, or the email entered does not match the requester email on file.",
    BOOKING_BLOCKED: "This booking is blocked by scheduler rules.",
    REQUIRED_UNAVAILABLE_FIELDS_MISSING:
      "Please select a training topic and valid start/end dates.",
    INVALID_UNAVAILABLE_RANGE: "The end date must be after the start date.",
    UNAVAILABLE_DAY_NOT_FOUND: "This unavailable day could not be found.",
    DUPLICATE_TOPIC_CUSTOMER_BOOKING:
      "This OEM/ODM already has a booking for the same training topic.",
    INVALID_EMAIL_RECIPIENTS_YAML: "Please check the recipient table for missing or invalid values.",
  })[code] ?? "Something went wrong. Please try again.";
const createRecipientRow = (trainingId = "", oem = "default", odm = "", email = ""): RecipientRow => ({
  id: crypto.randomUUID(),
  trainingId,
  oem,
  odm,
  email,
});
const parseRecipientRows = (yamlText: string): RecipientRow[] => {
  const parsed = load(yamlText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(userError("INVALID_EMAIL_RECIPIENTS_YAML"));
  return Object.entries(parsed as Record<string, unknown>).flatMap(([trainingId, mapping]) => {
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new Error(userError("INVALID_EMAIL_RECIPIENTS_YAML"));
    return Object.entries(mapping as Record<string, unknown>).map(([rule, email]) => {
      if (typeof email !== "string") throw new Error(userError("INVALID_EMAIL_RECIPIENTS_YAML"));
      const [oem, odm = ""] = rule.split(" / ");
      return createRecipientRow(trainingId, oem, odm, email);
    });
  });
};
const recipientRowsToYaml = (rows: RecipientRow[]) => {
  const normalized: Record<string, Record<string, string>> = {};
  rows.forEach((row) => {
    const trainingId = row.trainingId.trim();
    const oem = row.oem.trim();
    const odm = row.odm.trim();
    const email = row.email.trim();
    if (!trainingId || !oem || !email) throw new Error(userError("INVALID_EMAIL_RECIPIENTS_YAML"));
    normalized[trainingId] ??= {};
    normalized[trainingId][odm ? `${oem} / ${odm}` : oem] = email;
  });
  return dump(normalized, { noRefs: true });
};
const api = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const bodyText = await response.text();
    throw new Error(
      bodyText.includes("<!doctype html>")
        ? "The server responded with the app page instead of JSON. Check that the scheduler backend is running."
        : `Request failed (${response.status} ${response.statusText})`,
    );
  }
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
const sessionDateLabel = (date: string) => {
  const day = weekdays.find((item) => item.date === date);
  return day ? `${monthLabel(date)} ${day.day} (${day.weekday})` : date;
};
const deriveRequesterName = (email: string) => {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  return parts.length > 0 ? parts.join(" ") : email;
};
// Session start times are the Taiwan wall-clock time customers book; just relabel with an AM/PM indicator.
const twTimeLabel = (_date: string, time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
};
const timeFromRow = (row: number) => {
  const totalMinutes = 9 * 60 + row * 30;
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
};
const CALENDAR_ROW_HEIGHT = 25.5;
const CALENDAR_ROW_COUNT = 17;
const CALENDAR_BODY_HEIGHT = CALENDAR_ROW_HEIGHT * CALENDAR_ROW_COUNT;
const timeZones = [
  ["TW/CN Time", "Asia/Taipei"],
  ["JP/KR Time", "Asia/Tokyo"],
  ["U.S. West Coast Time", "America/Los_Angeles"],
] as const;
const formatClock = (timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
const isSystemUnavailableBooking = (booking: Booking) =>
  booking.requesterEmail === "scheduler-block@local" ||
  booking.requesterName === "System Block" ||
  booking.oem === "Not available";
const unavailableLabel = (training?: Training) =>
  training?.title.replace(/\s+for\s+/i, " ") ?? "Not available";
const customerLabel = (booking: Booking) =>
  booking.odm ? `${booking.oem} / ${booking.odm}` : booking.oem;
const majorCourseMeta = (training: Training) => {
  const normalized = `${training.id} ${training.title}`.toLowerCase();
  if (normalized.includes("wifi") && normalized.includes("8")) {
    return {
      key: "wifi-8-major",
      title: "WiFi 8",
      instructorLabel: "Account-based instructor",
      rank: 1,
    };
  }
  if (normalized.includes("hdt")) {
    return {
      key: "bt-hdt-major",
      title: "BT HDT",
      instructorLabel: "Account-based instructor",
      rank: 2,
    };
  }
  if (normalized.includes("wifi") && normalized.includes("log")) {
    return {
      key: "wifi-debug-major",
      title: "WiFi Debug Training",
      instructorLabel: "Hannah",
      rank: 3,
    };
  }
  if (normalized.includes("bt") && normalized.includes("log")) {
    return {
      key: "bt-debug-major",
      title: "BT Debug Training",
      instructorLabel: "Robin",
      rank: 4,
    };
  }
  return {
    key: `other-${training.id}`,
    title: training.shortTitle,
    instructorLabel: "Account-based instructor",
    rank: 99,
  };
};

function App() {
  const [data, setData] = useState<SchedulerData | null>(null);
  const [selectedTraining, setSelectedTraining] = useState<Training | null>(
    null,
  );
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [query, setQuery] = useState("");
  const [weekIndex, setWeekIndex] = useState(0);
  const [modal, setModal] = useState<"booking" | "login" | "my-bookings" | "topic-customer" | "booking-blocks" | "booking-confirmation" | "verification-success" | "email-recipients" | "training-videos" | null>(
    null,
  );
  const [bookingDraft, setBookingDraft] = useState<{
    oem: OemOption;
    odm: OdmOption;
    requesterEmail: string;
  }>({
    oem: OEM_OPTIONS[0],
    odm: ODM_OPTIONS[0],
    requesterEmail: "",
  });
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState("");
  const [bookingInProgress, setBookingInProgress] = useState(false);
  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupResults, setLookupResults] = useState<BookingLookup[] | null>(null);
  const [selectedOemFilter, setSelectedOemFilter] = useState<OemFilterOption>("");
  const [selectedOdmFilter, setSelectedOdmFilter] = useState<OdmFilterOption>("");
  const [bookingConfirmation, setBookingConfirmation] = useState<{ bookingId: string; email: string; instructorEmail?: string | null } | null>(null);
  const [recipientRows, setRecipientRows] = useState<RecipientRow[]>([]);
  const [trainingVideoCatalog, setTrainingVideoCatalog] = useState<TrainingVideoCatalog | null>(null);
  const [unavailableDraft, setUnavailableDraft] = useState<{
    trainingId: string;
    startDate: string;
    endDate: string;
    warning: string;
  }>({
    trainingId: "",
    startDate: "",
    endDate: "",
    warning: "",
  });
  const [activeDayWarnings, setActiveDayWarnings] = useState<UnavailableDay[] | null>(null);
  const [activeSlotTooltip, setActiveSlotTooltip] = useState<SlotTooltip | null>(null);
  const dayWarningTooltipRef = useRef<HTMLDivElement | null>(null);
  const slotTooltipRef = useRef<HTMLDivElement | null>(null);
  const [clocks, setClocks] = useState<Clock[]>(() => timeZones.map(([label, timeZone]) => ({ label, timeZone, time: formatClock(timeZone) })));
  const positionSlotTooltipAt = (clientX: number, clientY: number) => {
    const tooltip = slotTooltipRef.current;
    if (!tooltip) return;
    const width = tooltip.offsetWidth || 240;
    const height = tooltip.offsetHeight || 180;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, clientX + 14));
    const top = Math.max(8, Math.min(window.innerHeight - height - 8, clientY + 14));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };
  const positionSlotTooltip = (event: MouseEvent<HTMLElement>) => positionSlotTooltipAt(event.clientX, event.clientY);
  const refresh = async () => {
    const next = await api<SchedulerData>("/api/scheduler");
    setData(next);
    const confirmedBookingSessionIds = new Set(
      next.bookings
        .filter(
          (booking) =>
            booking.status === "confirmed" &&
            !isSystemUnavailableBooking(booking),
        )
        .map((booking) => booking.sessionId),
    );
    const latest = next.sessions
      .filter(
        (session) =>
          session.status === "active" &&
          confirmedBookingSessionIds.has(session.id),
      )
      .at(-1);
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
    api<TrainingVideoCatalog>("/api/training-videos")
      .then(setTrainingVideoCatalog)
      .catch(() => undefined);
    
  }, []);
  useEffect(() => { const updateClocks = () => setClocks(timeZones.map(([label, timeZone]) => ({ label, timeZone, time: formatClock(timeZone) }))); const interval = window.setInterval(updateClocks, 1000); return () => window.clearInterval(interval); }, []);
  useEffect(() => {
    if (!selectedTraining && data?.trainings[0])
      setSelectedTraining(data.trainings[0]);
  }, [data, selectedTraining]);
  useEffect(() => {
    const availableTrainings = data?.trainings ?? [];
    if (!unavailableDraft.trainingId && availableTrainings[0]) {
      setUnavailableDraft((current) => ({
        ...current,
        trainingId: availableTrainings[0].id,
      }));
    }
  }, [unavailableDraft.trainingId, data]);
  useEffect(() => {
    const confirmedBookingSessionIds = new Set(
      (data?.bookings ?? [])
        .filter(
          (booking) =>
            booking.status === "confirmed" &&
            !isSystemUnavailableBooking(booking),
        )
        .map((booking) => booking.sessionId),
    );
    const latest = (data?.sessions ?? [])
      .filter(
        (session) =>
          session.status === "active" &&
          confirmedBookingSessionIds.has(session.id),
      )
      .at(-1);
    if (!selectedSession && latest) {
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
    const topbar = document.querySelector<HTMLElement>(".topbar");
    if (!topbar) return;
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
      en: "<h3>Find a session</h3><p>Use the week arrows to browse weekdays from September 14 through October 2. Hover over a session to see course, instructor, delivery, and booking details.</p><h3>Book a session</h3><p>Select an open session and click <b>Book this session</b>. Enter the customer or team name, requester name, and requester email. Booking is confirmed immediately and the session shows the customer name.</p><h3>View bookings</h3><p>Click <b>My bookings</b>, enter the same requester email, and select <b>Find my bookings</b>.</p><h3>Scheduler operations</h3><p>Enter Scheduler mode with the scheduler password. Click an empty half-hour to create a 30-minute session, or select a session and use <b>Delete session</b>. Sessions must be weekdays, start between 09:00 and 17:00 PT, and use 30-minute increments.</p><h3>Time zones</h3><p>Schedule times use Pacific Time (PT). The header clocks show TW/CN, JP/KR, and U.S. West Coast local time.</p>",
      zh: "<h3>尋找場次</h3><p>使用週次箭頭瀏覽 9 月 14 日至 10 月 2 日的平日。將滑鼠移到場次上，可查看課程、講師、授課方式與預約資訊。</p><h3>預約場次</h3><p>選擇開放場次並點擊「Book this session」。填寫客戶或團隊名稱、預約人姓名與 email。預約會立即確認，場次會顯示客戶名稱。</p><h3>查看預約</h3><p>點擊「My bookings」，輸入相同的預約人 email，再點擊「Find my bookings」。</p><h3>Scheduler 操作</h3><p>使用管理密碼進入 Scheduler mode。點擊空白半小時建立 30 分鐘場次，或選擇場次後使用「Delete session」。場次必須是平日、Pacific Time 09:00 至 17:00 開始，並使用 30 分鐘間隔。</p><h3>時區</h3><p>排程時間使用 Pacific Time（PT）。頁首時鐘顯示台灣／中國、日韓與美國西岸時間。</p>",
      ko: "<h3>세션 찾기</h3><p>주간 화살표를 사용해 9월 14일부터 10월 2일까지의 평일을 확인하세요. 세션 위에 마우스를 올리면 과정, 강사, 진행 방식과 예약 정보를 볼 수 있습니다.</p><h3>세션 예약</h3><p>열린 세션을 선택하고 “Book this session”을 클릭하세요. 고객 또는 팀 이름, 신청자 이름과 이메일을 입력합니다. 예약은 즉시 확정되며 세션에 고객 이름이 표시됩니다.</p><h3>예약 확인</h3><p>“My bookings”를 클릭하고 예약에 사용한 이메일을 입력한 뒤 “Find my bookings”를 선택하세요.</p><h3>Scheduler 작업</h3><p>Scheduler password로 Scheduler mode에 들어가세요. 빈 30분 구간을 클릭해 30분 세션을 만들거나 세션을 선택해 “Delete session”을 사용하세요. 세션은 평일, Pacific Time 09:00~17:00 시작 시간, 30분 단위여야 합니다.</p><h3>시간대</h3><p>일정 시간은 Pacific Time(PT)을 사용합니다. 상단 시계는 TW/CN, JP/KR 및 미국 서부 시간을 표시합니다.</p>",
      ja: "<h3>セッションを探す</h3><p>週の矢印で、9月14日から10月2日までの平日を確認できます。セッションにカーソルを合わせると、コース、講師、配信方法、予約情報が表示されます。</p><h3>セッションを予約</h3><p>空いているセッションを選び、「Book this session」をクリックします。顧客またはチーム名、申請者名、メールアドレスを入力してください。予約はすぐに確定し、セッションに顧客名が表示されます。</p><h3>予約の確認</h3><p>「My bookings」をクリックし、予約時のメールアドレスを入力して「Find my bookings」を選択します。</p><h3>Scheduler の操作</h3><p>Scheduler passwordでScheduler modeに入ります。空いている30分枠をクリックしてセッションを作成するか、セッションを選択して「Delete session」を使用します。平日、Pacific Timeの09:00〜17:00開始、30分単位で設定してください。</p><h3>タイムゾーン</h3><p>スケジュールはPacific Time（PT）を使用します。ヘッダーにはTW/CN、JP/KR、米国西海岸の現在時刻が表示されます。</p>",
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
    const banner = document.querySelector<HTMLElement>(".error-banner");
    if (!banner) return;
    delete banner.dataset.errorCode;
  }, [error]);
  const trainings = data?.trainings ?? [];
  const visibleUnavailableDays = useMemo(
    () =>
      (data?.unavailableDays ?? [])
        .slice()
        .sort(
          (left, right) =>
            left.date.localeCompare(right.date) ||
            left.label.localeCompare(right.label),
        ),
    [data],
  );
  const rawBookings = data?.bookings ?? [];
  const blockedSessionIds = new Set(
    rawBookings
      .filter((booking) => booking.status === "confirmed" && isSystemUnavailableBooking(booking))
      .map((booking) => booking.sessionId),
  );
  const sessions =
    data?.sessions.filter(
      (session) =>
        session.status === "active" && !blockedSessionIds.has(session.id),
    ) ?? [];
  const bookings = rawBookings.filter(
    (booking) => !isSystemUnavailableBooking(booking),
  );
  const bookedSessionIds = useMemo(
    () =>
      new Set(
        bookings
          .filter((booking) => booking.status === "confirmed" || booking.status === "pending")
          .map((booking) => booking.sessionId),
      ),
    [bookings],
  );
  const visibleSessions = useMemo(
    () => sessions.filter((session) => bookedSessionIds.has(session.id)),
    [sessions, bookedSessionIds],
  );
  const availableSessions = useMemo(
    () => sessions.filter((session) => !bookedSessionIds.has(session.id)),
    [sessions, bookedSessionIds],
  );
  const courseCatalog = useMemo(() => {
    const grouped = new Map<string, Training[]>();
    trainings.forEach((training) => {
      const key = majorCourseMeta(training).key;
      (grouped.get(key) ?? grouped.set(key, []).get(key)!).push(training);
    });
    return Array.from(grouped.entries())
      .map(([key, group]) => {
        const representative =
          group.find((item) => !item.id.includes("-asus") && !item.id.includes("-honor")) ??
          group[0];
        const meta = majorCourseMeta(representative);
        return {
          key,
          title: meta.title,
          instructorLabel: meta.instructorLabel,
          training: representative,
          rank: meta.rank,
        };
      })
      .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
  }, [trainings]);
  const filteredCatalog = useMemo(
    () =>
      courseCatalog.filter((entry) =>
        `${entry.title} ${entry.instructorLabel}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [courseCatalog, query],
  );
  const selectedCourseKey = selectedTraining
    ? majorCourseMeta(selectedTraining).key
    : "";
  const selectedBookings = selectedSession
    ? bookings.filter((booking) => booking.sessionId === selectedSession.id)
    : [];
  const selectedSessionState = !selectedSession
    ? "open"
    : blockedSessionIds.has(selectedSession.id)
      ? "closed"
      : selectedBookings.length > 0
        ? "shared"
        : "open";
  const canBookSelectedSession =
    Boolean(selectedSession) && selectedSessionState !== "closed";
  const bookingTopicOptions = useMemo(
    () => {
      if (!selectedSession) return [];
      const sessionsAtSlot = sessions.filter(
        (session) =>
          session.date === selectedSession.date &&
          session.startTime === selectedSession.startTime &&
          !blockedSessionIds.has(session.id),
      );
      return courseCatalog
        .map((entry) => ({
          key: entry.key,
          title: entry.title,
          session: sessionsAtSlot.find(
            (session) => session.training && majorCourseMeta(session.training).key === entry.key,
          ),
        }))
        .filter((entry): entry is { key: string; title: string; session: Session } => Boolean(entry.session));
    },
    [blockedSessionIds, courseCatalog, selectedSession, sessions],
  );
  const selectedBookingTopicKey = selectedSession?.training ? majorCourseMeta(selectedSession.training).key : "";
  const bookingCourseSessions = useMemo(
    () =>
      selectedBookingTopicKey
        ? sessions.filter(
            (session) => session.training && majorCourseMeta(session.training).key === selectedBookingTopicKey,
          )
        : [],
    [sessions, selectedBookingTopicKey],
  );
  const bookingAvailableDates = useMemo(
    () => Array.from(new Set(bookingCourseSessions.map((session) => session.date))).sort(),
    [bookingCourseSessions],
  );
  const bookingAvailableTimes = useMemo(
    () =>
      Array.from(
        new Set(
          bookingCourseSessions
            .filter((session) => session.date === selectedSession?.date)
            .map((session) => session.startTime),
        ),
      ).sort(),
    [bookingCourseSessions, selectedSession],
  );
  const changeBookingDate = (nextDate: string) => {
    const candidates = bookingCourseSessions.filter((session) => session.date === nextDate);
    const match =
      candidates.find((session) => session.startTime === selectedSession?.startTime) ??
      candidates.slice().sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
    if (!match) return;
    setSelectedSession(match);
    setSelectedTraining(match.training ?? null);
  };
  const changeBookingTime = (nextTime: string) => {
    const match = bookingCourseSessions.find(
      (session) => session.date === selectedSession?.date && session.startTime === nextTime,
    );
    if (!match) return;
    setSelectedSession(match);
    setSelectedTraining(match.training ?? null);
  };
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const topicVsCustomerRows = useMemo(() => {
    if (!selectedOemFilter || !selectedOdmFilter) {
      return trainings
        .map((training) => ({
          title: training.title,
          count: 0,
        }))
        .sort((a, b) => a.title.localeCompare(b.title));
    }
    const counts = new Map<string, number>();
    bookings
      .filter(
        (booking) =>
          booking.status === "confirmed" &&
          booking.oem === selectedOemFilter &&
          booking.odm === selectedOdmFilter,
      )
      .forEach((booking) => {
        const session = sessionById.get(booking.sessionId);
        if (!session?.training) return;
        const key = session.training.title;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });
    return trainings
      .map((training) => ({
        title: training.title,
        count: counts.get(training.title) ?? 0,
      }))
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  }, [bookings, selectedOemFilter, selectedOdmFilter, sessionById, trainings]);
  const selectedCustomerTotal = topicVsCustomerRows.reduce(
    (sum, row) => sum + row.count,
    0,
  );
  const unavailableDays = useMemo(() => {
    if (data?.unavailableDays?.length) return data.unavailableDays;
    const bySession = new Map((data?.sessions ?? []).map((session) => [session.id, session]));
    const fallback = rawBookings
      .filter((booking) => booking.status === "confirmed" && isSystemUnavailableBooking(booking))
      .map((booking) => {
        const session = bySession.get(booking.sessionId);
        if (!session) return null;
        const label = unavailableLabel(session.training);
        return {
          date: session.date,
          label,
          warning: `${label} is not available all day.`,
        };
      })
      .filter((entry): entry is UnavailableDay => Boolean(entry));
    return Array.from(
      new Map(
        fallback.map((entry) => [`${entry.date}|${entry.label}`, entry]),
      ).values(),
    );
  }, [data, rawBookings]);
  const unavailableByDate = useMemo(
    () =>
      unavailableDays.reduce<Record<string, UnavailableDay[]>>((groups, item) => {
        (groups[item.date] ??= []).push(item);
        return groups;
      }, {}),
    [unavailableDays],
  );
  const currentWeek = weekGroups[weekIndex];
  useEffect(() => {
    if (!selectedSession) return;
    if (!sessions.some((session) => session.id === selectedSession.id)) {
      setSelectedSession(null);
    }
  }, [sessions, selectedSession]);
  const createBooking = async () => {
    if (!selectedSession || bookingInProgress) return;
    setBookingInProgress(true);
    try {
      const result = await api<Booking>("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          ...bookingDraft,
          requesterName: deriveRequesterName(bookingDraft.requesterEmail),
          sessionId: selectedSession.id,
        }),
      });
      setBookingConfirmation({ bookingId: result.id, email: result.requesterEmail, instructorEmail: result.instructorEmail });
      setModal("booking-confirmation");
      setBookingDraft({ oem: OEM_OPTIONS[0], odm: ODM_OPTIONS[0], requesterEmail: "" });
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBookingInProgress(false);
    }
  };
  const loadRecipientConfig = async () => {
    try {
      const result = await api<{ yaml: string }>("/api/email-recipients");
      setRecipientRows(parseRecipientRows(result.yaml));
      setModal("email-recipients");
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const saveRecipientConfig = async () => {
    try {
      const yaml = recipientRowsToYaml(recipientRows);
      await api("/api/email-recipients", {
        method: "PUT",
        body: JSON.stringify({ yaml }),
      });
      setModal(null);
      setRecipientRows([]);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const updateRecipientRow = (id: string, updates: Partial<Omit<RecipientRow, "id">>) => {
    setRecipientRows((current) => current.map((row) => row.id === id ? { ...row, ...updates } : row));
  };
  const addRecipientRow = () => {
    setRecipientRows((current) => [...current, createRecipientRow(data?.trainings[0]?.id ?? "wifi-log")]);
  };
  const deleteRecipientRow = (id: string) => {
    setRecipientRows((current) => current.filter((row) => row.id !== id));
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
  const lookupBookings = async () => {
    try {
      const result = await api<{ bookings: BookingLookup[] }>(`/api/bookings?email=${encodeURIComponent(lookupEmail)}`);
      setLookupResults(result.bookings);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const createUnavailableDay = async () => {
    try {
      await api("/api/unavailable-days", {
        method: "POST",
        body: JSON.stringify({
          trainingId: unavailableDraft.trainingId,
          startDate: unavailableDraft.startDate,
          endDate: unavailableDraft.endDate,
          warning: unavailableDraft.warning || undefined,
        }),
      });
      await refresh();
      setUnavailableDraft((current) => ({
        ...current,
        startDate: "",
        endDate: "",
        warning: "",
      }));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const deleteUnavailableDay = async (date: string, label: string) => {
    try {
      await api("/api/unavailable-days", {
        method: "DELETE",
        body: JSON.stringify({ date, label }),
      });
      await refresh();
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
            <h1>Training Schedule</h1>
            <p className="lede">
              Coordinate technical enablement across your customer network.
            </p>
          </div>
          <div className="heading-actions">
            <button className="secondary-button" type="button" onClick={() => { setLookupResults(null); setModal("my-bookings"); }}>
              <CalendarDays size={16} /> My bookings
            </button>
            {authenticated && (
              <button className="secondary-button" type="button" onClick={loadRecipientConfig}>
                Configure recipients
              </button>
            )}
            <button className="secondary-button" type="button" onClick={() => setModal("topic-customer")}>
              <Users size={16} /> Topic vs Customer
            </button>
            {authenticated && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => setModal("booking-blocks")}
              >
                <LockKeyhole size={16} /> Manage unavailable days
              </button>
            )}
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
              <strong>{sessions.length} slots</strong>
              <span>Pre-filled in database</span>
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
              {filteredCatalog.map((entry) => (
                <button
                  className={`course-item ${selectedCourseKey === entry.key ? "selected" : ""}`}
                  key={entry.key}
                  type="button"
                  onClick={() => setSelectedTraining(entry.training)}
                >
                  <span className={`course-dot ${entry.training.accent}`} />
                  <span className="course-copy">
                    <strong>{entry.title}</strong>
                    <small>
                      <UserRound size={12} /> {entry.instructorLabel}{" "}
                      <span className="bullet">•</span>{" "}
                      Recorded video with live QnA by Instructor
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <button className="secondary-button offline-video-trigger" type="button" onClick={() => setModal("training-videos")}>
              <Video size={16} /> Offline training videos
            </button>
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
                {currentWeek.days.map((day) => {
                  return (
                  <div className="day-head" key={day.date}>
                    <span>{day.weekday}</span>
                    <strong>{day.day}</strong>
                    <small>{monthLabel(day.date)}</small>
                  </div>
                  );
                })}
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
                {currentWeek.days.map((day) => {
                  const dayWarnings = unavailableByDate[day.date] ?? [];
                  return (
                  <div
                    className="day-column"
                    key={day.date}
                    onMouseMove={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const row = Math.max(
                        0,
                        Math.min(16, Math.floor((event.clientY - rect.top) / 25.5)),
                      );
                      event.currentTarget.style.setProperty("--hover-row", String(row));
                      if (dayWarnings.length > 0) {
                        const x = Math.max(8, Math.min(window.innerWidth - 236, event.clientX + 14));
                        const y = Math.max(8, Math.min(window.innerHeight - 132, event.clientY + 14));
                        if (dayWarningTooltipRef.current) {
                          dayWarningTooltipRef.current.style.left = `${x}px`;
                          dayWarningTooltipRef.current.style.top = `${y}px`;
                        }
                        setActiveDayWarnings((current) => {
                          if (
                            current &&
                            current.length === dayWarnings.length &&
                            current.every((item, index) => item.date === dayWarnings[index].date && item.label === dayWarnings[index].label)
                          ) {
                            return current;
                          }
                          return dayWarnings;
                        });
                      } else if (activeDayWarnings) {
                        setActiveDayWarnings(null);
                      }
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.removeProperty("--hover-row");
                      if (activeDayWarnings) setActiveDayWarnings(null);
                    }}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest(".slot"))
                        return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      const relativeY = event.clientY - rect.top;
                      if (relativeY < 0 || relativeY >= CALENDAR_BODY_HEIGHT) return;
                      const row = Math.max(
                        0,
                        Math.min(
                          CALENDAR_ROW_COUNT - 1,
                          Math.floor(relativeY / CALENDAR_ROW_HEIGHT),
                        ),
                      );
                      const clickedTime = timeFromRow(row);
                      const dayAvailable = availableSessions
                        .filter((session) => session.date === day.date)
                        .sort((a, b) =>
                          a.startTime.localeCompare(b.startTime),
                        );
                      if (dayAvailable.length === 0) {
                        setError("No available sessions left for this day.");
                        return;
                      }
                      const nextMatch =
                        dayAvailable.find((session) => session.startTime === clickedTime) ??
                        dayAvailable.find((session) => session.startTime > clickedTime) ??
                        dayAvailable[0];
                      setSelectedSession(nextMatch);
                      setSelectedTraining(nextMatch.training ?? null);
                      setModal("booking");
                      setError("");
                    }}
                  >
                    {Array.from({ length: 17 }, (_, index) => (
                      <span className="hour-line" key={index} />
                    ))}
                    {Object.values(
                      visibleSessions
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
                        const confirmedCount = sessionBookings.filter((b) => b.status === "confirmed").length;
                        const pendingCount = sessionBookings.filter((b) => b.status === "pending").length;
                        const bookingCount = sessionBookings.length;
                        const hasPending = pendingCount > 0;
                        const slotStateClass = blockedSessionIds.has(session.id)
                          ? "closed-slot"
                          : bookingCount > 0
                            ? "shared-slot"
                            : "open-slot";
                        return (
                        <button
                          className={`slot ${session.training?.accent ?? ""} ${slotStateClass}${hasPending ? " pending-bookings" : ""}`}
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
                          onMouseEnter={(event) => {
                            setActiveSlotTooltip({ session, bookings: sessionBookings });
                            requestAnimationFrame(() => positionSlotTooltip(event));
                          }}
                          onMouseMove={positionSlotTooltip}
                          onMouseLeave={() => setActiveSlotTooltip(null)}
                          onFocus={(event) => {
                            setActiveSlotTooltip({ session, bookings: sessionBookings });
                            const rect = event.currentTarget.getBoundingClientRect();
                            requestAnimationFrame(() => positionSlotTooltipAt(rect.left, rect.bottom));
                          }}
                          onBlur={() => setActiveSlotTooltip(null)}
                        >
                          <strong>
                            {`${session.training?.shortTitle} · ${session.startTime} PT`}
                          </strong>
                          <small>{bookingCount > 0 ? "Shared slot" : "Open"}</small>
                          {bookingCount > 0 && (
                            <span className="slot-booking-count">
                              {confirmedCount} confirmed{pendingCount > 0 ? `, ${pendingCount} pending` : ""}
                            </span>
                          )}
                        </button>
                        );
                      }),
                    )}
                  </div>
                  );
                })}
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
                <i className="legend-dot shared" /> Shared slot (still bookable)
              </span>
              <span>
                <i className="legend-dot closed" /> Closed slot
              </span>
              <span className="all-day-legend">ALL DAY unavailable on marked dates</span>
              <span className="footer-note">Weekdays · 09:00–17:30 PT</span>
            </div>
            {activeDayWarnings && (
              <div
                ref={dayWarningTooltipRef}
                className="floating-day-warning-tooltip"
                style={{ left: "8px", top: "8px" }}
              >
                <strong>Warning</strong>
                {activeDayWarnings.map((item) => (
                  <span key={`${item.date}-${item.label}`}>{item.warning}</span>
                ))}
              </div>
            )}
            {activeSlotTooltip && (
              <div
                ref={slotTooltipRef}
                className="slot-tooltip"
                style={{ left: "8px", top: "8px" }}
              >
                <b>{activeSlotTooltip.session.training?.title}</b>
                <span>{activeSlotTooltip.session.startTime} PT · 30 min</span>
                <span>Instructor: {activeSlotTooltip.session.training?.instructor}</span>
                <span>Delivery: {activeSlotTooltip.session.training?.mode === "Live" ? "Instructor-led" : "CFE online video"}</span>
                {activeSlotTooltip.bookings.length > 0 ? activeSlotTooltip.bookings.map((booking) => (
                  <span className={`booking-info${booking.status === "pending" ? " pending" : ""}`} key={booking.id}>
                    <b>OEM: {booking.oem}</b>
                    <b>ODM: {booking.odm ?? "NA"}</b>
                    <span>Booked by: {booking.requesterEmail}</span>
                    {booking.status === "pending" && <span className="pending-badge">Awaiting confirmation</span>}
                  </span>
                )) : <span>No bookings yet</span>}
                <span className="slot-capacity-note">
                  This slot supports multiple OEM/ODM bookings.
                </span>
              </div>
            )}
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
                        <strong>{customerLabel(booking)}</strong>
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
                {selectedSessionState === "shared" && (
                  <div className="session-capacity shared">
                    <Check size={16} /> Already booked by {selectedBookings.length} customer(s), still open for other OEM/ODM.
                  </div>
                )}
                {selectedSessionState === "closed" && (
                  <div className="session-capacity closed">
                    <LockKeyhole size={16} /> This slot is closed and cannot accept new bookings.
                  </div>
                )}
                {canBookSelectedSession ? (
                  <button
                    className="book-button"
                    type="button"
                    onClick={() => setModal("booking")}
                  >
                    <Plus size={17} /> {selectedBookings.length > 0 ? "Book this shared slot" : "Book this session"}
                  </button>
                ) : (
                  <div className="session-capacity closed">
                    <LockKeyhole size={16} /> Slot closed
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
          {lookupResults && <div className="lookup-results">{lookupResults.length === 0 ? <p className="empty-list">No active bookings found for this email.</p> : lookupResults.map((booking) => <div className="lookup-booking" key={booking.id}><strong>{booking.training?.title ?? "Training session"}</strong><span>{booking.session?.date} · {booking.session?.startTime} PT · {booking.session?.durationMinutes} min</span><span>Customer: {customerLabel(booking)}</span><code>{booking.id}</code></div>)}</div>}
        </Modal>
      )}
      {modal === "topic-customer" && (
        <Modal title="Topic vs Customer" close={() => setModal(null)}>
          <p className="modal-copy">Select OEM and ODM to review how many sessions are booked by training topic.</p>
          <label className="form-label">
            OEM
            <select
              value={selectedOemFilter}
              onChange={(event) => setSelectedOemFilter(event.target.value as OemFilterOption)}
            >
              <option value="">Select OEM</option>
              {OEM_OPTIONS.map((oem) => (
                <option value={oem} key={oem}>
                  {oem}
                </option>
              ))}
            </select>
          </label>
          <label className="form-label">
            ODM
            <select
              value={selectedOdmFilter}
              onChange={(event) => setSelectedOdmFilter(event.target.value as OdmFilterOption)}
            >
              <option value="">Select ODM</option>
              {ODM_OPTIONS.map((odm) => (
                <option value={odm} key={odm}>
                  {odm}
                </option>
              ))}
            </select>
          </label>
          <div className="topic-summary-total">
            <strong>Total booked sessions ({selectedOemFilter || "Select OEM"} / {selectedOdmFilter || "Select ODM"}):</strong> {selectedCustomerTotal}
          </div>
          <div className="topic-summary-list">
            {topicVsCustomerRows.map((row) => (
              <div className="topic-summary-row" key={row.title}>
                <span>{row.title}</span>
                <strong>{row.count}</strong>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal === "training-videos" && (
        <Modal title="Offline training videos" close={() => setModal(null)} wide>
          <p className="modal-copy">Download and distribute these recordings to customers at will.</p>
          <a className="offline-video-library-link" href={trainingVideoCatalog?.libraryUrl} target="_blank" rel="noreferrer">
            <FolderOpen size={13} /> Open full SharePoint library
          </a>
          <div className="course-list offline-video-list">
            {(trainingVideoCatalog?.videos ?? []).map((entry) => (
              <div className="course-item offline-video-item" key={entry.subject}>
                <span className="course-dot slate" />
                <span className="course-copy">
                  <strong>{entry.subject}</strong>
                  <small>
                    <Video size={12} /> Offline recording{" "}
                    <span className="bullet">•</span>{" "}
                    For customer distribution
                  </small>
                </span>
                <span className="offline-video-links">
                  {entry.english && (
                    <a className="offline-video-link" href={entry.english.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={12} /> EN
                    </a>
                  )}
                  {entry.mandarin && (
                    <a className="offline-video-link" href={entry.mandarin.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={12} /> 中文
                    </a>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal === "email-recipients" && (
        <Modal title="Configure email recipients" close={() => setModal(null)} wide>
          <p className="modal-copy">Edit who gets notified for each training and OEM. The server saves these rows back to the YAML recipient file.</p>
          <div className="recipient-table" role="table" aria-label="Email recipient mapping">
            <div className="recipient-table-head" role="row">
              <span role="columnheader">Training</span>
              <span role="columnheader">OEM / rule</span>
              <span role="columnheader">ODM</span>
              <span role="columnheader">Recipient email</span>
              <span role="columnheader">Action</span>
            </div>
            {recipientRows.map((row) => (
              <div className="recipient-table-row" role="row" key={row.id}>
                <input
                  aria-label="Training ID"
                  list="recipient-training-options"
                  value={row.trainingId}
                  onChange={(event) => updateRecipientRow(row.id, { trainingId: event.target.value })}
                />
                <input
                  aria-label="OEM or default rule"
                  list="recipient-oem-options"
                  value={row.oem}
                  onChange={(event) => updateRecipientRow(row.id, { oem: event.target.value })}
                />
                <input
                  aria-label="ODM rule"
                  list="recipient-odm-options"
                  value={row.odm}
                  onChange={(event) => updateRecipientRow(row.id, { odm: event.target.value })}
                />
                <input
                  aria-label="Recipient email"
                  type="email"
                  value={row.email}
                  onChange={(event) => updateRecipientRow(row.id, { email: event.target.value })}
                />
                <button className="icon-button" type="button" title="Remove recipient row" onClick={() => deleteRecipientRow(row.id)}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <datalist id="recipient-training-options">
            {data?.trainings.map((training) => <option value={training.id} key={training.id}>{training.title}</option>)}
          </datalist>
          <datalist id="recipient-oem-options">
            <option value="default">Default</option>
            {OEM_OPTIONS.map((oem) => <option value={oem} key={oem} />)}
          </datalist>
          <datalist id="recipient-odm-options">
            {ODM_OPTIONS.map((odm) => <option value={odm} key={odm} />)}
          </datalist>
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={addRecipientRow}>
              <Plus size={16} /> Add row
            </button>
            <button className="secondary-button" type="button" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button className="book-button" type="button" onClick={saveRecipientConfig}>
              Save recipients
            </button>
          </div>
        </Modal>
      )}
      {modal === "booking-blocks" && (
        <Modal title="Manage unavailable days" close={() => setModal(null)}>
          <p className="modal-copy">
            Add or remove unavailable days. These entries are stored in YAML and
            enforced by the server when users book sessions.
          </p>
          <label className="form-label">
            Training topic
            <select
              value={unavailableDraft.trainingId}
              onChange={(event) =>
                setUnavailableDraft({
                  ...unavailableDraft,
                  trainingId: event.target.value,
                })
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
            Start date
            <input
              type="date"
              value={unavailableDraft.startDate}
              onChange={(event) =>
                setUnavailableDraft({
                  ...unavailableDraft,
                  startDate: event.target.value,
                })
              }
            />
          </label>
          <label className="form-label">
            End date
            <input
              type="date"
              value={unavailableDraft.endDate}
              onChange={(event) =>
                setUnavailableDraft({
                  ...unavailableDraft,
                  endDate: event.target.value,
                })
              }
            />
          </label>
          <label className="form-label">
            Warning message (optional)
            <input
              type="text"
              value={unavailableDraft.warning}
              onChange={(event) =>
                setUnavailableDraft({
                  ...unavailableDraft,
                  warning: event.target.value,
                })
              }
              placeholder="Leave empty to auto-generate"
            />
          </label>
          <button className="book-button" type="button" onClick={createUnavailableDay}>
            <Plus size={17} /> Add unavailable days
          </button>
          <div className="booking-block-list">
            <h3>Current unavailable days</h3>
            {visibleUnavailableDays.length === 0 ? (
              <p className="empty-list">No unavailable days yet.</p>
            ) : (
              visibleUnavailableDays.map((day) => {
                return (
                  <div className="booking-block-item" key={`${day.date}-${day.label}`}>
                    <div>
                      <strong>{day.label}</strong>
                      <span>{day.date}</span>
                      <span>{day.warning}</span>
                    </div>
                    <button
                      className="cancel-booking-button"
                      type="button"
                      onClick={() => deleteUnavailableDay(day.date, day.label)}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </Modal>
      )}
      {modal === "booking" && (
        <Modal title="Book this session" close={() => setModal(null)}>
          <p className="modal-copy">
            Your booking will be visible to everyone using this schedule.
          </p>
          <label className="form-label">
            Session date
            <select
              value={selectedSession?.date ?? ""}
              disabled={bookingInProgress}
              onChange={(event) => changeBookingDate(event.target.value)}
            >
              {bookingAvailableDates.map((date) => (
                <option value={date} key={date}>
                  {sessionDateLabel(date)}
                </option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Start time (Taiwan time)
            <select
              value={selectedSession?.startTime ?? ""}
              disabled={bookingInProgress}
              onChange={(event) => changeBookingTime(event.target.value)}
            >
              {bookingAvailableTimes.map((time) => (
                <option value={time} key={time}>
                  {twTimeLabel(selectedSession?.date ?? "", time)}
                </option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Training topic
            <select
              value={selectedBookingTopicKey}
              disabled={bookingInProgress}
              onChange={(event) => {
                const option = bookingTopicOptions.find((item) => item.key === event.target.value);
                if (!option) return;
                setSelectedSession(option.session);
                setSelectedTraining(option.session.training ?? null);
              }}
            >
              {bookingTopicOptions.map((option) => (
                <option value={option.key} key={option.key}>
                  {option.title}
                </option>
              ))}
            </select>
          </label>
          <label className="form-label">
            OEM
            <select
              value={bookingDraft.oem}
              disabled={bookingInProgress}
              onChange={(event) =>
                setBookingDraft({
                  ...bookingDraft,
                  oem: event.target.value as OemOption,
                })
              }
            >
              {OEM_OPTIONS.map((oem) => (
                <option value={oem} key={oem}>
                  {oem}
                </option>
              ))}
            </select>
          </label>
          <label className="form-label">
            ODM
            <select
              value={bookingDraft.odm}
              disabled={bookingInProgress}
              onChange={(event) =>
                setBookingDraft({
                  ...bookingDraft,
                  odm: event.target.value as OdmOption,
                })
              }
            >
              {ODM_OPTIONS.map((odm) => (
                <option value={odm} key={odm}>
                  {odm}
                </option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Requester email
            <input
              type="email"
              value={bookingDraft.requesterEmail}
              onChange={(event) =>
                setBookingDraft({
                  ...bookingDraft,
                  requesterEmail: event.target.value,
                })
              }
              required
            />
          </label>
          <button className="book-button" type="button" onClick={createBooking} disabled={bookingInProgress}>
            {bookingInProgress ? <span className="button-spinner" aria-hidden="true" /> : <Check size={17} />}
            {bookingInProgress ? "Sending notification..." : "Confirm booking"}
          </button>
        </Modal>
      )}
      {modal === "booking-confirmation" && bookingConfirmation && (
        <Modal title="Booking confirmed" close={() => { setBookingConfirmation(null); setModal(null); }}>
          <p className="modal-copy">
            Your booking has been confirmed and a notification email has been sent to <strong>{bookingConfirmation.email}</strong>
            {bookingConfirmation.instructorEmail ? <> and <strong>{bookingConfirmation.instructorEmail}</strong></> : null}.
          </p>
          <p className="modal-copy">
            The corresponding engineering contact for this session has also been notified.
          </p>
          <button className="book-button" type="button" onClick={() => { setBookingConfirmation(null); setModal(null); }}>
            <Check size={17} /> Done
          </button>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className={wide ? "modal modal-wide" : "modal"}
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
