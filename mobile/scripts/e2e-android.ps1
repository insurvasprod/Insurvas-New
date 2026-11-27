# Runs the Maestro flows on the Android emulator (Windows).
#
#   powershell -File mobile/scripts/e2e-android.ps1                  # every flow that needs no account
#   powershell -File mobile/scripts/e2e-android.ps1 -SignedIn -Email demo.agent@insurvas.test -ProducerEmail qa.member.1.1022@insurvas.test
#
# Needs: the emulator running, Metro on 8081 (`npm --prefix mobile run android`) and the web app on 3000.
# The signed-in walk mints development-only tokens for a TEST account (scripts/mint-session.mjs, reads
# .env.local) — no password is typed or stored. It is read only.
param([switch]$SignedIn, [string]$Email = "", [string]$ProducerEmail = "")
$ErrorActionPreference = "Continue"
$mobile = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $mobile
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:JAVA_HOME = "$env:LOCALAPPDATA\Programs\jdk17"
$env:Path = "$env:ANDROID_HOME\platform-tools;$env:JAVA_HOME\bin;$env:LOCALAPPDATA\Programs\maestro\bin;$env:SystemRoot\System32;$env:Path"
$env:MAESTRO_CLI_NO_ANALYTICS = "1"
$maestro = "$env:LOCALAPPDATA\Programs\maestro\bin\maestro.bat"

function Set-Forwards {
  # The flows reach Metro and the API at 10.0.2.2 (the emulator's name for this PC), which needs no
  # forwarding; adb reverse is also set for anyone opening exp://127.0.0.1:8081 by hand (Maestro's
  # start-up restarts adb, which drops it — the reason the flows don't rely on it).
  adb reverse tcp:8081 tcp:8081 | Out-Null
  adb reverse tcp:3000 tcp:3000 | Out-Null
  # The emulator presents a hardware keyboard, so Gboard shows a floating stylus toolbar over forms.
  adb shell settings put secure stylus_handwriting_enabled 0 | Out-Null
}

Set-Location $mobile
New-Item -ItemType Directory -Force "e2e\screenshots" | Out-Null
$failed = 0

Set-Forwards
& $maestro test "e2e/01-sign-in-screen.yaml" --exclude-tags subflow
if ($LASTEXITCODE -ne 0) { $failed++ }

if ($SignedIn) {
  if (-not $Email) { Write-Output "Pass -Email <test account>."; exit 2 }
  Push-Location $repo
  $env:MAESTRO_LINK = (cmd /c "node --env-file=.env.local scripts/mint-session.mjs tenant --email $Email --ttl 60 --app --link --host 10.0.2.2 2>nul" | Out-String).Trim()
  Pop-Location
  if (-not $env:MAESTRO_LINK.StartsWith("exp://10.0.2.2")) { Write-Output "Could not mint test tokens for $Email."; exit 2 }
  # -Email is an OWNER account: since release 3 an owner's tabs are Home · Team · Money · Inbox · Menu.
  Set-Forwards
  & $maestro test "e2e/04-new-screens-dev.yaml"
  if ($LASTEXITCODE -ne 0) { $failed++ }
  Set-Forwards
  & $maestro test "e2e/05-release-2-dev.yaml"
  if ($LASTEXITCODE -ne 0) { $failed++ }
  Set-Forwards
  & $maestro test "e2e/06-release-3-dev.yaml"
  if ($LASTEXITCODE -ne 0) { $failed++ }
  Remove-Item Env:\MAESTRO_LINK
  # The producer tab walk (Calls · Leads by position) needs a PRODUCER account.
  if ($ProducerEmail) {
    Push-Location $repo
    $env:MAESTRO_LINK = (cmd /c "node --env-file=.env.local scripts/mint-session.mjs tenant --email $ProducerEmail --ttl 60 --app --link --host 10.0.2.2 2>nul" | Out-String).Trim()
    Pop-Location
    if (-not $env:MAESTRO_LINK.StartsWith("exp://10.0.2.2")) { Write-Output "Could not mint test tokens for $ProducerEmail."; exit 2 }
    Set-Forwards
    & $maestro test "e2e/03-signed-in-walk-dev.yaml"
    if ($LASTEXITCODE -ne 0) { $failed++ }
    Remove-Item Env:\MAESTRO_LINK
  }
}

# Maestro writes screenshots inside its own run folder; copy this run's into e2e/screenshots (git-ignored).
$runs = Get-ChildItem "$env:USERPROFILE\.maestro\tests" -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5
foreach ($r in $runs) { Get-ChildItem $r.FullName -Recurse -Filter *.png | Where-Object { $_.FullName -like "*takeScreenshot*" } | Copy-Item -Destination "e2e\screenshots" -Force }
Write-Output ("E2E: " + $(if ($failed) { "$failed flow(s) failed" } else { "all flows passed" }) + " - screenshots in mobile/e2e/screenshots")
exit $failed
