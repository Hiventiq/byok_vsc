# Audit the working tree, then land it on main through a pull request that must pass the tests
# and SonarCloud. Nothing reaches main unless every required check is green.
#
#   .\scripts\push-to-github.ps1 -Message "Short summary of the change"
#
# -Trailer  an extra trailer line for the commit, e.g. "Co-Authored-By: Name <email>"
# -NoMerge  open the pull request and report the checks, but do not merge
# -ReadmeUnchanged "<why>"  attest that README.md was reviewed against this change and needs
#           no update. Without it, a change that leaves README.md untouched is refused
#           (hive REQ-ROOT-DOC-001: a push carries a reviewed README).
param(
  [Parameter(Mandatory)][string]$Message,
  [string]$Branch,
  [string]$Trailer,
  [switch]$NoMerge,
  [string]$ReadmeUnchanged
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib.ps1")

function New-CommitMessageFile([string]$Text, [string]$TrailerLine) {
  $body = if ($TrailerLine) { "$Text`n`n$TrailerLine`n" } else { "$Text`n" }
  $file = Join-Path $env:TEMP "byok-commit-$([guid]::NewGuid().ToString('N')).txt"
  [IO.File]::WriteAllText($file, $body, (New-Object Text.UTF8Encoding($false)))
  return $file
}

function Publish-Branch([string]$Name, [string]$Text, [string]$TrailerLine) {
  Write-Step "Commit and push branch $Name"
  Invoke-Git @("checkout", "-b", $Name) | Out-Null
  Invoke-Git @("add", "-A") | Out-Null
  Write-Host (Invoke-Git @("diff", "--cached", "--name-status") | Out-String)
  $file = New-CommitMessageFile $Text $TrailerLine
  try { Invoke-Git @("commit", "-q", "-F", $file) | Out-Null } finally { Remove-Item $file -ErrorAction SilentlyContinue }
  Invoke-Git @("push", "-u", "origin", $Name) -Authenticated | Out-Null
}

function New-PullRequest([string]$Name, [string]$Text) {
  Write-Step "Open the pull request"
  $title = ($Text -split "`n")[0]
  $pr = Invoke-GitHubApi -Method Post -Path "/repos/$($script:Repo)/pulls" -Body @{
    title = $title; head = $Name; base = "main"; body = "Opened by scripts/push-to-github.ps1. Merges only when the tests and SonarCloud pass."
  }
  Write-Good "PR #$($pr.number): $($pr.html_url)"
  return $pr
}

# True only when every required check succeeded and Sonar's quality gate is OK for the pull request.
function Test-PullRequestGreen($Pr, [string]$Sha) {
  Write-Step "Wait for the tests and SonarCloud on the pull request"
  $runs = Wait-Checks -Sha $Sha
  foreach ($r in $runs) { Write-Host ("    {0}: {1}" -f $r.name, $r.conclusion) }
  $failed = Get-FailedChecks $runs
  $gate = Get-SonarGate "pullRequest=$($Pr.number)"
  Write-Host "    Sonar quality gate: $($gate.status)"
  if ($failed.Count -or $gate.status -ne "OK") {
    Write-Bad "NOT green (failed: $($failed -join ', ')). Sonar findings on the PR:"
    Show-SonarIssues "pullRequest=$($Pr.number)"
    return $false
  }
  return $true
}

function Merge-PullRequest($Pr, [string]$Sha, [string]$Text, [string]$TrailerLine) {
  Write-Step "Merge (squash) and clean up"
  $title = ($Text -split "`n")[0]
  $body = @{ merge_method = "squash"; sha = $Sha; commit_title = "$title (#$($Pr.number))" }
  if ($TrailerLine) { $body.commit_message = $TrailerLine }
  $merged = Invoke-GitHubApi -Method Put -Path "/repos/$($script:Repo)/pulls/$($Pr.number)/merge" -Body $body
  try { Invoke-GitHubApi -Method Delete -Path "/repos/$($script:Repo)/git/refs/heads/$($Pr.head.ref)" | Out-Null } catch { Write-Host "    (remote branch kept)" }
  Invoke-Git @("checkout", "main") | Out-Null
  Invoke-Git @("pull", "--ff-only", "origin", "main") -Authenticated | Out-Null
  Invoke-Git @("branch", "-D", $Pr.head.ref) -AllowFail | Out-Null
  return $merged.sha
}

function Confirm-MainGreen([string]$Sha) {
  Write-Step "Confirm main is green"
  $runs = Wait-Checks -Sha $Sha
  $gate = Get-SonarGate "branch=main"
  $failed = Get-FailedChecks $runs
  if ($failed.Count -or $gate.status -ne "OK") {
    Write-Bad "main is RED (failed: $($failed -join ', '); Sonar $($gate.status)). Fix forward; do not release."
    Show-SonarIssues "branch=main"
    return $false
  }
  Write-Good "main is green: tests pass, Sonar gate OK"
  return $true
}

try {
  if ((Get-CurrentBranch) -ne "main") { throw "Run this from the main branch (currently on '$(Get-CurrentBranch)')." }
  if (-not (Invoke-Git @("status", "--porcelain"))) { Write-Host "Nothing to push: the working tree has no changes."; exit 0 }

  Invoke-LocalAudit -ReadmeUnchanged $ReadmeUnchanged
  if (-not $Branch) { $Branch = "update/$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
  Publish-Branch $Branch $Message $Trailer
  $sha = Get-HeadSha
  $pr = New-PullRequest $Branch $Message

  if (-not (Test-PullRequestGreen $pr $sha)) { Write-Host "Left PR #$($pr.number) open: $($pr.html_url)"; exit 1 }
  if ($NoMerge) { Write-Host "All green. Not merged (-NoMerge): $($pr.html_url)"; exit 0 }

  $mergeSha = Merge-PullRequest $pr $sha $Message $Trailer
  if (-not (Confirm-MainGreen $mergeSha)) { exit 1 }
  Write-Host "Done: main is at $($mergeSha.Substring(0, 7))." -ForegroundColor Green
} catch {
  Write-Host "STOPPED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
