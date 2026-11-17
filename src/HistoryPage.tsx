import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, BarChart3, Download, FileJson, LockKeyhole, Save } from "lucide-react";
import { isHeld, summarizeTrainingHistory, type HistoryBooking, type HistorySession } from "../server/training-history-summary.ts";
import { HistoryAnalytics } from "./HistoryAnalytics.tsx";

type HistoryResponse = { today: string; oemOptions: string[]; sessions: HistorySession[] };
type Filters = { trainingId: string; oem: string; instructor: string; from: string; to: string };

// Inlined into the downloaded snapshot so it renders offline without the app stylesheet.
const HISTORY_CSS = `
.history-report { font: 14px/1.5 Verdana, Geneva, sans-serif; color: #32526A; background: #F3F4EF; padding: 24px; }
.history-report h1 { font-family: Arial, Helvetica, sans-serif; margin: 0 0 4px; }
.history-report h2 { font-family: Arial, Helvetica, sans-serif; margin: 28px 0 8px; border-bottom: 2px solid #779FE3; padding-bottom: 4px; }
.history-report h3 { margin: 18px 0 6px; }
.history-report .meta { color: #6F7D88; font-size: 12px; margin: 0 0 16px; }
.history-report .totals { display: flex; flex-wrap: wrap; gap: 12px; }
.history-report .total { background: #fff; border: 1px solid #D8DDD9; padding: 10px 14px; min-width: 120px; }
.history-report .total strong { display: block; font-size: 22px; }
.history-report table { border-collapse: collapse; width: 100%; background: #fff; margin: 6px 0 12px; font-size: 12px; }
.history-report th, .history-report td { border: 1px solid #D8DDD9; padding: 5px 8px; text-align: left; vertical-align: top; }
.history-report th { background: #E5ECF8; }
.history-report .tag { display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 6px; margin-left: 6px; background: #A18851; color: #fff; }
.history-report .note { color: #90626C; font-weight: 700; }
.history-report .muted { color: #6F7D88; }
.history-report .attendance-entry { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.history-report .attendance-entry input { width: 5em; padding: 4px; font: inherit; }
.history-report .attendance-entry button { display: inline-flex; align-items: center; gap: 4px; padding: 4px 6px; cursor: pointer; }
.history-report .attendance-entry .history-error { flex-basis: 100%; }
.history-report details { background: #fff; border: 1px solid #D8DDD9; margin: 6px 0; padding: 6px 10px; }
.history-report summary { cursor: pointer; font-weight: 700; }
.history-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; padding: 16px 24px; border-bottom: 1px solid #D8DDD9; }
.history-toolbar label { display: grid; gap: 2px; font-size: 11px; font-weight: 700; }
.history-toolbar select, .history-toolbar input { padding: 6px 8px; font: inherit; font-size: 12px; }
.history-error { color: #90626C; font-weight: 700; }
.analytics-section { margin: 24px 0 8px; }
.analytics-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 12px; }
.analytics-header h2 { margin: 0; border-bottom: 2px solid #779FE3; padding-bottom: 4px; flex: 1 1 auto; }
.findings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-bottom: 16px; }
.finding-card { background: #fff; border: 1px solid #D8DDD9; border-left: 4px solid #779FE3; padding: 12px 14px; }
.finding-card h3 { margin: 0 0 6px; font-size: 13px; color: #121212; }
.finding-card p { margin: 0; font-size: 12px; color: #404040; }
.finding-negative { border-left-color: #e3120b; }
.finding-warning { border-left-color: #b45309; }
.finding-positive { border-left-color: #006ba6; }
.finding-neutral { border-left-color: #6F7D88; }
.analytics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; }
.analytics-card { background: #fff; border: 1px solid #D8DDD9; padding: 14px 16px; }
.analytics-card-head h3 { margin: 0 0 2px; font-size: 14px; }
.analytics-question { margin: 0 0 8px; font-size: 12px; color: #6F7D88; }
.analytics-insight { margin: 10px 0 0; padding: 8px 10px; background: #F7F7F5; border-left: 3px solid #006ba6; font-size: 12px; color: #32526A; }
`;

const ratioText = (value: number | null) => (value === null ? "n/a" : value.toFixed(2));
const formatLabel = (value?: HistoryBooking["trainingFormat"]) => (value === "with-video" ? "With video" : value === "without-video" ? "Live, no video" : "Not specified");

const fetchJson = async <T,>(url: string, options?: RequestInit): Promise<{ status: number; body: T }> => {
  const response = await fetch(url, { cache: "no-store", credentials: "include", headers: { "Content-Type": "application/json" }, ...options });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as T };
};

const downloadFile = (fileName: string, type: string, content: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

function BookingTable({ bookings, cancelled }: { bookings: HistoryBooking[]; cancelled?: boolean }) {
  return (
    <table>
      <thead>
        <tr>
          <th>OEM</th><th>ODM</th><th>Format</th><th>Requester</th><th>Email</th><th>Engineering contact</th><th>{cancelled ? "Cancelled at" : "Booked at"}</th>
        </tr>
      </thead>
      <tbody>
        {bookings.map((item) => (
          <tr key={item.bookingId}>
            <td>{item.oem}</td>
            <td>{item.odm ?? "NA"}</td>
            <td>{formatLabel(item.trainingFormat)}</td>
            <td>{item.requesterName}</td>
            <td>{item.requesterEmail}</td>
            <td>{item.instructorEmail ?? "Not configured"}</td>
            <td>{(cancelled ? item.cancelledAt : item.createdAt) ?? "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SessionDetails({ session }: { session: HistorySession }) {
  return (
    <details>
      <summary>
        {session.date} {session.startTime} - {session.trainingTitle}
        {session.hidden && <span className="tag">Hidden</span>}
        {" "}| {session.bookings.length} booking(s), {session.attendeeCount} attendee(s), ratio {ratioText(session.turnoutRatio)}
        {!session.attendanceRecorded && session.status === "active" && <span className="note"> | attendance not recorded</span>}
      </summary>
      <p className="muted">Session {session.sessionId} | {session.durationMinutes} min | Instructor(s): {session.instructors.join(", ") || "Unknown"}</p>
      {session.notes.map((note) => <p key={note} className="note">{note}</p>)}
      {session.bookings.length > 0 && <BookingTable bookings={session.bookings} />}
      {session.attendance.length > 0 && (
        <table>
          <thead><tr><th>Instructor</th><th>Attendees</th><th>Notes</th><th>Recorded at</th></tr></thead>
          <tbody>
            {session.attendance.map((record) => (
              <tr key={`${record.instructorEmail}-${record.recordedAt}`}>
                <td>{record.instructorEmail}</td><td>{record.attendeeCount}</td><td>{record.notes ?? "-"}</td><td>{record.recordedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {session.cancelledBookings.length > 0 && (
        <>
          <p className="muted">Cancelled bookings</p>
          <BookingTable bookings={session.cancelledBookings} cancelled />
        </>
      )}
    </details>
  );
}

function AttendanceEntry({ session, onSaved }: { session: HistorySession; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(session.attendanceEstimated ? String(session.attendeeCount) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const count = Number(value);
    if (!value.trim() || !Number.isInteger(count) || count < 0 || count > 1000) {
      setError("Enter a whole number from 0 to 1000.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await fetchJson(`/api/sessions/${encodeURIComponent(session.sessionId)}/attendance-estimate`, {
        method: "PUT", body: JSON.stringify({ attendeeCount: count }),
      });
      if (result.status !== 200) {
        setError(result.status === 409 ? "Attendance was recorded. Refresh to see it." : result.status === 401 ? "Session expired. Log in again." : "Could not save attendance.");
        return;
      }
      await onSaved();
    } catch {
      setError("Could not save attendance. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="attendance-entry" onSubmit={save}>
      <span className="note">{session.attendanceEstimated ? "Estimated" : "Not recorded"}</span>
      <input type="number" min="0" max="1000" step="1" required value={value} onChange={(event) => setValue(event.target.value)} aria-label={`Estimated attendees for ${session.trainingTitle}, ${session.date} ${session.startTime}`} />
      <button type="submit" disabled={saving} title="Save attendance estimate"><Save size={14} /> {saving ? "Saving" : "Save"}</button>
      {error && <span className="history-error" role="alert">{error}</span>}
    </form>
  );
}

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Filters>({ trainingId: "", oem: "", instructor: "", from: "", to: "" });
  const reportRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const result = await fetchJson<HistoryResponse>("/api/history");
    if (result.status === 401) return setNeedsLogin(true);
    if (result.status !== 200) return setError(`Failed to load history (${result.status})`);
    setNeedsLogin(false);
    setHistory(result.body);
  };

  useEffect(() => {
    load().catch((cause: Error) => setError(cause.message));
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    const result = await fetchJson("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
    if (result.status !== 200) return setError("Invalid password");
    setPassword("");
    setError("");
    await load();
  };

  const options = useMemo(() => {
    const sessions = history?.sessions ?? [];
    const courses = new Map(sessions.map((session) => [session.trainingId, session.trainingTitle]));
    const oems = new Set(sessions.flatMap((session) => [...session.bookings, ...session.cancelledBookings].map((item) => item.oem)));
    const instructors = new Set(sessions.flatMap((session) => session.instructors));
    const dates = sessions.map((session) => session.date).sort();
    return {
      courses: Array.from(courses).sort((left, right) => left[1].localeCompare(right[1])),
      oems: Array.from(oems).sort(),
      instructors: Array.from(instructors).sort(),
      minDate: dates[0] ?? "",
      maxDate: dates.at(-1) ?? "",
    };
  }, [history]);

  const filtered = useMemo(() => {
    const sessions = (history?.sessions ?? []).filter((session) =>
      (!filters.trainingId || session.trainingId === filters.trainingId) &&
      (!filters.oem || [...session.bookings, ...session.cancelledBookings].some((item) => item.oem === filters.oem)) &&
      (!filters.instructor || session.instructors.includes(filters.instructor)) &&
      (!filters.from || session.date >= filters.from) &&
      (!filters.to || session.date <= filters.to),
    ).sort((left, right) => `${left.date} ${left.startTime}`.localeCompare(`${right.date} ${right.startTime}`));
    return { sessions, summary: summarizeTrainingHistory(sessions, history?.oemOptions ?? []) };
  }, [history, filters]);

  const filterDescription = [
    filters.trainingId && `Course: ${options.courses.find(([id]) => id === filters.trainingId)?.[1] ?? filters.trainingId}`,
    filters.oem && `OEM: ${filters.oem}`,
    filters.instructor && `Instructor: ${filters.instructor}`,
    `Dates: ${filters.from || options.minDate} to ${filters.to || options.maxDate}`,
  ].filter(Boolean).join(" | ");
  const fileStamp = new Date().toISOString().slice(0, 10);

  const saveHtml = () => {
    if (!reportRef.current) return;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Training history ${fileStamp}</title><style>${HISTORY_CSS}</style></head><body style="margin:0">${reportRef.current.outerHTML}</body></html>`;
    downloadFile(`training-history-${fileStamp}.html`, "text/html", html);
  };

  const saveJson = () => {
    const payload = { generatedAt: new Date().toISOString(), today: history?.today, filters, summary: filtered.summary, sessions: filtered.sessions };
    downloadFile(`training-history-${fileStamp}.json`, "application/json", JSON.stringify(payload, null, 2));
  };

  if (needsLogin) {
    return (
      <form className="history-login" onSubmit={login}>
        <style>{HISTORY_CSS}</style>
        <h2><LockKeyhole size={18} /> Admin login required</h2>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Scheduler password" autoFocus />
        {error && <p className="history-error">{error}</p>}
        <button className="primary-button" type="submit">Log in</button>
        <a href="/">Back to scheduler</a>
      </form>
    );
  }

  if (!history) return <p style={{ padding: 24 }}>{error || "Loading training history..."}</p>;

  const { summary, sessions } = filtered;
  const heldSessions = sessions.filter(isHeld);
  const updateFilter = (key: keyof Filters) => (event: { target: { value: string } }) => setFilters((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div>
      <style>{HISTORY_CSS}</style>
      <div className="history-toolbar">
        <a className="secondary-button" href="/"><ArrowLeft size={14} /> Scheduler</a>
        <label>Course
          <select value={filters.trainingId} onChange={updateFilter("trainingId")}>
            <option value="">All courses</option>
            {options.courses.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
          </select>
        </label>
        <label>OEM
          <select value={filters.oem} onChange={updateFilter("oem")}>
            <option value="">All OEMs</option>
            {options.oems.map((oem) => <option key={oem} value={oem}>{oem}</option>)}
          </select>
        </label>
        <label>Instructor
          <select value={filters.instructor} onChange={updateFilter("instructor")}>
            <option value="">All instructors</option>
            {options.instructors.map((email) => <option key={email} value={email}>{email}</option>)}
          </select>
        </label>
        <label>From<input type="date" value={filters.from} min={options.minDate} max={options.maxDate} onChange={updateFilter("from")} /></label>
        <label>To<input type="date" value={filters.to} min={options.minDate} max={options.maxDate} onChange={updateFilter("to")} /></label>
        <button className="secondary-button" type="button" onClick={() => setFilters({ trainingId: "", oem: "", instructor: "", from: "", to: "" })}>Reset</button>
        <a className="secondary-button" href="/training-analysis-report.html" target="_blank" rel="noopener noreferrer"><BarChart3 size={14} /> Full Analysis Report</a>
        <button className="primary-button" type="button" onClick={saveHtml}><Download size={14} /> Save HTML</button>
        <button className="primary-button" type="button" onClick={saveJson}><FileJson size={14} /> Save JSON</button>
      </div>

      <div className="history-report" ref={reportRef}>
        <h1>Training history</h1>
        <p className="meta">Finished sessions before {history.today} (Taiwan time) | {filterDescription} | Generated {new Date().toLocaleString()}</p>

        <div className="totals">
          <div className="total"><strong>{summary.totals.sessionsHeld}</strong>Sessions held</div>
          <div className="total"><strong>{summary.totals.confirmedBookings}</strong>Confirmed bookings</div>
          <div className="total"><strong>{summary.totals.attendees}</strong>Attendees</div>
          <div className="total"><strong>{ratioText(summary.totals.turnoutRatio)}</strong>Attendees / booking</div>
          <div className="total"><strong>{summary.totals.attendanceGaps}</strong>Attendance not recorded</div>
          <div className="total"><strong>{summary.totals.cancelledSessions} / {summary.totals.cancelledBookings}</strong>Cancelled sessions / bookings</div>
        </div>

        <HistoryAnalytics sessions={sessions} summary={summary} />

        <h2>Coverage by course</h2>
        {summary.courses.length === 0 && <p className="muted">No sessions match the filters.</p>}
        {summary.courses.map((course) => (
          <section key={course.trainingId}>
            <h3>{course.trainingTitle}{course.hidden && <span className="tag">Hidden</span>}</h3>
            <p className="muted">
              {course.sessionsHeld} session(s) held | {course.confirmedBookings} booking(s) | {course.attendees} attendee(s) | ratio {ratioText(course.turnoutRatio)} | cancelled {course.cancelledSessions} session(s) / {course.cancelledBookings} booking(s)
            </p>
            <table>
              <thead><tr><th>OEM</th><th>ODMs</th><th>Sessions</th><th>Bookings</th></tr></thead>
              <tbody>
                {course.oemsTrained.map((item) => (
                  <tr key={item.oem}><td>{item.oem}</td><td>{item.odms.join(", ") || "-"}</td><td>{item.sessions}</td><td>{item.bookings}</td></tr>
                ))}
              </tbody>
            </table>
            <p><strong>Never trained:</strong> {course.oemsNeverTrained.join(", ") || "None"}</p>
          </section>
        ))}

        <h2>Attendance gaps ({summary.gaps.length})</h2>
        {summary.gaps.length === 0 ? <p className="muted">Every held session has attendance recorded.</p> : (
          <table>
            <thead><tr><th>Date</th><th>Time</th><th>Course</th><th>OEMs</th><th>Instructor(s)</th></tr></thead>
            <tbody>
              {summary.gaps.map((session) => (
                <tr key={session.sessionId}>
                  <td>{session.date}</td><td>{session.startTime}</td><td>{session.trainingTitle}</td>
                  <td>{Array.from(new Set(session.bookings.map((item) => item.oem))).join(", ")}</td>
                  <td>{session.instructors.join(", ") || "Unknown"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2>Attendance by session ({heldSessions.length})</h2>
        {heldSessions.length === 0 ? <p className="muted">No sessions match the filters.</p> : (
          <table>
            <thead>
              <tr><th>Date</th><th>Time</th><th>Course</th><th>OEM</th><th>ODM</th><th>Instructor(s)</th><th>Bookings</th><th>Attendees</th><th>Attendees / booking</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {heldSessions.map((session) => (
                <tr key={session.sessionId}>
                  <td>{session.date}</td>
                  <td>{session.startTime}</td>
                  <td>{session.trainingTitle}{session.hidden && <span className="tag">Hidden</span>}</td>
                  <td>{Array.from(new Set(session.bookings.map((item) => item.oem))).join(", ") || "-"}</td>
                  <td>{Array.from(new Set(session.bookings.map((item) => item.odm ?? "NA"))).join(", ") || "-"}</td>
                  <td>{session.instructors.join(", ") || "Unknown"}</td>
                  <td>{session.bookings.length}</td>
                  <td>{session.attendanceRecorded && !session.attendanceEstimated ? session.attendeeCount : <AttendanceEntry session={session} onSaved={load} />}</td>
                  <td>{ratioText(session.turnoutRatio)}</td>
                  <td>{[...session.notes, ...session.attendance.flatMap((record) => (record.notes ? [record.notes] : []))].join("; ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2>Session log ({sessions.filter((session) => session.status === "active").length})</h2>
        {sessions.filter((session) => session.status === "active").map((session) => <SessionDetails key={session.sessionId} session={session} />)}

        <details>
          <summary>Cancelled sessions ({sessions.filter((session) => session.status === "cancelled").length})</summary>
          {sessions.filter((session) => session.status === "cancelled").map((session) => <SessionDetails key={session.sessionId} session={session} />)}
        </details>
      </div>
    </div>
  );
}
