param([Parameter(Mandatory)][string]$Installer)

$ErrorActionPreference = 'Stop'
$setup = (Resolve-Path -LiteralPath $Installer).Path
$installation = Join-Path $env:LOCALAPPDATA 'Discordo'
if (Test-Path -LiteralPath $installation) {
  throw 'O teste requer um perfil Windows sem o Discordo instalado.'
}

$started = Get-Date
try {
  $process = Start-Process -FilePath $setup -ArgumentList '--silent' -WindowStyle Hidden -PassThru
  if (!$process.WaitForExit(120000)) {
    $process.Kill()
    throw 'O instalador não terminou em dois minutos.'
  }
  if ($process.ExitCode -ne 0) {
    throw "O instalador retornou $($process.ExitCode)."
  }
  $versions = @(Get-ChildItem -LiteralPath $installation -Directory -Filter 'app-*')
  if ($versions.Count -ne 1) { throw 'Esperada uma única instalação.' }
  foreach ($file in @('Discordo.exe', 'resources/app.asar')) {
    if (!(Test-Path -LiteralPath (Join-Path $versions[0].FullName $file) -PathType Leaf)) {
      throw "Arquivo ausente na instalação: $file"
    }
  }
  $expectedVersion = (Get-Content (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json).version
  $actualVersion = (Get-Item -LiteralPath (Join-Path $versions[0].FullName 'Discordo.exe')).VersionInfo.ProductVersion
  if ($actualVersion -ne $expectedVersion) { throw "Versão instalada: $actualVersion, esperada: $expectedVersion" }
  $startMenu = [Environment]::GetFolderPath('Programs')
  $shortcut = Join-Path $startMenu 'LGXsm/Discordo.lnk'
  if (!(Test-Path -LiteralPath $shortcut -PathType Leaf)) { throw 'O atalho do Menu Iniciar não foi criado.' }
  Write-Output "Instalação limpa confirmada para $actualVersion."
} catch {
  foreach ($folder in @((Join-Path $env:LOCALAPPDATA 'SquirrelTemp'), $installation)) {
    Get-ChildItem -LiteralPath $folder -Filter 'Squirrel*.log' -ErrorAction SilentlyContinue |
      Where-Object LastWriteTime -ge $started | ForEach-Object { Get-Content -LiteralPath $_.FullName -Tail 60 }
  }
  throw
}
