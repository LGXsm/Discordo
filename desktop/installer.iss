[Setup]
AppId={{B0274519-EFC6-4B75-B486-D7F8B6281C37}
AppName=Discordo
AppVersion={#AppVersion}
AppPublisher=LGXsm
AppPublisherURL=https://discordo.lgmartinez.com/
DefaultDirName={localappdata}\Programs\Discordo
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
SetupIconFile=discordo.ico
UninstallDisplayIcon={app}\Discordo.exe
OutputBaseFilename=Discordo-Instalador-Windows-x64
Compression=lzma2
SolidCompression=yes
RestartApplications=no

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; Flags: unchecked

[Files]
Source: "out\Discordo-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "inno-installation"; DestDir: "{app}\resources"; DestName: "discordo-inno-installation"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Discordo"; Filename: "{app}\Discordo.exe"; AppUserModelID: "com.squirrel.Discordo.Discordo"
Name: "{autodesktop}\Discordo"; Filename: "{app}\Discordo.exe"; AppUserModelID: "com.squirrel.Discordo.Discordo"; Tasks: desktopicon

[Run]
Filename: "{app}\Discordo.exe"; Description: "{cm:LaunchProgram,Discordo}"; Flags: nowait postinstall skipifsilent
Filename: "{app}\Discordo.exe"; Flags: nowait; Check: ShouldRestartDiscordo

[Code]
const
  SynchronizeAccess = $00100000;
  ErrorInvalidParameter = 87;
  WaitObjectSignaled = 0;

var
  RestartDiscordo: Boolean;

function OpenProcess(DesiredAccess, InheritHandle, ProcessId: LongWord): LongWord;
  external 'OpenProcess@kernel32.dll stdcall';
function WaitForSingleObject(Handle, Milliseconds: LongWord): LongWord;
  external 'WaitForSingleObject@kernel32.dll stdcall';
function CloseHandle(Handle: LongWord): LongWord;
  external 'CloseHandle@kernel32.dll stdcall';

function InitializeSetup: Boolean;
var
  UpdatePid: Integer;
  ProcessHandle: LongWord;
  WaitResult: LongWord;
begin
  Result := True;
  UpdatePid := StrToIntDef(ExpandConstant('{param:DISCORDOWAITPID|0}'), 0);
  if UpdatePid <= 0 then Exit;
  ProcessHandle := OpenProcess(SynchronizeAccess, 0, UpdatePid);
  if ProcessHandle = 0 then
    Result := DLLGetLastError = ErrorInvalidParameter
  else begin
    WaitResult := WaitForSingleObject(ProcessHandle, 30000);
    CloseHandle(ProcessHandle);
    Result := WaitResult = WaitObjectSignaled;
  end;
  RestartDiscordo := Result;
  if not Result then Log('Discordo update stopped while waiting for the running app.');
end;

function ShouldRestartDiscordo: Boolean;
begin
  Result := RestartDiscordo;
end;
