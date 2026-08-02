param(
  [string]$PublicHost = 'https://kalenel.nl',
  [string]$AdminHost = 'https://admin.kalenel.nl'
)

$ErrorActionPreference = 'Continue'

function Test-Url {
  param(
    [Parameter(Mandatory=$true)][string]$Url,
    [int]$MaxRedirection = 0,
    [string]$Cookie = ''
  )
  try {
    $headers = @{}
    if ($Cookie) { $headers.Cookie = $Cookie }
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -MaximumRedirection $MaxRedirection -TimeoutSec 20 -Headers $headers
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
      worker_gate = [string]$response.Headers['X-Kalenel-Admin-Gate']
      fail_closed = [string]$response.Headers['X-Kalenel-Fail-Closed']
      cache_control = [string]$response.Headers['Cache-Control']
      body_has_admin_html = [bool]($response.Content -match 'Beheerhub|GEJAST_ADMIN|admin-session-sync|jas_admin_session_v8')
      body_has_worker_login = [bool]($response.Content -match 'Admin login vereist|GitHub')
      error = ''
    }
  } catch {
    $status = $null
    $location = ''
    $headers = $null
    if ($_.Exception.Response) {
      try { $status = [int]$_.Exception.Response.StatusCode } catch {}
      try { $location = [string]$_.Exception.Response.Headers.Location } catch {}
      try { $headers = $_.Exception.Response.Headers } catch {}
    }
    [pscustomobject]@{
      url = $Url
      ok = $false
      status = $status
      location = $location
      title = ''
      worker_gate = if ($headers) { [string]$headers['X-Kalenel-Admin-Gate'] } else { '' }
      fail_closed = if ($headers) { [string]$headers['X-Kalenel-Fail-Closed'] } else { '' }
      cache_control = if ($headers) { [string]$headers['Cache-Control'] } else { '' }
      body_has_admin_html = $false
      body_has_worker_login = $false
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
  "$AdminHost/",
  "$AdminHost/admin.html",
  "$AdminHost/admin.js",
  "$AdminHost/login?return_to=/admin.html",
  "$AdminHost/oauth/callback?state=replay-or-mismatch&code=fake",
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
  expected_admin_outer_gate = 'Cloudflare Workers Free GitHub OAuth gate; no Cloudflare Zero Trust billing activation'
  dns = $dns
  urls = @($urls | ForEach-Object { Test-Url -Url $_ })
  tampered_cookie = Test-Url -Url "$AdminHost/admin.html" -Cookie '__Host-kalenel_admin_session=tampered.cookie'
} | ConvertTo-Json -Depth 8
