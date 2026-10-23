$ErrorActionPreference='Stop'
$pidFile=Join-Path $PSScriptRoot 'data\server.pid'
if(Test-Path -LiteralPath $pidFile) {
  $radarProcessId=[int](Get-Content -LiteralPath $pidFile)
  $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$radarProcessId"
  $expectedScript=Join-Path $PSScriptRoot 'server.js'
  if($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine.Contains($expectedScript)) {Stop-Process -Id $radarProcessId;Remove-Item -LiteralPath $pidFile;Write-Host 'PC Radar stopped.'}
  else {Write-Host 'No matching PC Radar process found.'}
} else {Write-Host 'No saved server process. If started in a terminal, use Ctrl+C there.'}
