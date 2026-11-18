; VisHeart installer (Inno Setup 6.5.2 or later). Built by make-installer.ps1, which passes:
;   /DVariant=Full|Update  /DAppVersion=<VERSION>  /DStagingDir=<build drive>:\vh-staging>  [/DPackDir=<training pack>]
; Full installs the app, models and the UNet Extend Training data pack; Update installs the app and models only.
; Both share one AppId, so a newer installer upgrades an existing install in place.

#if Ver < EncodeVer(6, 5, 2)
  #error Inno Setup 6.5.2 or later is needed (older versions cannot build installers over 2 GB).
#endif
#ifndef Variant
  #define Variant "Update"
#endif
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef StagingDir
  #define StagingDir "out\staging"
#endif
#if Variant == "Full"
  #ifndef PackDir
    #error A Full installer needs /DPackDir=<folder of the training data pack>
  #endif
#endif

#define AppSub "cardiac-component-segmentation-ai"
#define Deploy AppSub + "\visheart-local-deployment"

[Setup]
; Keep this AppId forever: it is how Windows knows a new installer is an update of VisHeart.
AppId={{CA49167C-4A63-4EEF-BCDA-6CCFB0BA99E5}
AppName=VisHeart
AppVersion={#AppVersion}
AppVerName=VisHeart {#AppVersion}
AppPublisher=VisHeart team
DefaultDirName=C:\VisHeart
; New installs may choose the folder (another drive when C: is full); an update keeps the installed folder.
DisableDirPage=auto
DefaultGroupName=VisHeart
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
; The Full installer is larger than one file may be, so it is split into VisHeart-Full-<version>-*.bin slices
; that must stay next to the .exe.
DiskSpanning=yes
Compression=lzma2/fast
SolidCompression=no
OutputDir=out
OutputBaseFilename=VisHeart-{#Variant}-{#AppVersion}
UninstallDisplayName=VisHeart
WizardStyle=modern
; Larger than the default, so the login and the next steps on the finish page are easy to read.
WizardSizePercent=130
SetupLogging=yes
CloseApplications=no

[Dirs]
; Bind-mounted by docker-compose.yml; the UNet Extend Training service reads exports from here.
Name: "{app}\{#AppSub}\Cardiac_Segmentation_FYP_Server\dist\temp_exports"; Flags: uninsneveruninstall

[Files]
; unet.pth is UNet Extend Training's registered original: the training data checks it by hash, so an install never
; replaces one that is already there (versions.py never rewrites it either).
Source: "{#StagingDir}\*"; DestDir: "{app}"; Excludes: "{#AppSub}\visheart-inference-gpu\app\models\unet.pth"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#StagingDir}\{#AppSub}\visheart-inference-gpu\app\models\unet.pth"; DestDir: "{app}\{#AppSub}\visheart-inference-gpu\app\models"; Flags: onlyifdoesntexist
#if Variant == "Full"
; Installed once: on a PC that already has the pack, the existing files (and the versions trained since) are kept.
Source: "{#PackDir}\*"; DestDir: "{app}\{#AppSub}\visheart-training-data"; Flags: recursesubdirs createallsubdirs onlyifdoesntexist uninsneveruninstall
#endif
Source: "scripts\New-VisHeartSecrets.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "scripts\Protect-VisHeartFolder.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "scripts\Test-VisHeartPrerequisites.ps1"; Flags: dontcopy
Source: "INSTALL.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autodesktop}\Start VisHeart"; Filename: "{app}\{#AppSub}\start.bat"; WorkingDir: "{app}\{#AppSub}"
Name: "{autodesktop}\Stop VisHeart"; Filename: "{app}\{#AppSub}\stop.bat"; WorkingDir: "{app}\{#AppSub}"
Name: "{group}\Start VisHeart"; Filename: "{app}\{#AppSub}\start.bat"; WorkingDir: "{app}\{#AppSub}"
Name: "{group}\Stop VisHeart"; Filename: "{app}\{#AppSub}\stop.bat"; WorkingDir: "{app}\{#AppSub}"
Name: "{group}\VisHeart install guide"; Filename: "{app}\INSTALL.md"
Name: "{group}\Uninstall VisHeart"; Filename: "{uninstallexe}"

[INI]
; "VisHeart" opens the app in the browser.
Filename: "{autodesktop}\VisHeart.url"; Section: "InternetShortcut"; Key: "URL"; String: "http://localhost:3000"
Filename: "{group}\VisHeart.url"; Section: "InternetShortcut"; Key: "URL"; String: "http://localhost:3000"

[Run]
; Ticked options on the finish page (not shown when Windows must restart first).
Filename: "{app}\{#AppSub}\start.bat"; WorkingDir: "{app}\{#AppSub}"; Description: "Start VisHeart now (the first start downloads about 25 GB)"; Flags: postinstall nowait skipifsilent shellexec runasoriginaluser
Filename: "{win}\notepad.exe"; Parameters: {app}\FIRST-LOGIN.txt; Description: "Open the login note (FIRST-LOGIN.txt, with the admin password)"; Flags: postinstall nowait skipifsilent runasoriginaluser; Check: LoginNoteExists

[UninstallDelete]
Type: files; Name: "{autodesktop}\VisHeart.url"
Type: files; Name: "{group}\VisHeart.url"

[Code]
#include "finish-page.iss"

var
  NeedWsl, NeedDocker, NeedPython, RebootNeeded, SecretsCreated, DeleteData: Boolean;

function PowerShellExe(): String;
begin
  Result := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
end;

function DeploymentDir(): String;
begin
  Result := ExpandConstant('{app}\{#Deploy}');
end;

{ Takes the text up to the next '|' off the front of S. }
function SplitField(var S: String): String;
var
  P: Integer;
begin
  P := Pos('|', S);
  if P = 0 then begin
    Result := S;
    S := '';
  end else begin
    Result := Copy(S, 1, P - 1);
    S := Copy(S, P + 1, Length(S));
  end;
end;

{ Takes the number up to the next '.' off the front of S (0 when it is not a number). }
function NextVersionPart(var S: String): Integer;
var
  P: Integer;
begin
  P := Pos('.', S);
  if P = 0 then begin
    Result := StrToIntDef(S, 0);
    S := '';
  end else begin
    Result := StrToIntDef(Copy(S, 1, P - 1), 0);
    S := Copy(S, P + 1, Length(S));
  end;
end;

{ 1 when version A is newer than B, -1 when older, 0 when the same. }
function CompareVersions(A, B: String): Integer;
var
  I, X, Y: Integer;
begin
  Result := 0;
  for I := 1 to 4 do begin
    X := NextVersionPart(A);
    Y := NextVersionPart(B);
    if X > Y then begin Result := 1; Exit; end;
    if X < Y then begin Result := -1; Exit; end;
  end;
end;

{ The version of the VisHeart already installed on this PC (written by Inno Setup when it was installed), or ''. }
function InstalledVersion(): String;
begin
  if not RegQueryStringValue(HKLM, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{CA49167C-4A63-4EEF-BCDA-6CCFB0BA99E5}_is1',
      'DisplayVersion', Result) then
    Result := '';
end;

function LoginNoteExists(): Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\FIRST-LOGIN.txt'));
end;

{ Folder of an existing VisHeart install (written by Inno Setup when it was installed), or ''. }
function ExistingInstallDir(): String;
begin
  if not RegQueryStringValue(HKLM, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{CA49167C-4A63-4EEF-BCDA-6CCFB0BA99E5}_is1',
      'Inno Setup: App Path', Result) or not DirExists(Result) then
    Result := '';
end;

{ Runs installer\scripts\Test-VisHeartPrerequisites.ps1 and decides whether setup may continue. }
function InitializeSetup(): Boolean;
var
  Lines: TArrayOfString;
  I, Code: Integer;
  Line, Name, Status, Blocks, Notes, OutFile, Existing, Drive, Installed: String;
begin
  Result := True;

  { One installer for every PC: it installs VisHeart, or updates the copy that is already there and keeps its data. }
  Installed := '';
  if ExistingInstallDir() <> '' then
    Installed := InstalledVersion();
  if Installed <> '' then begin
    if CompareVersions(Installed, '{#AppVersion}') > 0 then begin
      SuppressibleMsgBox('This PC already has VisHeart ' + Installed + ', which is newer than this installer (' +
        '{#AppVersion}). Nothing was changed. To update, use the newest VisHeart installer from the team''s Google Drive.',
        mbCriticalError, MB_OK, IDOK);
      Result := False;
      Exit;
    end;
    if not WizardSilent() then begin
      if CompareVersions(Installed, '{#AppVersion}') = 0 then
        Line := 'VisHeart {#AppVersion} is already installed on this PC. Continuing repairs it.'
      else
        Line := 'VisHeart ' + Installed + ' is installed on this PC. This updates it to VisHeart {#AppVersion}.';
      if MsgBox(Line + #13#10#13#10 + 'Patients, accounts, passwords and trained models are kept.' + #13#10#13#10 +
          'Continue?', mbConfirmation, MB_YESNO) <> IDYES then begin
        Result := False;
        Exit;
      end;
    end;
  end else if '{#Variant}' = 'Update' then begin
    SuppressibleMsgBox('VisHeart is not installed on this PC, and this installer only updates an existing VisHeart.' + #13#10#13#10 +
      'Use the VisHeart-Full installer from the team''s Google Drive instead.', mbCriticalError, MB_OK, IDOK);
    Result := False;
    Exit;
  end;
  ExtractTemporaryFile('Test-VisHeartPrerequisites.ps1');
  OutFile := ExpandConstant('{tmp}\prerequisites.txt');
  { An update needs far less free space: the existing install's images and data already take theirs. }
  Existing := ExistingInstallDir();
  if Existing <> '' then
    Drive := ExtractFileDrive(Existing) + ' -ExistingInstall'
  else
    Drive := 'C:' + ' -SkipDisk';   { checked again once the folder is chosen (NextButtonClick) }
  if not Exec(PowerShellExe(), '-NoProfile -ExecutionPolicy Bypass -File "' +
      ExpandConstant('{tmp}\Test-VisHeartPrerequisites.ps1') + '" -InstallDrive ' + Drive + ' -OutText "' + OutFile + '"',
      '', SW_HIDE, ewWaitUntilTerminated, Code) or not LoadStringsFromFile(OutFile, Lines) then begin
    SuppressibleMsgBox('The VisHeart system check could not run (Windows PowerShell). Setup cannot continue.',
      mbCriticalError, MB_OK, IDOK);
    Result := False;
    Exit;
  end;

  for I := 0 to GetArrayLength(Lines) - 1 do begin
    Line := Lines[I];
    Name := SplitField(Line);
    Status := SplitField(Line);
    Log('Prerequisite ' + Name + ': ' + Status + ' - ' + Line);
    if Status = 'block' then
      Blocks := Blocks + '- ' + Line + #13#10#13#10
    else if (Status = 'warn') or (Status = 'missing') then
      Notes := Notes + '- ' + Line + #13#10#13#10;
    if Status = 'missing' then begin
      if Name = 'wsl' then NeedWsl := True
      else if Name = 'docker' then NeedDocker := True
      else if Name = 'python' then NeedPython := True;
    end;
  end;

  if Blocks <> '' then begin
    SuppressibleMsgBox('VisHeart cannot be installed on this PC:' + #13#10#13#10 + Blocks, mbCriticalError, MB_OK, IDOK);
    Result := False;
    Exit;
  end;
  if (Notes <> '') and not WizardSilent() then
    Result := MsgBox('Before you continue:' + #13#10#13#10 + Notes + 'Continue with the installation?',
      mbConfirmation, MB_YESNO) = IDYES;
end;

{ The chosen folder: short (the longest shipped path must stay under Windows' 260-character limit; make-installer
  checks the files against a 40-character folder), without spaces, and on a drive with room for VisHeart and Docker. }
function NextButtonClick(CurPageID: Integer): Boolean;
var
  Dir, OutFile, Line, Status: String;
  Lines: TArrayOfString;
  Code: Integer;
begin
  Result := True;
  if CurPageID <> wpSelectDir then Exit;
  Dir := WizardDirValue();
  if (Length(Dir) > 40) or (Pos(' ', Dir) > 0) then begin
    MsgBox('Choose a short folder without spaces, for example C:\VisHeart or E:\VisHeart (at most 40 characters).',
      mbError, MB_OK);
    Result := False;
    Exit;
  end;
  OutFile := ExpandConstant('{tmp}\disk.txt');
  if Exec(PowerShellExe(), '-NoProfile -ExecutionPolicy Bypass -File "' +
      ExpandConstant('{tmp}\Test-VisHeartPrerequisites.ps1') + '" -DiskOnly -InstallDrive ' + ExtractFileDrive(Dir) +
      ' -OutText "' + OutFile + '"', '', SW_HIDE, ewWaitUntilTerminated, Code) and LoadStringsFromFile(OutFile, Lines) and
      (GetArrayLength(Lines) > 0) then begin
    Line := Lines[0];
    SplitField(Line);
    Status := SplitField(Line);
    Log('Disk check for ' + Dir + ': ' + Status + ' - ' + Line);
    if Status = 'block' then begin
      MsgBox(Line, mbError, MB_OK);
      Result := False;
    end;
  end;
end;

{ An update first stops the running VisHeart, so no file is in use while it is replaced. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
  StopBat: String;
begin
  Result := '';
  StopBat := DeploymentDir() + '\stop.bat';
  if FileExists(StopBat) then
    Exec(ExpandConstant('{cmd}'), '/c ""' + StopBat + '" --no-pause"', DeploymentDir(), SW_HIDE,
      ewWaitUntilTerminated, Code);
end;

function RunCmd(Command, Status: String): Integer;
var
  Code: Integer;
begin
  WizardForm.StatusLabel.Caption := Status;
  Log('Running: ' + Command);
  if not Exec(ExpandConstant('{cmd}'), '/c ' + Command, '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Code := -1;
  Log('Exit code: ' + IntToStr(Code));
  Result := Code;
end;

procedure InstallWithWinget(Id, Extra, Name, Url: String);
begin
  if RunCmd('winget install -e --id ' + Id + ' ' + Extra +
      ' --silent --accept-package-agreements --accept-source-agreements',
      'Installing ' + Name + ' (this can take several minutes)...') <> 0 then
    SuppressibleMsgBox(Name + ' could not be installed automatically. Please install it from ' + Url +
      ', then start VisHeart.', mbError, MB_OK, IDOK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
  Account: String;
begin
  if CurStep <> ssPostInstall then Exit;

  if NeedWsl then begin
    if RunCmd('"' + ExpandConstant('{sys}\wsl.exe') + '" --install --no-distribution', 'Turning on WSL2...') <> 0 then begin
      { Older Windows 10 builds have no "wsl --install": turn on the two Windows features instead. }
      RunCmd('dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart',
        'Turning on WSL2...');
      RunCmd('dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart',
        'Turning on WSL2...');
    end;
    RebootNeeded := True;
  end;
  if NeedDocker then begin
    InstallWithWinget('Docker.DockerDesktop', '', 'Docker Desktop', 'https://www.docker.com/products/docker-desktop/');
    RebootNeeded := True;
  end;
  if NeedPython then
    InstallWithWinget('Python.Python.3.13', '--scope machine', 'Python 3.13', 'https://www.python.org/downloads/');

  { Docker Desktop only accepts accounts in the docker-users group. "Already a member" is fine. }
  Account := GetEnv('USERDOMAIN') + '\' + GetUserNameString();
  RunCmd('net localgroup docker-users "' + Account + '" /add', 'Giving ' + Account + ' access to Docker...');

  SecretsCreated := not FileExists(DeploymentDir() + '\secrets.env');
  WizardForm.StatusLabel.Caption := 'Creating this PC''s VisHeart passwords...';
  if not Exec(PowerShellExe(), '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\installer\New-VisHeartSecrets.ps1') +
      '" -DeploymentDir "' + DeploymentDir() + '" -LoginNotePath "' + ExpandConstant('{app}\FIRST-LOGIN.txt') + '"',
      '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
    SuppressibleMsgBox('VisHeart could not create its passwords (secrets.env). Run installer\New-VisHeartSecrets.ps1 in ' +
      ExpandConstant('{app}') + ' before starting VisHeart, or run this installer again.', mbError, MB_OK, IDOK);

  { Only administrators and docker-users may change VisHeart, and other accounts cannot read its passwords. Done last,
    after Docker Desktop (which creates docker-users) and secrets.env exist; repeated on every update. }
  WizardForm.StatusLabel.Caption := 'Protecting the VisHeart folder...';
  if not Exec(PowerShellExe(), '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\installer\Protect-VisHeartFolder.ps1') +
      '" -AppDir "' + ExpandConstant('{app}') + '"', '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Code := -1;
  Log('Protect-VisHeartFolder exit code: ' + IntToStr(Code));
end;

function NeedRestart(): Boolean;
begin
  Result := RebootNeeded;
end;

procedure CurPageChanged(CurPageID: Integer);
var
  Note: AnsiString;
  Text: String;
begin
  if CurPageID <> wpFinished then Exit;
  if SecretsCreated and LoadStringFromFile(ExpandConstant('{app}\FIRST-LOGIN.txt'), Note) then
    Text := String(Note) + #13#10 + 'This note is saved as ' + ExpandConstant('{app}\FIRST-LOGIN.txt') + '.'
  else
    Text := 'VisHeart was updated. Your login, patients and trained models are unchanged.';
  Text := Text + #13#10#13#10 + NextStepsText();
  ShowFinishInfo(Text);
end;

{ ---------- Uninstall ---------- }

function InitializeUninstall(): Boolean;
begin
  Result := True;
  DeleteData := SuppressibleMsgBox('Also delete all VisHeart data (patients, accounts, trained models)?' + #13#10#13#10 +
    'Yes: everything is removed and cannot be recovered, including the downloaded VisHeart images (about 25 GB).' + #13#10 +
    'No: the data and the downloaded images are kept, and installing VisHeart again on this PC finds them.',
    mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO) = IDYES;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Code: Integer;
  Deploy, App, Args: String;
begin
  Deploy := DeploymentDir();
  App := ExpandConstant('{app}\{#AppSub}');

  if CurUninstallStep = usUninstall then begin
    { Stop VisHeart (and a running training) without waiting for a key press. }
    if FileExists(Deploy + '\stop.bat') then
      Exec(ExpandConstant('{cmd}'), '/c ""' + Deploy + '\stop.bat" --no-pause"', Deploy, SW_HIDE, ewWaitUntilTerminated, Code);
    { Remove VisHeart from Docker. Remove-VisHeartDocker starts Docker Desktop first when it is not running, so the
      containers never stay behind pointing at this deleted folder. Yes also removes the data volumes and the
      downloaded images (about 25 GB). }
    UninstallProgressForm.StatusLabel.Caption := 'Removing VisHeart from Docker (this can take a few minutes)...';
    Args := '-NoProfile -ExecutionPolicy Bypass -Command "Import-Module ''' + Deploy + '\lib\VisHeartStart.psm1''; ' +
      'exit (Remove-VisHeartDocker ''' + Deploy + '''';
    if DeleteData then Args := Args + ' -DeleteData';
    Args := Args + ')"';
    if not Exec(PowerShellExe(), Args, Deploy, SW_HIDE, ewWaitUntilTerminated, Code) then Code := -1;
    Log('Remove-VisHeartDocker exit code: ' + IntToStr(Code));
    if DeleteData and (Code <> 0) then begin
      { The database is still there, so keep everything, its passwords (secrets.env) above all: deleting them would
        leave a database that a new install of VisHeart cannot open. }
      DeleteData := False;
      SuppressibleMsgBox('Docker Desktop could not be started, so the VisHeart database could not be deleted. VisHeart''s ' +
        'data and passwords have been kept in ' + ExpandConstant('{app}') + ', and installing VisHeart again on this PC ' +
        'finds them.' + #13#10#13#10 +
        'To delete everything: install VisHeart again, start Docker Desktop, then uninstall and choose Yes.',
        mbInformation, MB_OK, IDOK);
    end;
  end;

  if (CurUninstallStep = usPostUninstall) and DeleteData then begin
    DelTree(App + '\visheart-training-data', True, True, True);
    DelTree(App + '\visheart-retraining\.venv', True, True, True);
    DelTree(App + '\visheart-retraining\jobs', True, True, True);
    DelTree(App + '\visheart-inference-gpu\app\models\active', True, True, True);
    DelTree(App + '\Cardiac_Segmentation_FYP_Server\dist\temp_exports', True, True, True);
    DeleteFile(Deploy + '\secrets.env');
    DeleteFile(ExpandConstant('{app}\FIRST-LOGIN.txt'));
    DelTree(ExpandConstant('{app}'), True, True, True);
  end;
end;
