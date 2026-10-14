# Release the version in package.json: confirm main is green, tag it so the GitHub Release is built,
# then publish that exact .vsix to the VS Code Marketplace using your `az login` (no token stored).
#
#   .\scripts\release-to-marketplace.ps1
#
# -SkipPublish  create the tag and GitHub Release only
param([switch]$SkipPublish)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib.ps1")

function Assert-ReadyToRelease([string]$Version, [string]$Tag) {
  Write-Step "Check that main is clean, current and green"
  if ((Get-CurrentBranch) -ne "main") { throw "Release from the main branch (currently on '$(Get-CurrentBranch)')." }
  if (Invoke-Git @("status", "--porcelain")) { throw "The working tree has uncommitted changes. Run push-to-github first." }
  Invoke-Git @("fetch", "origin", "main", "--tags") -Authenticated | Out-Null
  $head = Get-HeadSha
  $remote = (Invoke-Git @("rev-parse", "origin/main") | Select-Object -First 1)
  if ($head -ne $remote) { throw "Local main ($($head.Substring(0, 7))) differs from origin/main ($($remote.Substring(0, 7))). Push or pull first." }
  if (Invoke-Git @("ls-remote", "--tags", "origin", $Tag) -Authenticated) { throw "Tag $Tag already exists on GitHub. Bump the version first." }
  $live = Get-MarketplaceVersion
  if ($live -eq $Version) { throw "Version $Version is already on the Marketplace. Bump the version first." }

  $runs = Wait-Checks -Sha $head -TimeoutSec 300
  $gate = Get-SonarGate "branch=main"
  if ((Get-FailedChecks $runs).Count -or $gate.status -ne "OK") {
    Show-SonarIssues "branch=main"
    throw "main is not green (Sonar $($gate.status)). Never release on red."
  }
  Write-Good "version $Version (Marketplace has $(if ($live) { $live } else { 'nothing' })), main is green"
}

function Publish-Tag([string]$Tag) {
  Write-Step "Tag $Tag and wait for the GitHub Release"
  Invoke-Git @("tag", $Tag) | Out-Null
  Invoke-Git @("push", "origin", $Tag) -Authenticated | Out-Null
  $deadline = (Get-Date).AddMinutes(10)
  do {
    Start-Sleep -Seconds 15
    $run = (Invoke-GitHubApi -Path "/repos/$($script:Repo)/actions/runs?event=push&per_page=15").workflow_runs |
      Where-Object { $_.head_branch -eq $Tag } | Select-Object -First 1
  } while ((-not $run -or $run.status -ne "completed") -and (Get-Date) -lt $deadline)
  if (-not $run -or $run.conclusion -ne "success") { throw "The release workflow did not succeed for $Tag ($($run.html_url))." }
  return Invoke-GitHubApi -Path "/repos/$($script:Repo)/releases/tags/$Tag"
}

function Get-ReleaseVsix($Release, [string]$Version) {
  $asset = $Release.assets | Where-Object { $_.name -eq "hiventiq-byok-$Version.vsix" } | Select-Object -First 1
  if (-not $asset) { throw "The release has no hiventiq-byok-$Version.vsix asset." }
  $file = Join-Path $env:TEMP $asset.name
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $file -UseBasicParsing
  return $file
}

function Publish-ToMarketplace([string]$VsixPath, [string]$Version) {
  Write-Step "Publish $Version to the Marketplace (az login)"
  $who = & az account show --query user.name -o tsv
  if ($LASTEXITCODE -ne 0 -or -not $who) { throw "Not signed in to az. Run: az login" }
  Write-Host "    signed in as $who"
  $code = Invoke-Vsce @("publish", "--packagePath", $VsixPath, "--azure-credential") | Select-Object -Last 1
  if ($code -ne 0) { throw "vsce publish failed (exit $code)." }
  Write-Step "Wait for the listing to show $Version"
  $deadline = (Get-Date).AddMinutes(6)
  do {
    $live = Get-MarketplaceVersion
    if ($live -eq $Version) { return $true }
    Start-Sleep -Seconds 20
  } while ((Get-Date) -lt $deadline)
  return $false
}

try {
  $version = Get-PackageVersion
  $tag = "v$version"
  Assert-ReadyToRelease $version $tag
  Invoke-LocalAudit
  $release = Publish-Tag $tag
  Write-Good "GitHub Release: $($release.html_url)"
  if ($SkipPublish) { Write-Host "Skipped the Marketplace (-SkipPublish)."; exit 0 }

  $vsix = Get-ReleaseVsix $release $version
  if (Publish-ToMarketplace $vsix $version) {
    Write-Host "Live: https://marketplace.visualstudio.com/items?itemName=$($script:ExtensionId) (version $version)" -ForegroundColor Green
  } else {
    Write-Host "Published, but the listing does not show $version yet. Check again in a few minutes." -ForegroundColor Yellow
  }
} catch {
  Write-Host "STOPPED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
