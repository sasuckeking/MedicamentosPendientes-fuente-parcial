; Instalador único (Inno Setup 6). ESTADO: escrito, NO compilado. Los directorios build\* los prepara el flujo de compilación.
#define AppName "Medicamentos Pendientes"
#define AppVer  "0.1.0"
[Setup]
AppId={{6B3F6C1E-7D2A-4E0B-9C55-5A1D0F3A9E21}
AppName={#AppName}
AppVersion={#AppVer}
DefaultDirName={autopf}\MedicamentosPendientes
DefaultGroupName={#AppName}
OutputBaseFilename=MedicamentosPendientes-Instalador
OutputDir=..\salida
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
PrivilegesRequired=admin
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\cliente\MedicamentosPendientes.exe
[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"
[Files]
Source: "..\build\cliente\*"; DestDir: "{app}\cliente"; Flags: recursesubdirs ignoreversion
Source: "..\build\node\*"; DestDir: "{app}\node"; Flags: recursesubdirs ignoreversion; Check: EsPrincipal
Source: "..\build\server\*"; DestDir: "{app}\server"; Flags: recursesubdirs ignoreversion; Check: EsPrincipal
Source: "..\shared\*"; DestDir: "{app}\shared"; Flags: ignoreversion; Check: EsPrincipal
Source: "..\db\*"; DestDir: "{app}\db"; Flags: recursesubdirs ignoreversion; Check: EsPrincipal
Source: "scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion; Check: EsPrincipal
Source: "..\build\servicio\*"; DestDir: "{app}\servicio"; Flags: ignoreversion; Check: EsPrincipal
Source: "..\build\redist\postgresql-16-x64.exe"; DestDir: "{app}\redist"; Flags: ignoreversion deleteafterinstall; Check: EsPrincipal
[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\cliente\MedicamentosPendientes.exe"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\cliente\MedicamentosPendientes.exe"
[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\instalar-servidor.ps1"" -AppDir ""{app}"""; Flags: runhidden waituntilterminated; StatusMsg: "Configurando la base de datos y el servidor (puede tardar varios minutos)..."; Check: EsPrincipal
Filename: "{app}\cliente\MedicamentosPendientes.exe"; Description: "Abrir {#AppName}"; Flags: nowait postinstall skipifsilent
[UninstallRun]
Filename: "{app}\servicio\MedPendApi.exe"; Parameters: "stop"; Flags: runhidden; RunOnceId: "StopSvc"
Filename: "{app}\servicio\MedPendApi.exe"; Parameters: "uninstall"; Flags: runhidden; RunOnceId: "RmSvc"
Filename: "schtasks.exe"; Parameters: "/Delete /F /TN ""MedPend Respaldo"""; Flags: runhidden; RunOnceId: "RmTask"
[Code]
var TipoPage: TInputOptionWizardPage;
procedure InitializeWizard;
begin
  TipoPage := CreateInputOptionPage(wpSelectDir, 'Tipo de instalación', '¿Para qué se usará esta computadora?',
    'Elija una opción:', True, False);
  TipoPage.Add('Computadora principal (guarda los datos de la farmacia)');
  TipoPage.Add('Computadora adicional (se conecta a la principal)');
  TipoPage.SelectedValueIndex := 0;
end;
function EsPrincipal: Boolean;
begin
  Result := (TipoPage = nil) or (TipoPage.SelectedValueIndex = 0);
end;
function InitializeSetup: Boolean;
begin
  Result := True;
  if not IsWin64 then begin MsgBox('Este programa requiere Windows 10 u 11 de 64 bits.', mbError, MB_OK); Result := False; end;
end;
{ Los datos (ProgramData\MedicamentosPendientes y la base de datos) NO se borran al desinstalar. }
