# Windows version of deploy.sh: pull the latest main branch from GitHub and restart the
# web server. Started by the /api/deploy webhook in server.js (or run it by hand:
#   powershell -ExecutionPolicy Bypass -File deploy.ps1).
# The "GospelOnTheMountain Site" scheduled task (C:\websites\run-gospel-site.ps1) restarts
# the server after this script stops it. If nothing is listening again within 60 seconds,
# this script starts the server itself.
$ErrorActionPreference = 'Continue'
$Dir = $PSScriptRoot
$Log = Join-Path $Dir 'deploy.log'
$PidFile = Join-Path $Dir 'server.pid'
$ServerLog = Join-Path $Dir 'server.log'
$Port = if ($env:PORT) { [int]$env:PORT } else { 3000 }

function Write-Log($text) {
  Add-Content -Path $Log -Value ("{0:u}  {1}" -f (Get-Date), $text)
}

# Runs git through cmd so its progress output (on stderr) is logged as plain text.
function Invoke-Git($gitArgs) {
  $out = cmd /c "git $gitArgs 2>&1"
  foreach ($line in $out) { Write-Log "  $line" }
  return $LASTEXITCODE
}

function Test-PortInUse {
  [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

Write-Log '== deploy started'
Set-Location $Dir

if ((Invoke-Git 'fetch origin main') -ne 0) { Write-Log 'git fetch failed'; exit 1 }
# GitHub is the source of truth: match it exactly.
if ((Invoke-Git 'reset --hard origin/main') -ne 0) { Write-Log 'git reset failed'; exit 1 }

# Install dependencies (node_modules is not in git). Done before stopping the old server,
# so a failed install leaves the current server running.
$npmOut = cmd /c "npm ci --omit=dev --no-audit --no-fund 2>&1"
foreach ($line in $npmOut) { Write-Log "  $line" }
if ($LASTEXITCODE -ne 0) { Write-Log 'npm ci failed'; exit 1 }

# Stop the running server, if any.
if (Test-Path $PidFile) {
  $oldPid = (Get-Content $PidFile -Raw).Trim()
  $proc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq 'node') {
    Write-Log "stopping server pid $oldPid"
    Stop-Process -Id $oldPid -Force
    $proc.WaitForExit(10000) | Out-Null
  } else {
    Write-Log "no running server with pid $oldPid"
  }
}

# Wait for the watchdog to start the new server; start it here if it does not.
$deadline = (Get-Date).AddSeconds(60)
while (-not (Test-PortInUse) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
if (Test-PortInUse) {
  Write-Log 'server is running'
} else {
  Write-Log 'server did not come back; starting it'
  Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', "node server.js >> `"$ServerLog`" 2>&1" `
    -WorkingDirectory $Dir -WindowStyle Hidden
}
Write-Log '== deploy finished'
