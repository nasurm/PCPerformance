$ErrorActionPreference='Stop'
$address='http://127.0.0.1:3030'
try {
  $existing=Invoke-RestMethod "$address/api/bootstrap" -TimeoutSec 2
  if($existing.token -and $existing.catalog) {Start-Process $address;exit 0}
} catch {}
$node=Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath=if($node){$node.Source}else{Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'}
if(!(Test-Path -LiteralPath $nodePath)){throw 'Node.js 20 or newer is required. Install Node.js, then run Start Radar.cmd again.'}
New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'data') | Out-Null
$process=Start-Process -FilePath $nodePath -ArgumentList ('"'+(Join-Path $PSScriptRoot 'server.js')+'"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PSScriptRoot 'radar.log') -RedirectStandardError (Join-Path $PSScriptRoot 'radar-error.log')
$process.Id | Set-Content (Join-Path $PSScriptRoot 'data\server.pid')
for($attempt=0;$attempt -lt 20;$attempt++) {
  Start-Sleep -Milliseconds 500
  try { $ready=Invoke-RestMethod "$address/api/bootstrap" -TimeoutSec 2; if($ready.token){Start-Process $address;exit 0} } catch {}
}
throw 'Radar did not start. Check radar-error.log in this folder.'
