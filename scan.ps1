param([ValidateSet('system','games')][string]$Mode='system', [string]$ExtraRoots='W10=')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$warnings = [System.Collections.Generic.List[string]]::new()
function Read-Cim($class) {
  try { @(Get-CimInstance $class -ErrorAction Stop) } catch { $warnings.Add("Cannot read ${class}: $($_.Exception.Message)"); @() }
}
if($Mode -eq 'system') {
  $cpu = @(Read-Cim 'Win32_Processor' | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,SocketDesignation)
  $gpu = @(Read-Cim 'Win32_VideoController' | Select-Object Name,DriverVersion,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate,@{n='vramGB';e={$null}},@{n='vramSource';e={'Unknown'}})
  try {
    $smi=Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    if(!$smi -and (Test-Path "$env:WINDIR\System32\nvidia-smi.exe")) { $smi=Get-Item "$env:WINDIR\System32\nvidia-smi.exe" }
    if($smi) {
      $exe=if($smi.Source){$smi.Source}else{$smi.FullName}
      $lines = & $exe --query-gpu=name,memory.total --format=csv,noheader,nounits 2>$null
      foreach($line in $lines) { $parts=$line -split ','; foreach($g in $gpu) { if($g.Name.Trim() -eq $parts[0].Trim()) { $g.vramGB=[math]::Round([double]$parts[1]/1024,1); $g.vramSource='NVIDIA driver' } } }
    }
  } catch { $warnings.Add('Dedicated GPU memory could not be read from the NVIDIA driver.') }
  # AdapterRAM is a 32-bit field; never use it for modern VRAM sizes.
  $memory=@(Read-Cim 'Win32_PhysicalMemory' | Select-Object Manufacturer,PartNumber,Capacity,Speed,ConfiguredClockSpeed,DeviceLocator,SMBIOSMemoryType)
  $os=@(Read-Cim 'Win32_OperatingSystem' | Select-Object Caption,Version,BuildNumber,OSArchitecture,TotalVisibleMemorySize,FreePhysicalMemory)
  $board=@(Read-Cim 'Win32_BaseBoard' | Select-Object Manufacturer,Product)
  $bios=@(Read-Cim 'Win32_BIOS' | Select-Object Manufacturer,SMBIOSBIOSVersion)
  $system=@(Read-Cim 'Win32_ComputerSystem' | Select-Object Manufacturer,Model,TotalPhysicalMemory,PCSystemType)
  $disks=@(Read-Cim 'Win32_LogicalDisk' | Where-Object DriveType -eq 3 | Select-Object DeviceID,VolumeName,Size,FreeSpace)
  $physical=@(); try { $physical=@(Get-PhysicalDisk | Select-Object FriendlyName,MediaType,BusType,Size,HealthStatus) } catch { $warnings.Add('Physical storage type is unavailable.') }
  foreach($drive in $disks) {
    $media=$null; $bus=$null
    try {
      $partition=Get-Partition -DriveLetter $drive.DeviceID.Substring(0,1) -ErrorAction Stop
      $disk=Get-Disk -Number $partition.DiskNumber -ErrorAction Stop
      $bus=[string]$disk.BusType
      $match=@(Get-PhysicalDisk | Where-Object { $_.DeviceId -eq [string]$disk.Number })
      if($match.Count -eq 1){$media=[string]$match[0].MediaType}
    } catch {}
    $drive | Add-Member -NotePropertyName MediaType -NotePropertyValue $media
    $drive | Add-Member -NotePropertyName BusType -NotePropertyValue $bus
  }
  [PSCustomObject]@{cpu=$cpu;gpus=$gpu;memory=$memory;os=$os;board=$board;bios=$bios;computer=$system;disks=$disks;physicalDisks=$physical;warnings=@($warnings);scannedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 6 -Compress
  exit
}
$found=[System.Collections.Generic.List[object]]::new()
$roots=[System.Collections.Generic.List[string]]::new()
function Add-Game($name,$platform,$id,$location,$size=0,$evidence='manifest') {
  if($name -match '^(Unreal Engine|Quixel Bridge|Fab UE Plugin|Steamworks Common Redistributables|Steam Linux Runtime|Proton|DirectX|Microsoft Visual C\+\+)') {return}
  if($name -and $location -and (Test-Path -LiteralPath $location -PathType Container)) { $found.Add([PSCustomObject]@{name=$name;platform=$platform;id="$id";path=$location;size=$size;evidence=$evidence}) }
}
foreach($key in @('HKCU:\Software\Valve\Steam','HKLM:\SOFTWARE\WOW6432Node\Valve\Steam','HKLM:\SOFTWARE\Valve\Steam')) {
  $v=Get-ItemProperty $key -ErrorAction SilentlyContinue
  foreach($p in @($v.SteamPath,$v.InstallPath)) { if($p -and (Test-Path -LiteralPath $p)) {$roots.Add($p)} }
}
foreach($p in @("${env:ProgramFiles(x86)}\Steam","$env:ProgramFiles\Steam")) {if(Test-Path -LiteralPath $p){$roots.Add($p)}}
$custom=@(); try { $custom=@([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ExtraRoots)) | ConvertFrom-Json) } catch { $warnings.Add('Extra library folders could not be read.') }
$custom=@($custom | Where-Object {$_ -is [string] -and $_.Length -gt 0})
foreach($p in $custom) { if(Test-Path -LiteralPath $p -PathType Container){$roots.Add($p)}else{$warnings.Add("Library folder unavailable: $p")} }
foreach($root in @($roots.ToArray())) {
  $vdf=Join-Path $root 'steamapps\libraryfolders.vdf'
  if(Test-Path -LiteralPath $vdf) { foreach($m in [regex]::Matches((Get-Content -LiteralPath $vdf -Raw),'"path"\s+"([^"]+)"')) { $roots.Add($m.Groups[1].Value.Replace('\\','\')) } }
}
foreach($root in ($roots | Select-Object -Unique)) {
  $apps=Join-Path $root 'steamapps'
  if((Split-Path $root -Leaf) -eq 'steamapps') {$apps=$root}
  foreach($file in @(Get-ChildItem -LiteralPath $apps -Filter 'appmanifest_*.acf' -ErrorAction SilentlyContinue)) {
    try {
      $t=Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
      $name=[regex]::Match($t,'"name"\s+"([^"]+)"').Groups[1].Value
      $id=[regex]::Match($t,'"appid"\s+"(\d+)"').Groups[1].Value
      $dir=[regex]::Match($t,'"installdir"\s+"([^"]+)"').Groups[1].Value
      $size=[regex]::Match($t,'"SizeOnDisk"\s+"(\d+)"').Groups[1].Value
      if($dir) { Add-Game $name 'Steam' $id (Join-Path $apps "common\$dir") ([long]"0$size") }
    } catch {$warnings.Add("Could not read Steam manifest: $($file.Name)")}
  }
}
$epic="$env:ProgramData\Epic\EpicGamesLauncher\Data\Manifests"
foreach($file in @(Get-ChildItem -LiteralPath $epic -Filter '*.item' -ErrorAction SilentlyContinue)) {
  try { $j=Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json; if(!$j.bIsIncompleteInstall) { Add-Game $j.DisplayName 'Epic Games' '' $j.InstallLocation $j.InstallSize } } catch {$warnings.Add("Could not read Epic manifest: $($file.Name)")}
}
foreach($base in @('HKLM:\SOFTWARE\GOG.com\Games','HKLM:\SOFTWARE\WOW6432Node\GOG.com\Games')) {
  foreach($key in @(Get-ChildItem $base -ErrorAction SilentlyContinue)) { $g=Get-ItemProperty $key.PSPath; Add-Game $g.gameName 'GOG' '' $g.path }
}
foreach($base in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')) {
  foreach($key in @(Get-ChildItem $base -ErrorAction SilentlyContinue)) {
    $g=Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
    if($g.InstallLocation -and $g.DisplayName -and $g.Publisher -match 'Ubisoft|Electronic Arts|Blizzard|Riot Games' -and $g.DisplayName -notmatch 'Launcher|Connect|Anti.?Cheat|Battle.net|EA app') { Add-Game $g.DisplayName $g.Publisher '' $g.InstallLocation 0 'launcher registry' }
  }
}
foreach($drive in @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' -ErrorAction SilentlyContinue)) {
  foreach($folder in @(Get-ChildItem -LiteralPath "$($drive.DeviceID)\XboxGames" -Directory -ErrorAction SilentlyContinue)) {
    if(Test-Path -LiteralPath (Join-Path $folder.FullName 'Content\MicrosoftGame.config')) { Add-Game $folder.Name 'Xbox' '' $folder.FullName 0 'Xbox config' }
  }
}
foreach($root in $custom) {
  if(!(Test-Path -LiteralPath (Join-Path $root 'steamapps'))) {
    foreach($folder in @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
      if(@(Get-ChildItem -LiteralPath $folder.FullName -Filter '*.exe' -File -ErrorAction SilentlyContinue).Count) { Add-Game $folder.Name 'Custom folder' '' $folder.FullName 0 'Unverified game folder' }
    }
  }
}
$warnings.Add('Portable games, protected Microsoft Store packages, and some launcher layouts may need an extra library folder or a manual entry. Folder candidates are not verified games.')
[PSCustomObject]@{games=@($found | Sort-Object path -Unique | Sort-Object name);warnings=@($warnings);scannedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 5 -Compress
