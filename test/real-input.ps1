# Real-mouse smoke test (Windows). Moves the actual cursor and clicks, so DON'T touch the mouse while it runs.
# It checks the things the fake-event self-test cannot: that real hovering and clicking reach Stash.
#   - the intro card's Next button
#   - single click on Stash opens the panel, double click opens the menu
# It starts its own copy of the app with a throwaway data folder, so quit your normal Stash first.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (Get-Process electron -ErrorAction SilentlyContinue) { Write-Host 'Quit Stash (and any other Electron app) first, then run this again.'; exit 2 }

Add-Type @'
using System; using System.Runtime.InteropServices;
public class RealInput {
  [StructLayout(LayoutKind.Sequential)] struct LII { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LII p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  public static double IdleSeconds() { LII l = new LII(); l.cbSize = (uint)Marshal.SizeOf(l); GetLastInputInfo(ref l); return ((uint)Environment.TickCount - l.dwTime) / 1000.0; }
  public static void Down() { mouse_event(0x2,0,0,0,UIntPtr.Zero); }
  public static void Up() { mouse_event(0x4,0,0,0,UIntPtr.Zero); }
  public static void Click() { mouse_event(0x2,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(50); mouse_event(0x4,0,0,0,UIntPtr.Zero); }
}
'@

$data = Join-Path $env:TEMP ('stash-real-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $data | Out-Null
'{"roamEnabled":false,"patrolReminder":false,"onboarded":true}' | Set-Content (Join-Path $data 'settings.json')
$env:STASH_DATA = $data; $env:STASH_MULTI = '1'; $env:STASH_NO_BRIDGE = '1'
$app = Start-Process -FilePath 'npx.cmd' -ArgumentList 'electron', '.', '--remote-debugging-port=9444' -WorkingDirectory $root -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 9

$cdp = Join-Path $PSScriptRoot 'cdp.js'
function Eval($expr) { $env:CDP_PORT = '9444'; (& node $cdp $expr) }
$fails = 0
function Check($name, $ok) { if ($ok) { Write-Host "  ok   $name" } else { Write-Host "  FAIL $name"; $script:fails++ } }
function Glide($x0, $y0, $x1, $y1) { for ($i = 1; $i -le 16; $i++) { [void][RealInput]::SetCursorPos([int]($x0 + ($x1 - $x0) * $i / 16), [int]($y0 + ($y1 - $y0) * $i / 16)); Start-Sleep -Milliseconds 14 } }
function WaitQuiet { $t0 = Get-Date; while (((Get-Date) - $t0).TotalSeconds -lt 90) { if ([RealInput]::IdleSeconds() -ge 2.5) { return $true }; Start-Sleep -Milliseconds 250 }; return $false }

try {
  Write-Host 'Real mouse test (hands off the mouse...)'
  if (-not (WaitQuiet)) { Write-Host '  could not find a moment without mouse movement'; exit 3 }
  # 1. intro card
  Eval 'window.__stash.onboarding.open(); 1' | Out-Null; Start-Sleep -Milliseconds 800
  $b = (Eval 'JSON.stringify((function(){var r=document.querySelector(''.ob-btn'').getBoundingClientRect(); return [Math.round(r.left+r.width/2), Math.round(r.top+r.height/2)]})())') | ConvertFrom-Json
  [void][RealInput]::SetCursorPos(300, 300); Start-Sleep -Milliseconds 200
  Glide 300 300 $b[0] $b[1]; Start-Sleep -Milliseconds 350
  [RealInput]::Click(); Start-Sleep -Milliseconds 500
  Check 'real click on the intro Next button advances the card' ((Eval 'window.__stash.onboarding.snapshot().step') -eq '1')
  Eval 'window.__stash.onboarding.finish(); 1' | Out-Null; Start-Sleep -Milliseconds 2600   # let Stash finish its little celebration first

  # 2. the squirrel
  $c = (Eval 'JSON.stringify((function(){var b=window.__stash.box(); return [Math.round(b.x+b.w*0.55), Math.round(b.y+b.h*0.6)]})())') | ConvertFrom-Json
  [void][RealInput]::SetCursorPos($c[0] - 300, $c[1] - 200); Start-Sleep -Milliseconds 200
  Glide ($c[0] - 300) ($c[1] - 200) $c[0] $c[1]; Start-Sleep -Milliseconds 350
  Check 'moving the real cursor onto Stash makes it notice you (and not run away)' ((Eval 'window.__stash.info().stateName') -eq 'Notice')
  [RealInput]::Click(); Start-Sleep -Milliseconds 700
  Check 'real single click on Stash opens the panel' ((Eval 'window.__stash.panel.snapshot().open') -eq 'true')
  Eval 'window.__stash.panel.close(); 1' | Out-Null; Start-Sleep -Milliseconds 700
  # a real drag: pick Stash up, carry it across the screen, put it down
  $c = (Eval 'JSON.stringify((function(){var b=window.__stash.box(); return [Math.round(b.x+b.w*0.55), Math.round(b.y+b.h*0.6)]})())') | ConvertFrom-Json
  $p0 = (Eval 'JSON.stringify(window.__stash.info().pos)') | ConvertFrom-Json
  [void][RealInput]::SetCursorPos($c[0] - 200, $c[1] - 120); Start-Sleep -Milliseconds 200
  Glide ($c[0] - 200) ($c[1] - 120) $c[0] $c[1]; Start-Sleep -Milliseconds 350
  [RealInput]::Down(); Start-Sleep -Milliseconds 150
  $tx = [Math]::Max(150, $c[0] - 700); $ty = [Math]::Max(150, $c[1] - 350)
  Glide $c[0] $c[1] $tx $ty
  Start-Sleep -Milliseconds 250
  Check 'pressing on Stash and dragging with the real mouse lifts it' ((Eval 'String(document.getElementById(''stash'').classList.contains(''held''))') -eq 'true')
  [RealInput]::Up(); Start-Sleep -Milliseconds 900
  $p1 = (Eval 'JSON.stringify(window.__stash.info().pos)') | ConvertFrom-Json
  Check 'letting go puts it down, hundreds of pixels from where it was' (([Math]::Abs($p1.x - $p0.x) + [Math]::Abs($p1.y - $p0.y)) -gt 300)
  Check 'a real carry does not open the panel or the menu' (((Eval 'String(window.__stash.panel.snapshot().open)') -eq 'false') -and ((Eval 'String(!document.getElementById(''menu'').hidden)') -eq 'false'))
  Check 'and the new spot is saved' ($null -ne ((Get-Content (Join-Path $data 'settings.json') -Raw | ConvertFrom-Json).homeSpot))
  Start-Sleep -Milliseconds 800
  $c = (Eval 'JSON.stringify((function(){var b=window.__stash.box(); return [Math.round(b.x+b.w*0.55), Math.round(b.y+b.h*0.6)]})())') | ConvertFrom-Json
  [void][RealInput]::SetCursorPos($c[0] - 200, $c[1] - 120); Start-Sleep -Milliseconds 200
  Glide ($c[0] - 200) ($c[1] - 120) $c[0] $c[1]; Start-Sleep -Milliseconds 400
  [RealInput]::Click(); Start-Sleep -Milliseconds 90; [RealInput]::Click(); Start-Sleep -Milliseconds 700
  Check 'real double click on Stash opens the menu' ((Eval 'String(!document.getElementById(''menu'').hidden)') -eq 'true')
} finally {
  Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
  Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
}
if ($fails) { Write-Host "$fails real-input check(s) FAILED"; exit 1 } else { Write-Host 'real-input checks passed'; exit 0 }
