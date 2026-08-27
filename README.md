# Training Desk

Internal training scheduler with a React UI and an Express API backed by YAML.

## Development

Install dependencies:

```powershell
npm install
```

Run the API with the design-stage password and local YAML file:

```powershell
$env:SCHEDULER_PASSWORD = "123"
$env:DATA_FILE = "$PWD\data\scheduler.yaml"
npm run dev:server
```

In another terminal, run the Vite UI:

```powershell
npm run dev
```

The Vite server proxies `/api` to the Express API on port 3001.

## Production

Build the React UI and API:

```powershell
npm run build
```

Run the single Express service. It serves `dist` and the API:

```powershell
$env:NODE_ENV = "production"
$env:SCHEDULER_PASSWORD = "replace-with-a-long-random-password"
$env:DATA_FILE = "C:\var\lib\training-scheduler\scheduler.yaml"
$env:SMTP_HOST = "smtpauth.intel.com"
$env:SMTP_PORT = 587
$env:SMTP_USER = "your-email@company.com"  # Optional if no auth required
$env:SMTP_PASS = "your-password"           # Optional if no auth required
$env:SMTP_FROM = "noreply@company.com"    # Sender email address
npm start
```

The data file must already exist, its directory must be writable, and it must contain valid YAML. The server refuses to start when `DATA_FILE` or `SCHEDULER_PASSWORD` is missing. Keep the YAML outside the public `dist` directory.

For booking notification email to work, SMTP credentials must be configured. If not set, the server will attempt to send emails without authentication.

The server creates automatic backups in a `scheduler-backups` directory beside the YAML file every day at `11:00` and `20:00` Pacific Time. Only the latest 8 backup files are retained. Persist both the YAML directory and its backup directory when running in a container.

## User Guide (Latest)

### Public view

- The calendar only shows booked sessions on the timeline.
- Empty half-hour cells are still clickable for booking. Clicking an empty slot opens booking for the underlying available session.
- Hovering a booked slot shows details in tooltip, including topic, instructor, delivery type, OEM, and ODM.
- Shared slots remain bookable. A slot with existing booking(s) is shown as shared, not full.
- "My bookings" lets users search with requester email and cancel with the same email confirmation.

### Booking behavior

- Booking requires customer/team, requester name, and requester email.
- After booking, the session is confirmed immediately.
- A booking notification email is sent to the requester and copied to the configured training contact.
- The system rejects duplicate booking by the same Topic + OEM + ODM combination (confirmed only).
- Bookings are blocked when that training topic is marked unavailable for the selected day.
- Cancelled bookings remain in YAML with `cancelledAt` for history and audit.

### Scheduler mode (admin)

- Scheduler mode is protected by password and signed session cookie.
- Scheduler can create 30-minute sessions by clicking empty half-hour cells.
- Scheduler can delete an active session from the session details panel.
- Scheduler can open "Manage unavailable days" to add date ranges per training topic.
- Unavailable days are written to YAML as `unavailableDays` entries and can be removed one-by-one.
- Scheduler can open "Configure recipients" to edit notification mappings from `data/email-recipients.yaml` as a table.
- Recipient rules can target a training default, an OEM, or an exact `OEM / ODM` pair. Exact `OEM / ODM` rules take priority over OEM rules, then default rules.
- Calendar shows all-day unavailable warnings for marked dates.

### Topic vs Customer report

- "Topic vs Customer" now requires explicit OEM and ODM selection.
- Default filter is unselected (none), so totals are shown only after both selections are chosen.
- Report shows booked-session counts by training topic for the selected OEM/ODM pair.

## Rules implemented

- Sessions are 30 minutes and can be created on weekdays from 09:00 through 17:00 Pacific Time.
- Start times use 30-minute increments. Session end time may be 17:30.
- The same instructor cannot have overlapping sessions.
- The same course cannot have two sessions at the same date and time.
- Anyone can view sessions and create bookings. Bookings require customer/team, requester name, and requester email.
- Bookings are confirmed immediately and send notification email to the requester plus the configured training contact.
- Shared slots are still bookable when capacity/rules allow.
- Duplicate booking is rejected for same Topic + OEM + ODM (only confirmed bookings count).
- Booking is blocked on configured `unavailableDays` for matching topic/date.
- Scheduler mode protects session management with a signed session cookie.
- YAML writes use a lock file, fresh read, temporary file, and atomic replacement.
- Pending bookings are visible in user's booking list; only confirmed bookings appear on public calendar.
- Cancelled bookings remain in YAML with `cancelledAt`; cancelled sessions remain when they have bookings.
