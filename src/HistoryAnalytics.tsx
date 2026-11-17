import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { isHeld, type HistorySession, type TrainingHistorySummary } from "../server/training-history-summary.ts";

type Finding = {
  type: "negative" | "warning" | "positive" | "neutral";
  headline: string;
  detail: string;
};

type ChartCardProps = {
  title: string;
  question: string;
  insight: string;
  option: EChartsOption;
  height?: number;
};

function EChartCard({ title, question, insight, option, height = 300 }: ChartCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el);
    chart.setOption(option, true);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [option]);

  return (
    <div className="analytics-card">
      <div className="analytics-card-head">
        <h3>{title}</h3>
        <p className="analytics-question">{question}</p>
      </div>
      <div ref={containerRef} style={{ width: "100%", height }} />
      <p className="analytics-insight">{insight}</p>
    </div>
  );
}

const TOOLBOX = { feature: { saveAsImage: {}, dataView: { readOnly: true } } };

const weekStart = (dateStr: string) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
};

export function HistoryAnalytics({
  sessions,
  summary,
}: {
  sessions: HistorySession[];
  summary: TrainingHistorySummary;
}) {
  const heldSessions = useMemo(() => sessions.filter(isHeld), [sessions]);

  const metrics = useMemo(() => {
    const totalHeld = heldSessions.length;
    const recordedSessions = heldSessions.filter((s) => s.attendanceRecorded);
    const recordedCount = recordedSessions.length;
    const gapCount = summary.totals.attendanceGaps;
    const gapPct = totalHeld > 0 ? (gapCount / totalHeld) * 100 : 0;

    const totalConfirmed = summary.totals.confirmedBookings;
    const totalCancelled = summary.totals.cancelledBookings;
    const totalRequests = totalConfirmed + totalCancelled;
    const cancelRate = totalRequests > 0 ? (totalCancelled / totalRequests) * 100 : 0;

    const recordedBookings = recordedSessions.reduce((acc, s) => acc + s.bookings.length, 0);
    const recordedAttendees = recordedSessions.reduce((acc, s) => acc + s.attendeeCount, 0);
    const recordedTurnout = recordedBookings > 0 ? recordedAttendees / recordedBookings : null;

    // Course breakdown
    const byCourse = new Map<
      string,
      { title: string; held: number; recorded: number; gaps: number; confirmed: number; cancelled: number }
    >();
    for (const s of sessions) {
      const entry = byCourse.get(s.trainingId) ?? {
        title: s.trainingTitle,
        held: 0,
        recorded: 0,
        gaps: 0,
        confirmed: 0,
        cancelled: 0,
      };
      if (isHeld(s)) {
        entry.held += 1;
        if (s.attendanceRecorded) entry.recorded += 1;
        else if (s.bookings.length > 0) entry.gaps += 1;
        entry.confirmed += s.bookings.length;
      }
      entry.cancelled += s.cancelledBookings.length;
      byCourse.set(s.trainingId, entry);
    }
    const courses = Array.from(byCourse.values()).sort((a, b) => b.held - a.held || b.confirmed - a.confirmed);

    // Weekly breakdown
    const byWeek = new Map<string, { held: number; recorded: number }>();
    for (const s of heldSessions) {
      const wk = weekStart(s.date);
      const entry = byWeek.get(wk) ?? { held: 0, recorded: 0 };
      entry.held += 1;
      if (s.attendanceRecorded) entry.recorded += 1;
      byWeek.set(wk, entry);
    }
    const weeks = Array.from(byWeek.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    // OEM breakdown
    const byOem = new Map<string, number>();
    let withVideo = 0;
    let withoutVideo = 0;
    let recordedWithoutVideo = 0;
    for (const s of heldSessions) {
      for (const b of s.bookings) {
        byOem.set(b.oem, (byOem.get(b.oem) ?? 0) + 1);
        if (b.trainingFormat === "with-video") withVideo += 1;
        else if (b.trainingFormat === "without-video") {
          withoutVideo += 1;
          if (s.attendanceRecorded) recordedWithoutVideo += 1;
        }
      }
    }
    const oems = Array.from(byOem.entries()).sort((a, b) => a[1] - b[1] || b[0].localeCompare(a[0]));
    const top4Oems = new Set(
      Array.from(byOem.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([oem]) => oem),
    );
    const top4Bookings = oems.filter(([oem]) => top4Oems.has(oem)).reduce((acc, [, n]) => acc + n, 0);

    return {
      totalHeld,
      recordedCount,
      gapCount,
      gapPct,
      totalConfirmed,
      totalCancelled,
      totalRequests,
      cancelRate,
      recordedAttendees,
      recordedTurnout,
      courses,
      weeks,
      oems,
      top4Oems,
      top4Bookings,
      withVideo,
      withoutVideo,
      recordedWithoutVideo,
    };
  }, [sessions, heldSessions, summary]);

  const findings = useMemo<Finding[]>(() => {
    if (metrics.totalHeld === 0) {
      return [
        {
          type: "neutral",
          headline: "No held sessions match the current filters",
          detail: "Widen the date range or reset filters to view executive findings and charts.",
        },
      ];
    }
    const top2 = metrics.courses.slice(0, 2);
    const top2Bookings = top2.reduce((acc, c) => acc + c.confirmed, 0);
    const top2Share = metrics.totalConfirmed > 0 ? (top2Bookings / metrics.totalConfirmed) * 100 : 0;
    const zeroRecordCourses = metrics.courses.filter((c) => c.held > 0 && c.recorded === 0).length;
    const peakWeek = metrics.weeks.reduce<{ week: string; held: number } | null>(
      (best, [wk, val]) => (!best || val.held > best.held ? { week: wk, held: val.held } : best),
      null,
    );
    const videoShare = metrics.totalConfirmed > 0 ? (metrics.withVideo / metrics.totalConfirmed) * 100 : 0;

    return [
      {
        type: metrics.gapPct >= 50 ? "negative" : metrics.gapPct > 0 ? "warning" : "positive",
        headline: `${metrics.gapPct.toFixed(1)}% of held sessions (${metrics.gapCount} of ${metrics.totalHeld}) lack attendance`,
        detail: `${metrics.recordedCount} sessions have recorded attendance (${metrics.recordedAttendees} attendees; ${
          metrics.recordedTurnout !== null ? `${metrics.recordedTurnout.toFixed(1)} avg/booking` : "n/a"
        }), while ${zeroRecordCourses} course(s) have 0% attendance logged. Overall turnout (${
          summary.totals.turnoutRatio !== null ? summary.totals.turnoutRatio.toFixed(2) : "n/a"
        }) is understated until gaps are filled.`,
      },
      {
        type: "positive",
        headline: `Top 2 courses drive ${top2Share.toFixed(1)}% of confirmed bookings (${top2Bookings} of ${metrics.totalConfirmed})`,
        detail: `${top2.map((c) => `${c.title} (${c.confirmed})`).join(" and ")} lead demand.${
          peakWeek
            ? ` Activity peaked in the week of ${peakWeek.week} with ${peakWeek.held} held sessions (${((peakWeek.held / metrics.totalHeld) * 100).toFixed(1)}%).`
            : ""
        }`,
      },
      {
        type: metrics.cancelRate >= 30 ? "warning" : "neutral",
        headline: `${metrics.cancelRate.toFixed(1)}% of booking requests were cancelled (${metrics.totalCancelled} of ${metrics.totalRequests})`,
        detail:
          "Cancellation reasons are not captured in scheduler data, so root causes cannot be inferred from timestamps alone.",
      },
      {
        type: "neutral",
        headline: `With-video accounts for ${videoShare.toFixed(1)}% of confirmed bookings (${metrics.withVideo} vs. ${metrics.withoutVideo} live-only)`,
        detail:
          metrics.recordedWithoutVideo === 0 && metrics.withoutVideo > 0
            ? "Zero live-without-video sessions have recorded attendance, so turnout cannot yet be compared across delivery formats."
            : `${metrics.recordedWithoutVideo} live-without-video session(s) have recorded attendance.`,
      },
    ];
  }, [metrics, summary.totals.turnoutRatio]);

  const courseOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 0 },
      toolbox: TOOLBOX,
      grid: { left: "3%", right: "4%", bottom: "4%", containLabel: true },
      xAxis: {
        type: "category",
        data: metrics.courses.map((c) => c.title),
        axisLabel: { interval: 0, rotate: 16 },
      },
      yAxis: { type: "value", name: "Held sessions" },
      series: [
        {
          name: "Attendance recorded",
          type: "bar",
          stack: "held",
          barMaxWidth: 28,
          itemStyle: { color: "#006ba6" },
          data: metrics.courses.map((c) => c.recorded),
        },
        {
          name: "Attendance missing",
          type: "bar",
          stack: "held",
          barMaxWidth: 28,
          itemStyle: { color: "#e3120b" },
          data: metrics.courses.map((c) => c.gaps),
        },
      ],
    }),
    [metrics.courses],
  );

  const weeklyOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: "axis" },
      legend: { top: 0 },
      toolbox: TOOLBOX,
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 8 }],
      grid: { left: "3%", right: "4%", bottom: 48, containLabel: true },
      xAxis: { type: "category", data: metrics.weeks.map(([wk]) => wk) },
      yAxis: { type: "value", name: "Held sessions" },
      series: [
        {
          name: "Held sessions",
          type: "line",
          itemStyle: { color: "#006ba6" },
          data: metrics.weeks.map(([, val]) => val.held),
        },
        {
          name: "Attendance recorded",
          type: "line",
          itemStyle: { color: "#1b7837" },
          data: metrics.weeks.map(([, val]) => val.recorded),
        },
      ],
    }),
    [metrics.weeks],
  );

  const oemOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { show: false },
      toolbox: TOOLBOX,
      grid: { left: "3%", right: "6%", bottom: "4%", containLabel: true },
      xAxis: { type: "value", name: "Confirmed bookings" },
      yAxis: { type: "category", data: metrics.oems.map(([oem]) => oem) },
      series: [
        {
          name: "Confirmed bookings",
          type: "bar",
          barMaxWidth: 22,
          data: metrics.oems.map(([oem, count]) => ({
            value: count,
            itemStyle: { color: metrics.top4Oems.has(oem) ? "#006ba6" : "#b5b5b5" },
          })),
        },
      ],
    }),
    [metrics.oems, metrics.top4Oems],
  );

  const cancelOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 0 },
      toolbox: TOOLBOX,
      grid: { left: "3%", right: "4%", bottom: "4%", containLabel: true },
      xAxis: {
        type: "category",
        data: metrics.courses.map((c) => c.title),
        axisLabel: { interval: 0, rotate: 16 },
      },
      yAxis: { type: "value", name: "Booking requests" },
      series: [
        {
          name: "Confirmed",
          type: "bar",
          barMaxWidth: 24,
          itemStyle: { color: "#006ba6" },
          data: metrics.courses.map((c) => c.confirmed),
        },
        {
          name: "Cancelled",
          type: "bar",
          barMaxWidth: 24,
          itemStyle: { color: "#e3120b" },
          data: metrics.courses.map((c) => c.cancelled),
        },
      ],
    }),
    [metrics.courses],
  );

  if (heldSessions.length === 0 && sessions.length === 0) {
    return null;
  }

  return (
    <section className="analytics-section" aria-label="Executive Analysis">
      <div className="analytics-header">
        <h2>Executive Analysis &amp; Insights</h2>
        <span className="muted">
          Live view of {metrics.totalHeld} held session(s) · Education / Technical Training perspective
        </span>
      </div>

      <div className="findings-grid">
        {findings.map((item) => (
          <article key={item.headline} className={`finding-card finding-${item.type}`}>
            <h3>{item.headline}</h3>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>

      {metrics.totalHeld > 0 && (
        <div className="analytics-grid">
          <EChartCard
            title="Course Coverage & Attendance Gaps"
            question="Which courses have the most held sessions and missing attendance records?"
            option={courseOption}
            insight={`${metrics.gapCount} of ${metrics.totalHeld} held sessions still need attendance counts. Filling gaps on high-volume courses and Log Capture sessions will give an accurate turnout baseline.`}
          />
          <EChartCard
            title="Weekly Training Volume & Attendance Logging"
            question="How did held sessions and attendance recording trend over time?"
            option={weeklyOption}
            insight="Weekly session counts are too short (6 weeks) for forecasting; focus on backfilling the post-Oct 4 sessions where recorded attendance drops to zero."
          />
          <EChartCard
            title="Confirmed Bookings by OEM"
            question="Which OEM partners account for the majority of confirmed bookings?"
            option={oemOption}
            height={Math.max(260, metrics.oems.length * 26 + 60)}
            insight={`The top ${Math.min(4, metrics.oems.length)} OEM(s) represent ${metrics.top4Bookings} of ${metrics.totalConfirmed} confirmed bookings (${
              metrics.totalConfirmed > 0 ? ((metrics.top4Bookings / metrics.totalConfirmed) * 100).toFixed(1) : "0.0"
            }%).`}
          />
          <EChartCard
            title="Confirmed vs. Cancelled Bookings by Course"
            question="How do booking confirmations and cancellations compare across courses?"
            option={cancelOption}
            insight={`Overall cancellation rate is ${metrics.cancelRate.toFixed(1)}% (${metrics.totalCancelled}/${metrics.totalRequests}). Small-sample courses (n <= 3) should not be over-interpreted.`}
          />
        </div>
      )}
    </section>
  );
}
