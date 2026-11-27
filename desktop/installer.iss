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

[Icons]
Name: "{autoprograms}\Discordo"; Filename: "{app}\Discordo.exe"; AppUserModelID: "com.squirrel.Discordo.Discordo"
Name: "{autodesktop}\Discordo"; Filename: "{app}\Discordo.exe"; AppUserModelID: "com.squirrel.Discordo.Discordo"; Tasks: desktopicon

[Run]
Filename: "{app}\Discordo.exe"; Description: "{cm:LaunchProgram,Discordo}"; Flags: nowait postinstall skipifsilent
