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
npm start
```

The data file must already exist, its directory must be writable, and it must contain valid YAML. The server refuses to start when `DATA_FILE` or `SCHEDULER_PASSWORD` is missing. Keep the YAML outside the public `dist` directory.

The server creates automatic backups in a `scheduler-backups` directory beside the YAML file every day at `11:00` and `20:00` Pacific Time. Only the latest 8 backup files are retained. Persist both the YAML directory and its backup directory when running in a container.

## Rules implemented

- Sessions are 30 minutes and can be created on weekdays from 09:00 through 17:00 Pacific Time.
- Start times use 30-minute increments. Session end time may be 17:30.
- The same instructor cannot have overlapping sessions.
- The same course cannot have two sessions at the same date and time.
- Anyone can view sessions and create bookings. Bookings require customer/team, requester name, and requester email.
- Scheduler mode protects session management with a signed session cookie.
- YAML writes use a lock file, fresh read, temporary file, and atomic replacement.
- Cancelled bookings remain in YAML with `cancelledAt`; cancelled sessions remain when they have bookings.
