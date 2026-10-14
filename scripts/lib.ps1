# Shared helpers for push-to-github.ps1 and release-to-marketplace.ps1. Dot-source this file; do not run it.
# Machine-specific settings (git dir, token file, strings that must never be committed) come from
# scripts/local.ps1, which is git-ignored. See scripts/local.example.ps1.

$script:Repo = "Hiventiq/byok_vsc"
$script:SonarKey = "Hiventiq_byok_vsc"
$script:ExtensionId = "hiventiq.hiventiq-byok"
$script:ProjectDir = Split-Path -Parent $PSScriptRoot
$script:GitDir = $null
$script:TokenFile = $null
$script:ForbiddenStrings = @()
$script:RequiredChecks = @("Test (ubuntu-latest)", "Test (windows-latest)", "SonarCloud Code Analysis")
$script:CachedToken = $null

$localConfig = Join-Path $PSScriptRoot "local.ps1"
if (Test-Path $localConfig) { . $localConfig }

# ---- output ---------------------------------------------------------------------------------

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Good([string]$Message) { Write-Host "    $Message" -ForegroundColor Green }
function Write-Bad([string]$Message) { Write-Host "    $Message" -ForegroundColor Red }

# ---- token and git --------------------------------------------------------------------------

function Get-GitHubToken {
  if ($script:CachedToken) { return $script:CachedToken }
  if ($env:GITHUB_TOKEN) { $script:CachedToken = $env:GITHUB_TOKEN.Trim() }
  elseif ($script:TokenFile -and (Test-Path $script:TokenFile)) { $script:CachedToken = (Get-Content $script:TokenFile -Raw).Trim() }
  else { throw "No GitHub token: set GITHUB_TOKEN, or TokenFile in scripts/local.ps1." }
  return $script:CachedToken
}

function Get-BasicAuth {
  return [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$(Get-GitHubToken)"))
}

# Never let the token or its encoded form reach the console or an error message.
function Hide-Secrets([string]$Text) {
  if (-not $script:CachedToken) { return $Text }
  return $Text.Replace($script:CachedToken, "<token>").Replace((Get-BasicAuth), "<token>")
}

function Invoke-Git {
  param([string[]]$GitArgs, [switch]$Authenticated, [switch]$AllowFail)
  $prefix = @()
  if ($script:GitDir) { $prefix += "--git-dir=$($script:GitDir)" } else { $prefix += @("-C", $script:ProjectDir) }
  if ($Authenticated) { $prefix += @("-c", "http.extraheader=Authorization: Basic $(Get-BasicAuth)") }
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { $lines = & git @prefix @GitArgs 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $previous }
  $code = $LASTEXITCODE
  $clean = @($lines | Where-Object { $_ -notmatch "LF will be replaced|Git touches it" } | ForEach-Object { Hide-Secrets $_ })
  if ($code -ne 0 -and -not $AllowFail) { throw "git $($GitArgs -join ' ') failed ($code): $($clean -join ' | ')" }
  return $clean
}

function Get-CurrentBranch { return (Invoke-Git @("branch", "--show-current") | Select-Object -First 1) }
function Get-HeadSha { return (Invoke-Git @("rev-parse", "HEAD") | Select-Object -First 1) }

# ---- GitHub API -----------------------------------------------------------------------------

function Invoke-GitHubApi {
  param([string]$Method = "Get", [string]$Path, $Body)
  $headers = @{ Authorization = "Bearer $(Get-GitHubToken)"; "User-Agent" = "byok-scripts"; Accept = "application/vnd.github+json" }
  $params = @{ Method = $Method; Uri = "https://api.github.com$Path"; Headers = $headers }
  if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Depth 5); $params.ContentType = "application/json" }
  return Invoke-RestMethod @params
}

function Get-CheckRuns([string]$Sha) {
  return @((Invoke-GitHubApi -Path "/repos/$($script:Repo)/commits/$Sha/check-runs").check_runs)
}

# Waits until every required check has finished (or the timeout), and returns the runs.
function Wait-Checks {
  param([string]$Sha, [int]$TimeoutSec = 900)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    $runs = Get-CheckRuns $Sha
    $pending = @($script:RequiredChecks | Where-Object {
      $name = $_
      $run = $runs | Where-Object { $_.name -eq $name } | Select-Object -First 1
      (-not $run) -or ($run.status -ne "completed")
    })
    if (-not $pending.Count) { return $runs }
    Start-Sleep -Seconds 15
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for checks on $Sha (still pending: $($pending -join ', '))"
}

function Get-FailedChecks($Runs) {
  return @($script:RequiredChecks | Where-Object {
    $name = $_
    -not ($Runs | Where-Object { $_.name -eq $name -and $_.conclusion -eq "success" })
  })
}

# ---- SonarCloud (public API, no login) ------------------------------------------------------

# $Selector is "pullRequest=3" or "branch=main".
function Get-SonarGate([string]$Selector) {
  $url = "https://sonarcloud.io/api/qualitygates/project_status?projectKey=$($script:SonarKey)&$Selector"
  return (Invoke-RestMethod $url).projectStatus
}

function Show-SonarIssues([string]$Selector) {
  $url = "https://sonarcloud.io/api/issues/search?componentKeys=$($script:SonarKey)&$Selector&resolved=false&ps=50"
  foreach ($i in (Invoke-RestMethod $url).issues) {
    Write-Bad ("[{0}/{1}] {2} {3}:{4} {5}" -f $i.type, $i.severity, $i.rule, ($i.component -replace '^.*?:', ''), $i.line, $i.message)
  }
}

# ---- local audit ----------------------------------------------------------------------------

function Invoke-Npm([string[]]$NpmArgs) {
  Push-Location $script:ProjectDir
  try {
    & npm @NpmArgs
    if ($LASTEXITCODE -ne 0) { throw "npm $($NpmArgs -join ' ') failed" }
  } finally { Pop-Location }
}

function Get-PackageVersion {
  return (Get-Content (Join-Path $script:ProjectDir "package.json") -Raw | ConvertFrom-Json).version
}

function Assert-ChangelogHasVersion {
  $version = Get-PackageVersion
  $changelog = Get-Content (Join-Path $script:ProjectDir "CHANGELOG.md") -Raw
  if ($changelog -notmatch "(?m)^## $([regex]::Escape($version))\s*$") {
    throw "CHANGELOG.md has no '## $version' section (package.json says $version)"
  }
}

# Refuses to continue if any file that would be committed looks like it holds a secret or personal data.
function Assert-NoSecrets {
  $patterns = @(
    'ghp_[A-Za-z0-9]{20,}', 'github_pat_[A-Za-z0-9_]{20,}', '\bsk-[A-Za-z0-9]{20,}',
    '-----BEGIN [A-Z ]*PRIVATE KEY-----', 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}',
    'Bearer\s+[A-Za-z0-9._-]{30,}'
  )
  $hits = @()
  foreach ($rel in (Invoke-Git @("ls-files", "-co", "--exclude-standard"))) {
    if ($rel -match '\.(png|vsix|zip|ico)$') { continue }
    $path = Join-Path $script:ProjectDir $rel
    if (-not (Test-Path $path -PathType Leaf)) { continue }
    $text = Get-Content $path -Raw -ErrorAction SilentlyContinue
    if (-not $text) { continue }
    foreach ($p in $patterns) { if ($text -match $p) { $hits += "$rel (secret pattern)" } }
    foreach ($s in $script:ForbiddenStrings) { if ($text -match [regex]::Escape($s)) { $hits += "$rel (personal string)" } }
  }
  if ($hits.Count) { throw "Possible secrets or personal data, nothing was committed: $(($hits | Select-Object -Unique) -join '; ')" }
}

# The same checks CI runs, plus the secret scan: install without scripts, test, build and package.
function Invoke-LocalAudit {
  Write-Step "Audit: install without scripts, test, package, scan for secrets"
  Invoke-Npm @("ci", "--ignore-scripts")
  Invoke-Npm @("test")
  Invoke-Npm @("run", "package")
  Assert-NoSecrets
  Assert-ChangelogHasVersion
  Write-Good "audit passed"
}

# ---- Marketplace ----------------------------------------------------------------------------

# Runs the project's own vsce (pinned by package-lock.json), installing dependencies first if needed.
# Returns the exit code; its output goes to the console unless captured by the caller.
function Invoke-Vsce([string[]]$VsceArgs) {
  $entry = Join-Path $script:ProjectDir "node_modules\@vscode\vsce\vsce"
  if (-not (Test-Path $entry)) { Invoke-Npm @("ci", "--ignore-scripts") }
  & node $entry @VsceArgs
  return $LASTEXITCODE
}

# The version live on the Marketplace, or $null when none is published yet.
function Get-MarketplaceVersion {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { $json = Invoke-Vsce @("show", $script:ExtensionId, "--json") 2>$null } finally { $ErrorActionPreference = $previous }
  $text = (@($json | Where-Object { $_ -is [string] }) -join "`n").Trim()
  if (-not $text.StartsWith("{")) { return $null }
  try { return ($text | ConvertFrom-Json).versions[0].version } catch { return $null }
}
