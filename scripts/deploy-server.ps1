param(
  [string]$RepoPath = "C:\Training_Scheduler",
  [string]$Branch = "main",
  [int]$Port = 3001,
  [string]$SchedulerPassword = "123",
  [string]$DataFile = "",
  [switch]$UseNpmInstall
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) {
  Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Stop-PortProcess([int]$TargetPort) {
  $listeners = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
  if (-not $listeners) {
    Write-Host "No listener on port $TargetPort"
    return
  }

  $procIds = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $procIds) {
    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
      Write-Host "Stopped process $procId on port $TargetPort"
    } catch {
      Write-Warning "Failed to stop process ${procId}: $($_.Exception.Message)"
    }
  }
}

if (-not (Test-Path $RepoPath)) {
  throw "RepoPath not found: $RepoPath"
}

Set-Location $RepoPath

if ([string]::IsNullOrWhiteSpace($DataFile)) {
  $DataFile = Join-Path $RepoPath "data\scheduler.yaml"
}

if (-not (Test-Path $DataFile)) {
  throw "Data file not found: $DataFile"
}

Write-Step "Git update"
& git fetch origin
& git checkout $Branch
& git pull --ff-only origin $Branch

Write-Step "Install dependencies"
if ($UseNpmInstall) {
  & npm install
} else {
  try {
    & npm ci
  } catch {
    Write-Warning "npm ci failed; fallback to npm install"
    & npm install
  }
}

Write-Step "Build"
& npm run build

Write-Step "Stop existing service on port $Port"
Stop-PortProcess -TargetPort $Port

Write-Step "Start service in background"
$startCmd = "$env:SCHEDULER_PASSWORD='$SchedulerPassword'; `$env:DATA_FILE='$DataFile'; `$env:PORT='$Port'; node dist-server/index.js"
$proc = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command $startCmd" -PassThru -WindowStyle Hidden

$pidFile = Join-Path $RepoPath ".server-$Port.pid"
Set-Content -Path $pidFile -Value $proc.Id -Encoding ascii
Write-Host "Started process PID: $($proc.Id)"
Write-Host "PID file: $pidFile"

Write-Step "Health check"
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:$Port/api/auth/status" -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      Write-Host "Health check OK: $($response.Content)" -ForegroundColor Green
      $ok = $true
      break
    }
  } catch {
    # retry
  }
}

if (-not $ok) {
  throw "Service did not become healthy on http://localhost:$Port/api/auth/status"
}

Write-Step "Done"
Write-Host "Deployment completed on branch '$Branch' at $(Get-Date -Format s)" -ForegroundColor Green
