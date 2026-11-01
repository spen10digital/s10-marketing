<#
.SYNOPSIS
  Read-only inventory of local project repositories for S10/Marketing discovery (Milestone M0.1).

.DESCRIPTION
  Scans each Git repository directly under -Root (or the paths given in -Paths) and writes a Markdown
  report. It NEVER prints secret values: for .env files it records variable NAMES only, and it strips
  credentials from Git remote URLs. It does not modify any file except the output report.

  Compatible with Windows PowerShell 5.1 and PowerShell 7+.

.EXAMPLE
  .\scripts\discovery\Get-ProjectInventory.ps1 -Root "C:\Users\me\Projects" -OutFile ".\docs\discovery\inventory.md"

.EXAMPLE
  .\scripts\discovery\Get-ProjectInventory.ps1 -Paths "C:\dev\limitkeep","C:\dev\spen10" -OutFile ".\docs\discovery\inventory.md"
#>
[CmdletBinding()]
param(
  [string]$Root,
  [string[]]$Paths,
  [string]$OutFile = ".\docs\discovery\inventory.md"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$InterestingPackages = @(
  'next','react','typescript','@supabase/supabase-js','@supabase/ssr','stripe','@stripe/stripe-js',
  'ai','@ai-sdk/anthropic','@ai-sdk/openai','@ai-sdk/google','@anthropic-ai/sdk','openai',
  'resend','@aws-sdk/client-ses','@aws-sdk/client-sesv2','@sentry/nextjs','tailwindcss',
  'aws-cdk-lib','aws-amplify','@aws-amplify/adapter-nextjs','@aws-sdk/client-bedrock-runtime','@aws-sdk/client-rds-data','aws-jwt-verify',
  'zod','drizzle-orm','prisma','@prisma/client','vitest','jest','@playwright/test','inngest','@trigger.dev/sdk'
)

function Get-RepoDirs {
  $dirs = @()
  if ($Paths) { $dirs += $Paths | ForEach-Object { Get-Item -LiteralPath $_ } }
  if ($Root) {
    $dirs += Get-ChildItem -LiteralPath $Root -Directory | Where-Object { Test-Path (Join-Path $_.FullName '.git') }
  }
  return $dirs | Sort-Object FullName -Unique
}

function Get-SafeRemote([string]$repo) {
  try {
    $url = (& git -C $repo remote get-url origin 2>$null)
    if (-not $url) { return '(none)' }
    return ($url -replace '://[^@/]+@', '://')   # strip user:token@
  } catch { return '(none)' }
}

function Get-GitValue([string]$repo, [string[]]$gitArgs) {
  try { return (& git -C $repo @gitArgs 2>$null | Select-Object -First 1) } catch { return $null }
}

function Get-EnvVarNames([string]$repo) {
  $result = @()
  $files = Get-ChildItem -LiteralPath $repo -Force -File -Filter '.env*' -ErrorAction SilentlyContinue
  foreach ($f in $files) {
    $names = Get-Content -LiteralPath $f.FullName -ErrorAction SilentlyContinue |
      ForEach-Object { if ($_ -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=') { $Matches[1] } } |
      Sort-Object -Unique
    $result += [pscustomobject]@{ File = $f.Name; Names = ($names -join ', ') }
  }
  return $result
}

function Get-PackageInfo([string]$repo) {
  $pkgPath = Join-Path $repo 'package.json'
  if (-not (Test-Path $pkgPath)) { return $null }
  $pkg = Get-Content -LiteralPath $pkgPath -Raw | ConvertFrom-Json
  $all = @{}
  foreach ($section in 'dependencies','devDependencies') {
    if ($pkg.PSObject.Properties.Name -contains $section) {
      foreach ($p in $pkg.$section.PSObject.Properties) { $all[$p.Name] = $p.Value }
    }
  }
  $found = $InterestingPackages | Where-Object { $all.ContainsKey($_) } | ForEach-Object { "$_@$($all[$_])" }
  $pm = 'npm'
  if (Test-Path (Join-Path $repo 'pnpm-lock.yaml')) { $pm = 'pnpm' }
  elseif (Test-Path (Join-Path $repo 'yarn.lock')) { $pm = 'yarn' }
  elseif (Test-Path (Join-Path $repo 'bun.lockb')) { $pm = 'bun' }
  return [pscustomobject]@{ Name = $pkg.name; PackageManager = $pm; Packages = ($found -join ', ') }
}

function Get-FeedRoutes([string]$repo) {
  $patterns = '*rss*','*feed*','*sitemap*','*atom*'
  $roots = @('app','src\app','pages','src\pages','public') | ForEach-Object { Join-Path $repo $_ } | Where-Object { Test-Path $_ }
  $hits = @()
  foreach ($r in $roots) {
    foreach ($p in $patterns) {
      $hits += Get-ChildItem -LiteralPath $r -Recurse -Filter $p -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\node_modules\\|\\.next\\' } |
        ForEach-Object { $_.FullName.Substring($repo.Length).TrimStart('\') }
    }
  }
  return ($hits | Sort-Object -Unique) -join ', '
}

$repos = Get-RepoDirs
if (-not $repos) { throw 'No repositories found. Use -Root <folder> or -Paths <repo1>,<repo2>.' }

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('# Project Inventory (generated)')
[void]$sb.AppendLine('')
[void]$sb.AppendLine("Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm') by Get-ProjectInventory.ps1. Env files list variable NAMES only.")
[void]$sb.AppendLine('')

foreach ($r in $repos) {
  $repo = $r.FullName
  $pkg = Get-PackageInfo $repo
  $supabaseDir = Join-Path $repo 'supabase'
  $migrations = 0
  if (Test-Path (Join-Path $supabaseDir 'migrations')) {
    $migrations = @(Get-ChildItem -LiteralPath (Join-Path $supabaseDir 'migrations') -Filter '*.sql').Count
  }
  $vercelJson = Join-Path $repo 'vercel.json'
  $crons = 'n/a'
  if (Test-Path $vercelJson) {
    $vj = Get-Content -LiteralPath $vercelJson -Raw | ConvertFrom-Json
    if ($vj.PSObject.Properties.Name -contains 'crons') { $crons = "$(@($vj.crons).Count) cron(s): " + ((@($vj.crons) | ForEach-Object { "$($_.path) [$($_.schedule)]" }) -join '; ') }
    else { $crons = '0' }
  }
  $workflows = 0
  if (Test-Path (Join-Path $repo '.github\workflows')) { $workflows = @(Get-ChildItem -LiteralPath (Join-Path $repo '.github\workflows') -File).Count }

  [void]$sb.AppendLine("## $($r.Name)")
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('| Item | Value |')
  [void]$sb.AppendLine('|---|---|')
  [void]$sb.AppendLine("| Path | ``$repo`` |")
  [void]$sb.AppendLine("| Git remote | $(Get-SafeRemote $repo) |")
  [void]$sb.AppendLine("| Current branch | $(Get-GitValue $repo @('rev-parse','--abbrev-ref','HEAD')) |")
  [void]$sb.AppendLine("| Last commit | $(Get-GitValue $repo @('log','-1','--format=%cs %s')) |")
  if ($pkg) {
    [void]$sb.AppendLine("| package name | $($pkg.Name) |")
    [void]$sb.AppendLine("| Package manager | $($pkg.PackageManager) |")
    [void]$sb.AppendLine("| Key packages | $($pkg.Packages) |")
  } else {
    [void]$sb.AppendLine('| package.json | not found |')
  }
  [void]$sb.AppendLine("| supabase/ folder | $(Test-Path $supabaseDir) (migrations: $migrations) |")
  [void]$sb.AppendLine("| supabase/config.toml | $(Test-Path (Join-Path $supabaseDir 'config.toml')) |")
  [void]$sb.AppendLine("| vercel.json crons | $crons |")
  [void]$sb.AppendLine("| GitHub workflows | $workflows |")
  [void]$sb.AppendLine("| Feed/sitemap files | $(Get-FeedRoutes $repo) |")
  [void]$sb.AppendLine('')
  $envs = Get-EnvVarNames $repo
  if ($envs) {
    [void]$sb.AppendLine('**Env variable names (no values):**')
    [void]$sb.AppendLine('')
    foreach ($e in $envs) { [void]$sb.AppendLine("- ``$($e.File)``: $($e.Names)") }
    [void]$sb.AppendLine('')
  }
}

$outDir = Split-Path -Parent $OutFile
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
Set-Content -LiteralPath $OutFile -Value $sb.ToString() -Encoding UTF8
Write-Host "Inventory written to $OutFile ($(@($repos).Count) repositories)."
