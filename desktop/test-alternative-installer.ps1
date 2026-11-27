param([Parameter(Mandatory)][string]$Installer)

$ErrorActionPreference = 'Stop'
$setup = (Resolve-Path -LiteralPath $Installer).Path
$installation = Join-Path $env:LOCALAPPDATA 'Programs/Discordo'
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Discordo.lnk'
if ((Test-Path -LiteralPath $installation) -or (Test-Path -LiteralPath $shortcut)) {
  throw 'O teste requer um perfil Windows sem o instalador alternativo.'
}

function Install-Discordo($logPath) {
  $process = Start-Process -FilePath $setup -ArgumentList "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /MERGETASKS=!desktopicon /LOG=`"$logPath`"" -WindowStyle Hidden -PassThru
  if (!$process.WaitForExit(120000)) {
    $process.Kill()
    throw 'O instalador alternativo não terminou em dois minutos.'
  }
  if ($process.ExitCode -ne 0) { throw "O instalador alternativo retornou $($process.ExitCode)." }
}

$log = Join-Path $env:RUNNER_TEMP 'discordo-alternative-install.log'
try {
  Install-Discordo $log
  $executable = Join-Path $installation 'Discordo.exe'
  foreach ($file in @($executable, (Join-Path $installation 'resources/app.asar'), $shortcut)) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Arquivo ausente após a instalação: $file" }
  }
  $shell = New-Object -ComObject WScript.Shell
  if ($shell.CreateShortcut($shortcut).TargetPath -ne $executable) { throw 'O atalho aponta para outra instalação.' }
  $expected = (Get-Content (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json).version
  if ((Get-Item -LiteralPath $executable).VersionInfo.ProductVersion -ne $expected) { throw 'Versão instalada incorreta.' }
  Install-Discordo $log
  if (!(Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'O aplicativo sumiu ao reinstalar.' }
  Write-Output "Instalação e reinstalação alternativas confirmadas para $expected."
} catch {
  if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 50 }
  throw
}
