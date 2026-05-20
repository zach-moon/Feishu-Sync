# FeiSync 同步脚本 (Windows PowerShell 版)
# 使用：.\sync.ps1               # 同步 + 日报
#       .\sync.ps1 -NoReport     # 仅同步
#       .\sync.ps1 -ReportOnly   # 仅日报
#
# 定时：用任务计划程序 (Task Scheduler) 调用此脚本，详见 README。

[CmdletBinding()]
param(
  [switch]$NoReport,
  [switch]$ReportOnly
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ReposDir  = Join-Path $ScriptDir '.repos'
$LogDir    = Join-Path $ScriptDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# ─── 加载 .env ─────────────────────────────────────────
$EnvFile = Join-Path $ScriptDir '.env'
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line -match '^\s*([^=\s]+)\s*=\s*(.*)$') {
      $key = $matches[1]
      $val = $matches[2].Trim('"').Trim("'")
      [System.Environment]::SetEnvironmentVariable($key, $val, 'Process')
    }
  }
}

# ─── 依赖检查 ──────────────────────────────────────────
foreach ($cmd in @('git','node','npx')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Error "找不到命令: $cmd. 请先安装 Node.js 20+ 和 git。"
    exit 1
  }
}

Write-Host ''
Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
Write-Host "[feisync] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 开始同步"
Write-Host "[feisync] node=$(node -v)"
Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'

# ─── 仓库准备 ──────────────────────────────────────────
$RepoUrl = $env:GIT_REPO_URL
if (-not $RepoUrl) { $RepoUrl = $env:GITLAB_REPO_URL }
$Branch  = $env:GIT_BRANCH
if (-not $Branch)  { $Branch = $env:GITLAB_BRANCH }
if (-not $Branch)  { $Branch = 'main' }

if ($RepoUrl) {
  $RepoName = [System.IO.Path]::GetFileNameWithoutExtension($RepoUrl)
  $RepoDir  = Join-Path $ReposDir $RepoName

  if (-not (Test-Path (Join-Path $RepoDir '.git'))) {
    Write-Host "[feisync] Cloning: $RepoUrl -> $RepoDir"
    New-Item -ItemType Directory -Force -Path $ReposDir | Out-Null
    git clone --branch $Branch --single-branch --depth 1 $RepoUrl $RepoDir
    if ($LASTEXITCODE -ne 0) { Write-Error 'git clone failed'; exit 1 }
  } else {
    Write-Host "[feisync] git pull: $RepoDir"
    git -C $RepoDir fetch --depth 1 origin $Branch
    git -C $RepoDir reset --hard "origin/$Branch"
  }
  $env:REPO_ROOT = $RepoDir
} elseif ($env:REPO_ROOT -and (Test-Path (Join-Path $env:REPO_ROOT '.git'))) {
  Write-Host "[feisync] git pull: $($env:REPO_ROOT)"
  git -C $env:REPO_ROOT pull --ff-only --quiet
} else {
  Write-Warning 'REPO_ROOT 和 GIT_REPO_URL 均未设置'
}

# ─── 执行同步 ──────────────────────────────────────────
Set-Location $ScriptDir

if ($ReportOnly) {
  Write-Host '[feisync] 仅生成日报...'
  npx tsx src/daily-report.ts
} elseif ($NoReport) {
  npx tsx src/sync-to-feishu.ts
} else {
  npx tsx src/sync-to-feishu.ts
  Write-Host '[feisync] 生成日报...'
  npx tsx src/daily-report.ts
}

Write-Host "[feisync] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 同步完成"
