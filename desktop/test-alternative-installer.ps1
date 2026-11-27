param([Parameter(Mandatory)][string]$Installer, [string]$PreviousInstaller)

$ErrorActionPreference = 'Stop'
$setup = (Resolve-Path -LiteralPath $Installer).Path
$installation = Join-Path $env:LOCALAPPDATA 'Programs/Discordo'
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Discordo.lnk'
if ((Test-Path -LiteralPath $installation) -or (Test-Path -LiteralPath $shortcut)) {
  throw 'O teste requer um perfil Windows sem o instalador alternativo.'
}

function Start-Installer($file, $logPath, $updateArgs = '') {
  Start-Process -FilePath $file -ArgumentList "/SP- /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /MERGETASKS=!desktopicon /LOG=`"$logPath`" $updateArgs" -WindowStyle Hidden -PassThru
}

function Confirm-InstallationExit($process) {
  if (!$process.WaitForExit(120000)) {
    $process.Kill()
    throw 'O instalador alternativo não terminou em dois minutos.'
  }
  if ($process.ExitCode -ne 0) { throw "O instalador alternativo retornou $($process.ExitCode)." }
}

$log = Join-Path $env:RUNNER_TEMP 'discordo-alternative-install.log'
$executable = Join-Path $installation 'Discordo.exe'
try {
  if ($PreviousInstaller) {
    Confirm-InstallationExit (Start-Installer (Resolve-Path -LiteralPath $PreviousInstaller).Path $log)
    if ((Get-Item -LiteralPath $executable).VersionInfo.ProductVersion -ne '0.2.1-beta.9') {
      throw 'A versão inicial do teste deve ser a Beta 9.'
    }
    $waiting = Start-Process -FilePath (Join-Path $PSHOME 'pwsh.exe') -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 25' -WindowStyle Hidden -PassThru
    try {
      $updating = Start-Installer $setup $log "/NOCLOSEAPPLICATIONS /DIR=`"$installation`" /DISCORDOWAITPID=$($waiting.Id)"
      Start-Sleep -Seconds 3
      if ($updating.HasExited -or (Get-Item -LiteralPath $executable).VersionInfo.ProductVersion -ne '0.2.1-beta.9') {
        throw 'A atualização não esperou o processo anterior encerrar.'
      }
    } finally {
      if (!$waiting.HasExited) { Stop-Process -Id $waiting.Id }
    }
    Confirm-InstallationExit $updating
    $reopened = Get-Process -Name Discordo -ErrorAction SilentlyContinue | Where-Object Path -eq $executable
    if (!$reopened) { throw 'O instalador não reabriu o Discordo automaticamente.' }
    $reopened | Stop-Process
  } else {
    Confirm-InstallationExit (Start-Installer $setup $log)
  }
  foreach ($file in @($executable, (Join-Path $installation 'resources/app.asar'), (Join-Path $installation 'resources/discordo-inno-installation'), $shortcut)) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Arquivo ausente após a instalação: $file" }
  }
  $shell = New-Object -ComObject WScript.Shell
  if ($shell.CreateShortcut($shortcut).TargetPath -ne $executable) { throw 'O atalho aponta para outra instalação.' }
  $expected = (Get-Content (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json).version
  if ((Get-Item -LiteralPath $executable).VersionInfo.ProductVersion -ne $expected) { throw 'Versão instalada incorreta.' }
  Confirm-InstallationExit (Start-Installer $setup $log)
  if (!(Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'O aplicativo sumiu ao reinstalar.' }
  Write-Output "Instalação e reinstalação alternativas confirmadas para $expected."
} catch {
  if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 50 }
  throw
}
