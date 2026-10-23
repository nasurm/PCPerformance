param([string]$NodeVersion='24.21.0')
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
$build=Join-Path $project 'build'
$download=Join-Path $build 'downloads'
$package=Join-Path $build 'PC Radar'
$dist=Join-Path $project 'dist'
New-Item -ItemType Directory -Force -Path $download,$package,$dist | Out-Null
$archive="node-v$NodeVersion-win-x64.zip"
$cached=Join-Path $download $archive
$base="https://nodejs.org/dist/v$NodeVersion"
if(!(Test-Path -LiteralPath $cached)){Invoke-WebRequest "$base/$archive" -OutFile $cached}
$checks=(Invoke-WebRequest "$base/SHASUMS256.txt").Content
$expected=($checks -split "`n" | Where-Object {$_ -match ([regex]::Escape($archive)+'\s*$')}) -split '\s+'
if(!$expected -or (Get-FileHash -LiteralPath $cached -Algorithm SHA256).Hash -ne $expected[0]){throw 'Node.js archive checksum verification failed.'}
Expand-Archive -LiteralPath $cached -DestinationPath $download -Force
$nodeRoot=Join-Path $download "node-v$NodeVersion-win-x64"
New-Item -ItemType Directory -Force -Path (Join-Path $package 'runtime'),(Join-Path $package 'app'),(Join-Path $package 'data') | Out-Null
Copy-Item -LiteralPath (Join-Path $nodeRoot 'node.exe'),(Join-Path $nodeRoot 'LICENSE') -Destination (Join-Path $package 'runtime') -Force
foreach($file in @('server.js','benchmarks.js','scan.ps1','publisher-requirements.json')){Copy-Item -LiteralPath (Join-Path $project $file) -Destination (Join-Path $package 'app') -Force}
Copy-Item -LiteralPath (Join-Path $project 'public') -Destination (Join-Path $package 'app') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.txt') -Destination $package -Force
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll ('/out:'+(Join-Path $package 'PC Radar.exe')) (Join-Path $PSScriptRoot 'Launcher.cs')
if($LASTEXITCODE -ne 0){throw 'Launcher compilation failed.'}
if(@(Get-ChildItem -LiteralPath (Join-Path $package 'data') -Force).Count){throw 'Package data must be empty. Build in a clean staging folder.'}
$zip=Join-Path $dist 'PC-Radar-Portable-Windows-x64.zip'
Compress-Archive -LiteralPath $package -DestinationPath $zip -CompressionLevel Optimal -Force
$hash=Get-FileHash -LiteralPath $zip -Algorithm SHA256
($hash.Hash+'  '+(Split-Path $zip -Leaf)) | Set-Content (Join-Path $dist 'SHA256.txt')
Write-Output $zip
Write-Output ('ZIP size: '+[math]::Round((Get-Item $zip).Length/1MB,1)+' MB')
