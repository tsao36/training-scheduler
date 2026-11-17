"""Generate the single-file interactive HTML training analysis report from data/scheduler.yaml."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "scheduler.yaml"
TEMPLATE_FILE = ROOT / ".agents" / "skills" / "data-analysis-skills" / "assets" / "report_template.html"
OUTPUT_FILE = ROOT / "public" / "training-analysis-report.html"


def to_native(obj):
    if isinstance(obj, dict):
        return {k: to_native(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_native(v) for v in obj]
    if isinstance(obj, np.generic):
        return obj.item()
    return obj


def is_system_block(booking: dict) -> bool:
    return (
        booking.get("requesterEmail") == "scheduler-block@local"
        or booking.get("requesterName") == "System Block"
        or booking.get("oem") == "Not available"
    )


def main() -> None:
    with DATA_FILE.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    today = datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y-%m-%d")
    trainings = {t["id"]: t for t in data.get("trainings", [])}
    sessions = data.get("sessions", [])
    bookings = data.get("bookings", [])
    attendance = data.get("attendance", [])

    real_bookings = [b for b in bookings if not is_system_block(b)]
    system_block_count = len(bookings) - len(real_bookings)

    session_rows = []
    for s in sessions:
        if s["date"] >= today:
            continue
        sb = [b for b in real_bookings if b["sessionId"] == s["id"]]
        conf = [b for b in sb if b["status"] == "confirmed"]
        canc = [b for b in sb if b["status"] == "cancelled"]
        att = [a for a in attendance if a["sessionId"] == s["id"]]
        est = len(att) == 0 and s.get("estimatedAttendeeCount") is not None
        att_count = s.get("estimatedAttendeeCount", 0) if est else sum(a["attendeeCount"] for a in att)
        att_rec = len(att) > 0 or est
        if not conf and not canc and not att_rec:
            continue

        tid = s["trainingId"]
        custom_tids = [b.get("trainingId") for b in conf if b.get("trainingId")]
        if custom_tids:
            tid = custom_tids[0]

        is_held = s["status"] == "active" and (len(conf) > 0 or att_rec)
        is_gap = s["status"] == "active" and len(conf) > 0 and not att_rec
        session_rows.append(
            {
                "sessionId": s["id"],
                "date": s["date"],
                "startTime": s["startTime"],
                "trainingId": tid,
                "trainingTitle": trainings.get(tid, {}).get("title", tid),
                "status": s["status"],
                "confirmed": len(conf),
                "cancelled": len(canc),
                "attendeeCount": att_count,
                "attendanceRecorded": att_rec,
                "attendanceEstimated": est,
                "isHeld": is_held,
                "isGap": is_gap,
            }
        )

    df = pd.DataFrame(session_rows)
    held = df[df["isHeld"]].copy()
    held["week"] = pd.to_datetime(held["date"]).dt.to_period("W").apply(lambda p: p.start_time.strftime("%Y-%m-%d"))

    total_held = int(len(held))
    total_confirmed = int(held["confirmed"].sum())
    total_cancelled_bookings = int(df["cancelled"].sum())
    total_cancelled_sessions = int((df["status"] == "cancelled").sum())
    total_attendees = int(held["attendeeCount"].sum())
    total_gaps = int(held["isGap"].sum())
    recorded_sessions = held[held["attendanceRecorded"]]
    recorded_count = int(len(recorded_sessions))
    gap_pct = (total_gaps / total_held * 100) if total_held else 0.0
    overall_turnout = (total_attendees / total_confirmed) if total_confirmed else 0.0
    recorded_turnout = (
        total_attendees / int(recorded_sessions["confirmed"].sum())
        if len(recorded_sessions) and recorded_sessions["confirmed"].sum() > 0
        else 0.0
    )
    total_requests = total_confirmed + total_cancelled_bookings
    cancel_rate = (total_cancelled_bookings / total_requests * 100) if total_requests else 0.0

    # Course breakdown
    by_course = (
        df.groupby(["trainingId", "trainingTitle"], as_index=False)
        .agg(
            sessions_held=("isHeld", "sum"),
            recorded=("attendanceRecorded", "sum"),
            gaps=("isGap", "sum"),
            confirmed=("confirmed", "sum"),
            cancelled=("cancelled", "sum"),
            attendees=("attendeeCount", "sum"),
        )
        .sort_values(["sessions_held", "confirmed"], ascending=[False, False])
    )
    by_course["cancel_rate"] = np.where(
        (by_course["confirmed"] + by_course["cancelled"]) > 0,
        by_course["cancelled"] / (by_course["confirmed"] + by_course["cancelled"]) * 100,
        0.0,
    )

    # Weekly breakdown
    by_week = (
        held.groupby("week", as_index=False)
        .agg(
            sessions=("sessionId", "count"),
            recorded=("attendanceRecorded", "sum"),
            gaps=("isGap", "sum"),
            attendees=("attendeeCount", "sum"),
        )
        .sort_values("week")
    )

    # OEM breakdown from confirmed real bookings
    conf_bookings = pd.DataFrame([b for b in real_bookings if b["status"] == "confirmed"])
    oem_counts = conf_bookings["oem"].value_counts().reset_index()
    oem_counts.columns = ["oem", "bookings"]
    oem_counts = oem_counts.sort_values(["bookings", "oem"], ascending=[True, False])

    format_counts = conf_bookings["trainingFormat"].fillna("unspecified").value_counts().to_dict()
    with_video_n = int(format_counts.get("with-video", 0))
    without_video_n = int(format_counts.get("without-video", 0))

    toolbox = {"feature": {"saveAsImage": {}, "dataView": {"readOnly": True}}}

    course_chart_option = {
        "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
        "legend": {"top": 0},
        "toolbox": toolbox,
        "grid": {"left": "3%", "right": "4%", "bottom": "4%", "containLabel": True},
        "xAxis": {"type": "category", "data": by_course["trainingTitle"].tolist(), "axisLabel": {"interval": 0, "rotate": 18}},
        "yAxis": {"type": "value", "name": "Held sessions"},
        "series": [
            {
                "name": "Attendance recorded",
                "type": "bar",
                "stack": "held",
                "itemStyle": {"color": "#006ba6"},
                "data": [int(v) for v in by_course["recorded"].tolist()],
            },
            {
                "name": "Attendance missing",
                "type": "bar",
                "stack": "held",
                "itemStyle": {"color": "#e3120b"},
                "data": [int(v) for v in by_course["gaps"].tolist()],
            },
        ],
    }

    weekly_chart_option = {
        "tooltip": {"trigger": "axis"},
        "legend": {"top": 0},
        "toolbox": toolbox,
        "dataZoom": [{"type": "inside"}, {"type": "slider"}],
        "grid": {"left": "3%", "right": "4%", "bottom": 56, "containLabel": True},
        "xAxis": {"type": "category", "data": by_week["week"].tolist()},
        "yAxis": {"type": "value", "name": "Held sessions"},
        "series": [
            {
                "name": "Total held sessions",
                "type": "line",
                "itemStyle": {"color": "#006ba6"},
                "data": [int(v) for v in by_week["sessions"].tolist()],
            },
            {
                "name": "Sessions with attendance recorded",
                "type": "line",
                "itemStyle": {"color": "#1b7837"},
                "data": [int(v) for v in by_week["recorded"].tolist()],
            },
        ],
    }

    top_oems = {"Dell", "MSFT Surface", "Fujitsu", "Asus"}
    oem_chart_option = {
        "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
        "legend": {"show": False},
        "toolbox": toolbox,
        "grid": {"left": "3%", "right": "6%", "bottom": "4%", "containLabel": True},
        "xAxis": {"type": "value", "name": "Confirmed bookings"},
        "yAxis": {"type": "category", "data": oem_counts["oem"].tolist()},
        "series": [
            {
                "name": "Confirmed bookings",
                "type": "bar",
                "data": [
                    {
                        "value": int(row["bookings"]),
                        "itemStyle": {"color": "#006ba6" if row["oem"] in top_oems else "#b5b5b5"},
                    }
                    for _, row in oem_counts.iterrows()
                ],
            }
        ],
    }

    cancel_chart_option = {
        "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
        "legend": {"top": 0},
        "toolbox": toolbox,
        "grid": {"left": "3%", "right": "4%", "bottom": "4%", "containLabel": True},
        "xAxis": {"type": "category", "data": by_course["trainingTitle"].tolist(), "axisLabel": {"interval": 0, "rotate": 18}},
        "yAxis": {"type": "value", "name": "Booking requests"},
        "series": [
            {
                "name": "Confirmed",
                "type": "bar",
                "itemStyle": {"color": "#006ba6"},
                "data": [int(v) for v in by_course["confirmed"].tolist()],
            },
            {
                "name": "Cancelled",
                "type": "bar",
                "itemStyle": {"color": "#e3120b"},
                "data": [int(v) for v in by_course["cancelled"].tolist()],
            },
        ],
    }

    format_chart_option = {
        "tooltip": {"trigger": "item", "formatter": "{b}: {c} ({d}%)"},
        "legend": {"bottom": 0},
        "toolbox": toolbox,
        "series": [
            {
                "name": "Delivery Format",
                "type": "pie",
                "radius": ["42%", "68%"],
                "label": {"formatter": "{b}: {c} ({d}%)"},
                "data": [
                    {"name": "With video", "value": with_video_n, "itemStyle": {"color": "#006ba6"}},
                    {"name": "Live, no video", "value": without_video_n, "itemStyle": {"color": "#b5b5b5"}},
                ],
            }
        ],
    }

    course_table_rows = [
        [
            row["trainingTitle"],
            f"{int(row['sessions_held'])}",
            f"{int(row['recorded'])}",
            f"{int(row['gaps'])}",
            f"{int(row['confirmed'])}",
            f"{int(row['cancelled'])}",
            f"{row['cancel_rate']:.1f}%",
            f"{int(row['attendees'])}",
        ]
        for _, row in by_course.iterrows()
    ]

    report_data = {
        "meta": {
            "title": "Technical Training Operations & Attendance Analysis",
            "subtitle": f"Executive summary of {total_held} held sessions (2026-09-14 to 2026-10-30, evaluated before {today})",
            "date": today,
            "industry_label": "Education / Technical Training",
            "audience": "Management & Operations Stakeholders",
            "lang": "en",
        },
        "key_findings": [
            {
                "headline": f"**{gap_pct:.1f}%** of held sessions (**{total_gaps} of {total_held}**) are missing attendance records",
                "detail": (
                    f"Only {recorded_count} sessions have recorded attendance (totaling **{total_attendees} attendees**), "
                    f"while 4 of 6 active courses and all 9 sessions held after 2026-10-04 have zero attendance logged. "
                    f"This pulls the overall turnout ratio down to **{overall_turnout:.2f}**, compared with **{recorded_turnout:.2f}** "
                    "among sessions that actually have attendance data."
                ),
                "type": "negative",
            },
            {
                "headline": f"Demand is concentrated in 2 courses (**64.1%** of bookings) and 1 peak week (**52.6%** of sessions)",
                "detail": (
                    "WiFi 8: Top 5 Features (13 bookings) and BT HDT (12 bookings) account for **25 of 39** confirmed bookings "
                    "and **100%** of recorded attendees. Over half of held sessions (**20 of 38**) took place in the week of 2026-09-28."
                ),
                "type": "positive",
            },
            {
                "headline": f"**{cancel_rate:.1f}%** of real booking requests were cancelled (**{total_cancelled_bookings} of {total_requests}**)",
                "detail": (
                    "Cancellation rates are elevated across high-volume courses (BT HDT 47.8%, BT Log Capture 45.5%, WiFi 8 43.5%). "
                    "Because cancellation reasons are not captured in the data, root causes cannot be inferred."
                ),
                "type": "warning",
            },
            {
                "headline": f"With-video sessions represent **{with_video_n / total_confirmed * 100:.1f}%** of confirmed bookings, but turnout comparison is blocked",
                "detail": (
                    f"Confirmed bookings split **{with_video_n} with-video** vs. **{without_video_n} live without video**. "
                    "All 10 sessions with recorded attendance were with-video, so turnout differences by format cannot be tested until live-no-video attendance is filled in."
                ),
                "type": "neutral",
            },
        ],
        "background": {
            "narrative": (
                "This analysis evaluates historical training operations from **data/scheduler.yaml** to give management and "
                "operations stakeholders a clear view of course demand, OEM participation, booking cancellations, and attendance "
                "reporting completeness.\n\n"
                "Because the Training history page now allows public attendance entry for past sessions without instructor logs, "
                "identifying where attendance gaps sit is immediately actionable."
            ),
            "objectives": [
                "Quantify attendance reporting gaps by course and week to prioritize backfill.",
                "Measure course demand concentration, OEM/ODM reach, and delivery format mix.",
                "Evaluate booking cancellation rates across courses without over-interpreting missing fields.",
            ],
        },
        "data_overview": {
            "narrative": (
                f"The dataset contains **{len(sessions)}** scheduled slots from **2026-09-14 to 2026-10-30**, "
                f"**{len(bookings)}** raw booking records, and **{len(attendance)}** instructor attendance logs. "
                f"After excluding **{system_block_count}** system availability blocks and unused empty slots, "
                f"**{len(df)}** historical sessions had real booking or attendance activity (**{total_held}** held, **{total_cancelled_sessions}** cancelled)."
            ),
            "stats": [
                {"label": "Held Sessions", "value": f"{total_held}", "note": f"{recorded_count} recorded / {total_gaps} missing"},
                {"label": "Confirmed Bookings", "value": f"{total_confirmed}", "note": f"{total_cancelled_bookings} cancelled ({cancel_rate:.1f}%)"},
                {"label": "Recorded Attendees", "value": f"{total_attendees}", "note": f"{recorded_turnout:.1f} avg on recorded sessions"},
                {"label": "Participating OEMs", "value": f"{len(oem_counts)}", "note": "Top 4 = 56.4% of bookings"},
            ],
            "quality_summary": (
                "Data completeness is high for bookings and OEM/ODM metadata, but **73.7% of held sessions lack attendance counts**. "
                "Fields required for financial/retention KPIs (tuition, revenue, learner scores, repeat-renewal tracking, and cancellation reasons) "
                "do not exist in scheduler.yaml and are excluded rather than estimated."
            ),
        },
        "sections": [
            {
                "id": "course-coverage",
                "title": "Course Demand & Attendance Reporting Coverage",
                "narrative": (
                    "Training activity is heavily concentrated in two flagship courses: **WiFi 8: Top 5 Features** and **BT HDT**. "
                    "Meanwhile, four courses (**WiFi Log Capture**, **BT Log Capture**, **BIOS SAR**, and **Killer Training**) "
                    "have zero recorded attendance across all 13 of their held sessions."
                ),
                "charts": [
                    {
                        "id": "chart-course-coverage",
                        "title": "Held Sessions by Course: Recorded vs. Missing Attendance",
                        "question": "Which courses account for the most held sessions and the largest attendance reporting gaps?",
                        "option": course_chart_option,
                        "insight": (
                            f"WiFi 8 ({int(by_course.iloc[0]['sessions_held'])} sessions) and BT HDT ({int(by_course.iloc[1]['sessions_held'])} sessions) "
                            "lead volume, yet even they are missing attendance for more than half of their sessions (8/13 and 7/12). "
                            "Backfilling WiFi Log Capture (6 gaps) and BT Log Capture (5 gaps) would eliminate **39.3%** of all missing records."
                        ),
                        "height": "360px",
                    }
                ],
                "tables": [
                    {
                        "title": "Course Performance & Attendance Summary",
                        "columns": ["Course", "Held", "Recorded", "Missing", "Confirmed", "Cancelled", "Cancel Rate", "Attendees"],
                        "rows": course_table_rows,
                    }
                ],
            },
            {
                "id": "weekly-trend",
                "title": "Weekly Activity & Post-October Reporting Drop-off",
                "narrative": (
                    "Session volume peaked sharply in the week of **2026-09-28** (**20 held sessions**, **52.6%** of the entire program) "
                    "before tapering off in October. Because only 6 weekly buckets exist, formal time-series forecasting is omitted "
                    "due to insufficient sample length."
                ),
                "charts": [
                    {
                        "id": "chart-weekly-trend",
                        "title": "Weekly Held Sessions vs. Attendance-Recorded Sessions",
                        "question": "How did training volume and attendance logging evolve week by week?",
                        "option": weekly_chart_option,
                        "insight": (
                            "Attendance logging stopped completely after **2026-10-04**: all **9 held sessions** in October weeks "
                            "(Oct 5, Oct 12, Oct 26) have zero recorded attendance. Prioritizing October sessions is the fastest way "
                            "to restore recent reporting completeness."
                        ),
                        "height": "340px",
                    }
                ],
                "tables": [],
            },
            {
                "id": "oem-structure",
                "title": "OEM Participation Structure",
                "narrative": (
                    "Thirteen OEMs booked confirmed sessions. Demand is moderately concentrated: the top 4 OEMs (**Dell**, **MSFT Surface**, "
                    "**Fujitsu**, and **Asus**) represent **56.4%** (**22 of 39**) of all confirmed bookings."
                ),
                "charts": [
                    {
                        "id": "chart-oem-bookings",
                        "title": "Confirmed Bookings by OEM (Top 4 Highlighted)",
                        "question": "Which OEM partners account for the majority of confirmed training bookings?",
                        "option": oem_chart_option,
                        "insight": (
                            "**Dell** leads with **8 confirmed bookings** (and **108 of 218** recorded attendees across just 2 logged sessions), "
                            "followed by **MSFT Surface (6)**, **Fujitsu (4)**, and **Asus (4)**. Nine other OEMs have 1–2 bookings each."
                        ),
                        "height": "380px",
                    }
                ],
                "tables": [],
            },
            {
                "id": "cancellations-format",
                "title": "Booking Cancellations & Delivery Format Mix",
                "narrative": (
                    "Across all courses, **30 of 69** real booking requests were cancelled (**43.5%**). "
                    "For confirmed sessions, **69.2%** selected **With video** delivery and **30.8%** selected **Live, no video**."
                ),
                "charts": [
                    {
                        "id": "chart-cancellations",
                        "title": "Confirmed vs. Cancelled Booking Requests by Course",
                        "question": "How do booking confirmations and cancellations compare across courses?",
                        "option": cancel_chart_option,
                        "insight": (
                            "Cancellation volume is highest in **BT HDT** (11 cancelled vs. 12 confirmed) and **WiFi 8** (10 cancelled vs. 13 confirmed). "
                            "Small-sample courses such as Killer Training (2 cancelled, 1 confirmed) should not be over-interpreted due to n=3."
                        ),
                        "height": "340px",
                    },
                    {
                        "id": "chart-format-mix",
                        "title": "Confirmed Bookings by Delivery Format",
                        "question": "What share of confirmed bookings requested video vs. live-only delivery?",
                        "option": format_chart_option,
                        "insight": (
                            "Over two-thirds (**69.2%**) of confirmed bookings included video. Because zero `Live, no video` sessions have "
                            "recorded attendance, turnout differences between formats cannot yet be measured."
                        ),
                        "height": "300px",
                    },
                ],
                "tables": [],
            },
        ],
        "conclusions": {
            "narrative": (
                "The training program achieved strong engagement in its flagship **WiFi 8** and **BT HDT** courses and reached **13 OEMs**, "
                "but **73.7% missing attendance data** currently obscures true total reach. Closing the October and Log Capture attendance "
                "gaps via the public Training history page is the highest-leverage next step."
            ),
            "recommendations": [
                {
                    "title": "Backfill the 28 missing attendance counts via the public Training history page",
                    "detail": "Start with the 9 post-Oct 4 sessions and the 11 WiFi/BT Log Capture sessions so turnout metrics reflect actual participation.",
                    "priority": "高",
                },
                {
                    "title": "Capture attendance on Live, no video sessions",
                    "detail": "All 12 live-no-video bookings currently lack attendance records; logging them will enable valid format comparisons.",
                    "priority": "中",
                },
                {
                    "title": "Add an optional cancellation reason field if reducing cancellations becomes a goal",
                    "detail": "Current data records timestamps but not causes; collecting a lightweight reason tag will make the 43.5% cancellation rate actionable.",
                    "priority": "低",
                },
            ],
        },
        "appendix": {
            "processing_notes": [
                f"Source: data/scheduler.yaml evaluated against Asia/Taipei date {today} (matching server/training-history.ts).",
                f"Excluded {system_block_count} system availability block bookings (scheduler-block@local / System Block / Not available).",
                "Filtered out empty/unbooked slots; retained 54 historical sessions with confirmed bookings, cancelled bookings, or recorded attendance.",
                "Applied resolveDisplayTrainingId logic so custom-topic bookings reflect their booked training title.",
                "No external industry benchmarks were used; all comparisons are strictly internal.",
            ],
            "methods_notes": [
                "Turnout ratio = total attendees / confirmed bookings (missing attendance counts as 0 in overall totals, and is also reported separately for the 10 recorded sessions).",
                "Education/Training KPIs not available in this dataset (revenue, tuition, learner scores, repeat-renewal cohorts, CAC) were omitted rather than fabricated.",
                "Time-series forecasting was omitted because only 6 weekly observations exist (minimum threshold for seasonal modeling is not met).",
                "No causal claims are made for cancellations or weekly spikes because confounding factors and cancellation reasons are not recorded.",
            ],
        },
    }

    template = TEMPLATE_FILE.read_text(encoding="utf-8")
    payload = json.dumps(to_native(report_data), ensure_ascii=False)
    if "__REPORT_DATA_JSON__" not in template:
        raise RuntimeError("Placeholder __REPORT_DATA_JSON__ not found in template")

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(template.replace("__REPORT_DATA_JSON__", payload), encoding="utf-8")
    print(f"Wrote {OUTPUT_FILE} ({OUTPUT_FILE.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
