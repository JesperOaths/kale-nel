param(
  [Parameter(Mandatory=$true)]
  [string]$TargetRepo
)

$bundleRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoOverlay = Join-Path $bundleRoot 'repo'

if (!(Test-Path -LiteralPath $repoOverlay)) {
  throw "Overlay folder not found: $repoOverlay"
}

if (!(Test-Path -LiteralPath $TargetRepo)) {
  throw "Target repo not found: $TargetRepo"
}

$resolvedTarget = (Resolve-Path -LiteralPath $TargetRepo).Path
Write-Host "Applying overlay from $repoOverlay"
Write-Host "Into target repo $resolvedTarget"

Get-ChildItem -LiteralPath $repoOverlay -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($repoOverlay.Length).TrimStart('\')
  $dest = Join-Path $resolvedTarget $relative
  $destDir = Split-Path -Parent $dest
  if (!(Test-Path -LiteralPath $destDir)) {
    New-Item -ItemType Directory -Path $destDir | Out-Null
  }
  Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
}

Write-Host "Overlay applied."
