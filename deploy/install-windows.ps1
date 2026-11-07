<#
.SYNOPSIS
  Sets up a Windows 10/11 or Windows Server 2022/2025 machine to host the panel:
  WSL2 + a dedicated Ubuntu 24.04 distro + Docker Engine inside it (Linux containers).

.DESCRIPTION
  Run in an elevated PowerShell (Run as Administrator), from the repository checkout:

    powershell -ExecutionPolicy Bypass -File deploy\install-windows.ps1 -AdminUser admin

  Steps (safe to run again):
    1. Checks the Windows build (WSL2 needs Windows 10 2004+ / Server 2022+).
    2. Enables WSL (wsl --install --no-distribution). If a reboot is needed the script
       says so and exits; run it again after the reboot and it continues.
    3. Writes %UserProfile%\.wslconfig: vmIdleTimeout=-1 and, on Windows 11 22H2+ /
       Server 2025, networkingMode=mirrored (ports bound in WSL are reachable on the host).
    4. Installs a dedicated distro (default name PanelHost) from Ubuntu 24.04 with
       'wsl --install --name' (does not touch an existing Ubuntu distro).
    5. Enables systemd in the distro (/etc/wsl.conf).
    6. Opens Windows Firewall (and the Hyper-V firewall for WSL in mirrored mode) for
       80/tcp, 443/tcp, 443/udp and 41641/udp (Tailscale direct connections).
       In NAT mode (older builds) adds netsh portproxy rules for 80/443 instead.
    7. Registers a scheduled task that starts the distro at boot, without a login.
    8. Runs deploy/install.sh inside the distro (Docker, Tailscale, panel directories).
       Tailscale runs INSIDE the distro.

  Exit code 3010 means: reboot, then run the script again.

.PARAMETER Boot
  Internal: used by the startup task. Starts the distro, refreshes the NAT port
  forwarding if needed and keeps the distro running.
#>
[CmdletBinding()]
param(
  [string]$AdminUser = $env:ADMIN_USER,
  [string]$DistroName = 'PanelHost',
  [string]$InstallDir = (Join-Path $env:SystemDrive 'WSL\PanelHost'),
  [string]$TsAuthKey = $env:TS_AUTHKEY,
  [string]$TsHostname = 'panel',
  [string]$TzName = $env:TZ_NAME,
  [ValidateSet('auto', 'mirrored', 'nat')]
  [string]$Networking = 'auto',
  # Only used when this WSL version has no 'wsl --install --name': an Ubuntu 24.04 WSL rootfs
  # tarball (https://cloud-images.ubuntu.com/wsl/) to import with 'wsl --import'.
  [string]$RootfsUrl = '',
  [switch]$SkipLinuxInstall,
  [switch]$Boot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
# Makes wsl.exe print UTF-8 instead of UTF-16 so its output can be parsed
$env:WSL_UTF8 = '1'

$TaskName = "$DistroName-Start"
$HyperVWslId = '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'
$PanelPorts = @(80, 443)

function Write-Step([string]$m) { Write-Host "[+] $m" -ForegroundColor Green }
function Write-Note([string]$m) { Write-Host "[i] $m" -ForegroundColor Cyan }
function Write-Warn([string]$m) { Write-Host "[!] $m" -ForegroundColor Yellow }
function Stop-WithError([string]$m) { Write-Host "[x] $m" -ForegroundColor Red; exit 1 }

# Runs a native program without PowerShell 5.1 turning its stderr into errors
function Invoke-Native {
  param([string]$Exe, [string[]]$ArgList)
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $Exe @ArgList 2>$null
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
  [pscustomobject]@{ Code = $code; Out = (($out | ForEach-Object { "$_" }) -join "`n") }
}

# Runs a shell script as root inside the distro. The script goes through base64 so that
# PowerShell 5.1's argument quoting and CRLF line endings cannot break it.
function Invoke-InDistro {
  param([string]$Script, [switch]$Stream)
  $bytes = [Text.Encoding]::UTF8.GetBytes(($Script -replace "`r", ''))
  $b64 = [Convert]::ToBase64String($bytes)
  $argList = @('-d', $DistroName, '-u', 'root', '--', 'sh', '-c', "echo $b64 | base64 -d | sh")
  if ($Stream) {
    & wsl.exe @argList
    return $LASTEXITCODE
  }
  Invoke-Native 'wsl.exe' $argList
}

function Test-DistroExists {
  $r = Invoke-Native 'wsl.exe' @('--list', '--quiet')
  if ($r.Code -ne 0) { return $false }
  foreach ($line in ($r.Out -split "`n")) {
    if (($line -replace "[`0\s]", '') -eq $DistroName) { return $true }
  }
  $false
}

function Get-WslIPv4 {
  $r = Invoke-InDistro "ip -4 -o addr show eth0 | awk '{print `$4}' | cut -d/ -f1 | head -n1"
  $r.Out.Trim()
}

function Wait-Systemd {
  for ($i = 0; $i -lt 30; $i++) {
    $r = Invoke-InDistro 'test -d /run/systemd/system && echo ok'
    if ($r.Out -match 'ok') { return $true }
    Start-Sleep -Seconds 2
  }
  $false
}

# NAT mode: forward Windows :80/:443 to the distro's current eth0 address and keep
# BIND_IPV4 in deploy/.env in sync (the address changes when WSL restarts).
function Update-NatForwarding {
  $ip = Get-WslIPv4
  if (-not $ip) { Write-Warn 'Could not read the WSL address; port forwarding not updated.'; return }
  foreach ($p in $PanelPorts) {
    Invoke-Native 'netsh.exe' @('interface', 'portproxy', 'delete', 'v4tov4', "listenport=$p", 'listenaddress=0.0.0.0') | Out-Null
    $r = Invoke-Native 'netsh.exe' @('interface', 'portproxy', 'add', 'v4tov4', "listenport=$p", 'listenaddress=0.0.0.0', "connectport=$p", "connectaddress=$ip")
    if ($r.Code -ne 0) { Write-Warn "netsh portproxy for port $p failed: $($r.Out)" }
  }
  Write-Note "NAT: Windows 0.0.0.0:80/443 -> $ip (HTTP/3 over UDP is not forwarded in NAT mode)."
  $sync = @'
ENV=/opt/panel/src/deploy/.env
[ -f "$ENV" ] || exit 0
IP="__IP__"
if grep -q '^BIND_IPV4=' "$ENV"; then
  grep -qx "BIND_IPV4=$IP" "$ENV" && exit 0
  sed -i "s/^BIND_IPV4=.*/BIND_IPV4=$IP/" "$ENV"
else
  printf 'BIND_IPV4=%s\n' "$IP" >> "$ENV"
fi
OWNER=$(stat -c %U /opt/panel/src)
cd /opt/panel/src/deploy && su "$OWNER" -c 'docker compose up -d' >/dev/null 2>&1 || docker compose up -d
'@
  Invoke-InDistro ($sync -replace '__IP__', $ip) | Out-Null
}

function Set-IniValues {
  param([string]$Path, [string]$Section, [hashtable]$Values)
  $lines = New-Object System.Collections.Generic.List[string]
  if (Test-Path $Path) { foreach ($l in (Get-Content -Path $Path)) { $lines.Add($l) } }
  $start = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].Trim() -ieq "[$Section]") { $start = $i; break }
  }
  if ($start -lt 0) {
    if ($lines.Count -gt 0 -and $lines[$lines.Count - 1].Trim() -ne '') { $lines.Add('') }
    $lines.Add("[$Section]")
    $start = $lines.Count - 1
  }
  $end = $lines.Count
  for ($i = $start + 1; $i -lt $lines.Count; $i++) {
    if ($lines[$i].Trim().StartsWith('[')) { $end = $i; break }
  }
  $changed = $false
  foreach ($key in $Values.Keys) {
    $want = "$key=$($Values[$key])"
    $found = $false
    for ($i = $start + 1; $i -lt $end; $i++) {
      if ($lines[$i] -match "^\s*$([regex]::Escape($key))\s*=") {
        $found = $true
        if ($lines[$i].Trim() -ne $want) { $lines[$i] = $want; $changed = $true }
      }
    }
    if (-not $found) { $lines.Insert($end, $want); $end++; $changed = $true }
  }
  if ($changed) {
    [IO.File]::WriteAllText($Path, (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))
  }
  $changed
}

function Add-FirewallRule {
  param([string]$Name, [string]$Protocol, [int[]]$Ports)
  if (-not (Get-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name $Name -DisplayName $Name -Direction Inbound -Action Allow `
      -Protocol $Protocol -LocalPort $Ports -Profile Any | Out-Null
  }
}

function Add-HyperVFirewallRule {
  param([string]$Name, [string]$Protocol, [int[]]$Ports)
  if (-not (Get-Command New-NetFirewallHyperVRule -ErrorAction SilentlyContinue)) { return $false }
  if (-not (Get-NetFirewallHyperVRule -Name $Name -ErrorAction SilentlyContinue)) {
    New-NetFirewallHyperVRule -Name $Name -DisplayName $Name -Direction Inbound -Action Allow `
      -VMCreatorId $HyperVWslId -Protocol $Protocol -LocalPorts $Ports | Out-Null
  }
  $true
}

# ---------------------------------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Stop-WithError 'Run this script in an elevated PowerShell (Run as Administrator).'
}

$os = Get-CimInstance Win32_OperatingSystem
$build = [int]$os.BuildNumber
$isServer = $os.ProductType -ne 1

# ---------------------------------------------------------------------------
if ($Boot) {
  # Startup task: keep the distro running (WSL stops idle distros), refresh NAT forwarding.
  $keep = Start-Process -FilePath 'wsl.exe' -ArgumentList @('-d', $DistroName, '-u', 'root', '--exec', '/bin/sleep', 'infinity') `
    -WindowStyle Hidden -PassThru
  if (Wait-Systemd) {
    $mode = Invoke-InDistro 'cat /etc/panel-wsl-networking 2>/dev/null'
    if ($mode.Out.Trim() -eq 'nat') { Update-NatForwarding }
  }
  $keep.WaitForExit()
  exit $keep.ExitCode
}

# ---------------------------------------------------------------------------
Write-Step "1/8 Windows build $build ($($os.Caption))"
if ($isServer) {
  if ($build -lt 20348) { Stop-WithError 'Windows Server 2022 (build 20348) or newer is required for WSL2.' }
  $mirroredOk = $build -ge 26100
} else {
  if ($build -lt 19041) { Stop-WithError 'Windows 10 version 2004 (build 19041) or newer is required for WSL2.' }
  $mirroredOk = $build -ge 22621
}
if ($Networking -eq 'auto') { $Networking = $(if ($mirroredOk) { 'mirrored' } else { 'nat' }) }
if ($Networking -eq 'mirrored' -and -not $mirroredOk) {
  Write-Warn 'Mirrored networking needs Windows 11 22H2+ or Server 2025; using NAT.'
  $Networking = 'nat'
}
Write-Note "WSL networking: $Networking"
if (-not $SkipLinuxInstall -and -not $AdminUser) { Stop-WithError 'AdminUser is required (-AdminUser admin or $env:ADMIN_USER).' }

# ---------------------------------------------------------------------------
Write-Step '2/8 WSL'
$needReboot = $false
foreach ($f in @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')) {
  $feat = Get-WindowsOptionalFeature -Online -FeatureName $f -ErrorAction SilentlyContinue
  if ($feat -and $feat.State -ne 'Enabled') {
    Write-Note "Enabling $f"
    $r = Enable-WindowsOptionalFeature -Online -FeatureName $f -All -NoRestart
    if ($r.RestartNeeded) { $needReboot = $true }
  }
}
if ($needReboot) {
  Write-Warn 'Windows features were enabled. REBOOT, then run this script again; it continues from here.'
  exit 3010
}
# Store WSL (needed for systemd and mirrored networking); also installs the WSL kernel
$r = Invoke-Native 'wsl.exe' @('--update', '--web-download')
if ($r.Code -ne 0) { $r = Invoke-Native 'wsl.exe' @('--update') }
if ($r.Code -ne 0) {
  $r = Invoke-Native 'wsl.exe' @('--install', '--no-distribution')
  if ($r.Code -ne 0) { Stop-WithError "WSL could not be installed or updated: $($r.Out)" }
  Write-Warn 'WSL was installed. REBOOT, then run this script again.'
  exit 3010
}
Invoke-Native 'wsl.exe' @('--set-default-version', '2') | Out-Null

# ---------------------------------------------------------------------------
Write-Step '3/8 %UserProfile%\.wslconfig'
$wslconfig = Join-Path $env:USERPROFILE '.wslconfig'
$values = @{ vmIdleTimeout = '-1' }
if ($Networking -eq 'mirrored') { $values['networkingMode'] = 'mirrored' } else { $values['networkingMode'] = 'nat' }
$cfgChanged = Set-IniValues -Path $wslconfig -Section 'wsl2' -Values $values
if ($cfgChanged) {
  Write-Note "Updated $wslconfig. It applies to every WSL distro (Docker Desktop too); restarting WSL."
  Invoke-Native 'wsl.exe' @('--shutdown') | Out-Null
}

# ---------------------------------------------------------------------------
Write-Step "4/8 Distro '$DistroName' (Ubuntu 24.04)"
if (Test-DistroExists) {
  Write-Note 'Already installed.'
} else {
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $help = Invoke-Native 'wsl.exe' @('--help')
  if ($help.Out -match '--name') {
    # Dedicated name + location; --no-launch skips the first-run user prompt
    $r = Invoke-Native 'wsl.exe' @('--install', 'Ubuntu-24.04', '--name', $DistroName, '--location', $InstallDir, '--no-launch', '--web-download')
    if ($r.Code -ne 0) { Stop-WithError "wsl --install failed: $($r.Out)" }
  } elseif ($RootfsUrl) {
    $tar = Join-Path $env:TEMP "$DistroName-rootfs.tar.gz"
    Write-Note "Downloading $RootfsUrl"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $RootfsUrl -OutFile $tar -UseBasicParsing
    $r = Invoke-Native 'wsl.exe' @('--import', $DistroName, $InstallDir, $tar, '--version', '2')
    Remove-Item $tar -Force -ErrorAction SilentlyContinue
    if ($r.Code -ne 0) { Stop-WithError "wsl --import failed: $($r.Out)" }
  } else {
    Stop-WithError "This WSL has no 'wsl --install --name'. Update WSL (wsl --update) or pass -RootfsUrl with an Ubuntu 24.04 WSL rootfs tarball."
  }
  if (-not (Test-DistroExists)) { Stop-WithError "Distro '$DistroName' was not registered." }
}

# ---------------------------------------------------------------------------
Write-Step '5/8 systemd in the distro'
$wslConf = @'
cat > /etc/wsl.conf <<'EOF'
[boot]
systemd=true

[interop]
# Keep Windows tools (e.g. Docker Desktop's docker.exe) out of the Linux PATH
appendWindowsPath=false
EOF
printf '%s\n' '__MODE__' > /etc/panel-wsl-networking
'@
$r = Invoke-InDistro ($wslConf -replace '__MODE__', $Networking)
if ($r.Code -ne 0) { Stop-WithError "Could not write /etc/wsl.conf: $($r.Out)" }
Invoke-Native 'wsl.exe' @('--terminate', $DistroName) | Out-Null
if (-not (Wait-Systemd)) { Stop-WithError 'systemd did not start in the distro. Run: wsl --update, then this script again.' }

# ---------------------------------------------------------------------------
Write-Step '6/8 Firewall'
Add-FirewallRule -Name 'Panel-HTTP-TCP' -Protocol TCP -Ports $PanelPorts
Add-FirewallRule -Name 'Panel-HTTP3-UDP' -Protocol UDP -Ports @(443)
Add-FirewallRule -Name 'Panel-Tailscale-UDP' -Protocol UDP -Ports @(41641)
if ($Networking -eq 'mirrored') {
  # In mirrored mode inbound traffic to WSL also passes the Hyper-V firewall
  $ok = (Add-HyperVFirewallRule -Name 'Panel-WSL-HTTP-TCP' -Protocol TCP -Ports $PanelPorts) -and
        (Add-HyperVFirewallRule -Name 'Panel-WSL-HTTP3-UDP' -Protocol UDP -Ports @(443)) -and
        (Add-HyperVFirewallRule -Name 'Panel-WSL-Tailscale-UDP' -Protocol UDP -Ports @(41641))
  if (-not $ok) { Write-Note 'No Hyper-V firewall cmdlets on this build; Windows Firewall rules only.' }
} else {
  Set-Service -Name iphlpsvc -StartupType Automatic
  Start-Service -Name iphlpsvc
  Update-NatForwarding
}

# ---------------------------------------------------------------------------
Write-Step "7/8 Startup task '$TaskName'"
$bootScript = Join-Path $InstallDir 'install-windows.ps1'
if ($PSCommandPath -ne $bootScript) { Copy-Item -Path $PSCommandPath -Destination $bootScript -Force }
$psArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$bootScript`" -Boot -DistroName `"$DistroName`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'
# S4U: runs at boot without a login and without storing a password. WSL distros are
# per-user, so the task runs as this user.
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $userId -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $taskPrincipal `
  -Settings $settings -Force | Out-Null
Write-Note "Registered (runs as $userId at boot)."

# ---------------------------------------------------------------------------
Write-Step '8/8 Linux setup inside the distro (deploy/install.sh)'
$repoDeploy = Split-Path -Parent $PSCommandPath
$installSh = Join-Path $repoDeploy 'install.sh'
if ($SkipLinuxInstall) {
  Write-Note 'Skipped (-SkipLinuxInstall).'
} elseif (-not (Test-Path $installSh)) {
  Write-Warn "install.sh not found next to this script ($installSh); run it inside the distro yourself."
} else {
  $p = Invoke-Native 'wsl.exe' @('-d', $DistroName, '-u', 'root', '--', 'wslpath', '-a', $installSh)
  $linuxPath = $p.Out.Trim()
  if ($p.Code -ne 0 -or -not $linuxPath) { Stop-WithError "wslpath failed for $installSh" }
  # WSLENV passes these Windows environment variables into the Linux process
  $env:ADMIN_USER = $AdminUser
  $env:TS_AUTHKEY = $TsAuthKey
  $env:TS_HOSTNAME = $TsHostname
  $env:TZ_NAME = $TzName
  $env:WSLENV = 'ADMIN_USER:TS_AUTHKEY:TS_HOSTNAME:TZ_NAME'
  & wsl.exe -d $DistroName -u root -- bash $linuxPath
  if ($LASTEXITCODE -ne 0) { Stop-WithError "install.sh failed (exit $LASTEXITCODE). Fix the cause and run this script again." }
}

# ---------------------------------------------------------------------------
$lan = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.|100\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } |
  Select-Object -ExpandProperty IPAddress
Write-Host ''
Write-Step 'Windows setup finished.'
Write-Host @"

Next steps:
  1) Open a shell in the distro as the admin user:
       wsl -d $DistroName -u $AdminUser
  2) Put the panel code in /opt/panel/src (git clone), then:
       cd /opt/panel/src/deploy && cp .env.example .env && nano .env
"@
if ($Networking -eq 'mirrored') {
  Write-Host "       PUBLIC_IPV4 = this PC's address (mirrored into WSL): $($lan -join ', ')"
  Write-Host '       Forward 80/tcp, 443/tcp and 443/udp on your router to that address.'
} else {
  Write-Host '       PUBLIC_IPV4 = your public IP (for DNS checks)'
  Write-Host "       BIND_IPV4   = $(Get-WslIPv4)   (the distro address; the startup task updates it at every boot)"
  Write-Host '       Forward 80/tcp and 443/tcp on your router to this PC.'
}
Write-Host @"
  3) docker compose up -d --build   and   docker logs panel   (first-run setup token)
  4) sudo bash /opt/panel/src/deploy/install-updater.sh   (update the panel from the panel)

Notes:
  - Do not run Tailscale on Windows itself with the same machine; Tailscale runs inside $DistroName.
  - Nothing else on Windows may listen on 80/443 (IIS, Docker Desktop containers...).
  - If the panel does not come up after a reboot without a login, re-register the task
    '$TaskName' with "Run whether user is logged on or not" and a stored password.
"@
