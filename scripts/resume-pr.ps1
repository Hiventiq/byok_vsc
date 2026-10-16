# Resume push-to-github.ps1 on a pull request it left open: after a fix was pushed to the
# PR branch, wait for the tests and SonarCloud on the new head, squash-merge when green, and
# confirm main is green. Same helpers and rules as push-to-github.ps1 (never merges on red).
param(
  [Parameter(Mandatory)][int]$Number,
  [string]$Trailer
)
. (Join-Path $PSScriptRoot 'lib.ps1')
$local = Join-Path $PSScriptRoot 'local.ps1'
if (Test-Path $local) { . $local }

try {
  $pr = Invoke-GitHubApi -Method Get -Path "/repos/$($script:Repo)/pulls/$Number"
  $sha = $pr.head.sha
  Write-Step "PR #$Number ($($pr.head.ref)) head $($sha.Substring(0, 7))"
  Write-Step "Wait for the tests and SonarCloud on the pull request"
  $runs = Wait-Checks -Sha $sha
  foreach ($r in $runs) { Write-Host ("    {0}: {1}" -f $r.name, $r.conclusion) }
  $failed = Get-FailedChecks $runs
  $gate = Get-SonarGate "pullRequest=$Number"
  Write-Host "    Sonar quality gate: $($gate.status)"
  if ($failed.Count -or $gate.status -ne "OK") {
    Write-Bad "NOT green (failed: $($failed -join ', ')). Sonar findings on the PR:"
    Show-SonarIssues "pullRequest=$Number"
    Write-Host "Left PR #$Number open: $($pr.html_url)"
    exit 1
  }
  Write-Step "Merge (squash) and clean up"
  $body = @{ merge_method = "squash"; sha = $sha; commit_title = "$($pr.title) (#$Number)" }
  if ($Trailer) { $body.commit_message = $Trailer }
  $merged = Invoke-GitHubApi -Method Put -Path "/repos/$($script:Repo)/pulls/$Number/merge" -Body $body
  try { Invoke-GitHubApi -Method Delete -Path "/repos/$($script:Repo)/git/refs/heads/$($pr.head.ref)" | Out-Null } catch { Write-Host "    (remote branch kept)" }
  Invoke-Git @("checkout", "main") | Out-Null
  Invoke-Git @("pull", "--ff-only", "origin", "main") -Authenticated | Out-Null
  Invoke-Git @("branch", "-D", $pr.head.ref) -AllowFail | Out-Null
  Write-Step "Confirm main is green"
  $runs = Wait-Checks -Sha $merged.sha
  $gate = Get-SonarGate "branch=main"
  $failed = Get-FailedChecks $runs
  if ($failed.Count -or $gate.status -ne "OK") {
    Write-Bad "main is RED (failed: $($failed -join ', '); Sonar $($gate.status)). Fix forward; do not release."
    Show-SonarIssues "branch=main"
    exit 1
  }
  Write-Good "main is green: tests pass, Sonar gate OK"
  Write-Host "Done: main is at $($merged.sha.Substring(0, 7))." -ForegroundColor Green
} catch {
  Write-Host "STOPPED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
