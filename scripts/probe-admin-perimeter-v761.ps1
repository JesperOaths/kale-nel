param(
  [string]$PublicHost = 'https://kalenel.nl',
  [string]$AdminHost = 'https://admin.kalenel.nl'
)

$ErrorActionPreference = 'Continue'

function Test-Url {
  param(
    [Parameter(Mandatory=$true)][string]$Url,
    [int]$MaxRedirection = 0
  )
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -MaximumRedirection $MaxRedirection -TimeoutSec 20
    $title = ''
    if ($response.Content) {
      $m = [regex]::Match($response.Content, '<title>(.*?)</title>', 'IgnoreCase')
      if ($m.Success) { $title = $m.Groups[1].Value }
    }
    [pscustomobject]@{
      url = $Url
      ok = $true
      status = [int]$response.StatusCode
      location = [string]$response.Headers.Location
      title = $title
      body_has_admin_html = [bool]($response.Content -match 'Beheerhub|GEJAST_ADMIN|admin-session-sync|jas_admin_session_v8')
      error = ''
    }
  } catch {
    $status = $null
    $location = ''
    if ($_.Exception.Response) {
      try { $status = [int]$_.Exception.Response.StatusCode } catch {}
      try { $location = [string]$_.Exception.Response.Headers.Location } catch {}
    }
    [pscustomobject]@{
      url = $Url
      ok = $false
      status = $status
      location = $location
      title = ''
      body_has_admin_html = $false
      error = $_.Exception.Message
    }
  }
}

$dns = try {
  Resolve-DnsName admin.kalenel.nl -ErrorAction Stop | Select-Object Name,Type,NameHost,IPAddress
} catch {
  [pscustomobject]@{ Name='admin.kalenel.nl'; Type='ERROR'; NameHost=''; IPAddress=''; Error=$_.Exception.Message }
}

$urls = @(
  "$AdminHost/admin.html",
  "$PublicHost/admin.html",
  "$PublicHost/admin-session-sync.js?v761",
  "$PublicHost/gejast-admin-rpc.js?v761",
  "$PublicHost/boerenbridge_vault.html",
  "$PublicHost/toepen_vault.html",
  "$PublicHost/vault.html",
  "$PublicHost/home.html",
  "$PublicHost/login.html",
  "$PublicHost/activate.html",
  "$PublicHost/request.html",
  "$PublicHost/index.html",
  "$PublicHost/paardenrace.html",
  "$PublicHost/toepen.html"
)

[pscustomobject]@{
  checked_at = (Get-Date).ToUniversalTime().ToString('o')
  dns = $dns
  urls = @($urls | ForEach-Object { Test-Url -Url $_ })
} | ConvertTo-Json -Depth 8
