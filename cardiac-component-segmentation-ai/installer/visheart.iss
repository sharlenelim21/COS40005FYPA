; VisHeart installer (Inno Setup 6.5.2 or later). Built by make-installer.ps1, which passes:
;   /DVariant=Full|Update  /DAppVersion=<VERSION>  /DStagingDir=<installer\out\staging>  [/DPackDir=<training pack>]
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
DisableDirPage=yes
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

[UninstallDelete]
Type: files; Name: "{autodesktop}\VisHeart.url"
Type: files; Name: "{group}\VisHeart.url"

[Code]
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
  Line, Name, Status, Blocks, Notes, OutFile, Existing, Drive: String;
begin
  Result := True;
  ExtractTemporaryFile('Test-VisHeartPrerequisites.ps1');
  OutFile := ExpandConstant('{tmp}\prerequisites.txt');
  { An update needs far less free space: the existing install's images and data already take theirs. }
  Existing := ExistingInstallDir();
  if Existing <> '' then
    Drive := ExtractFileDrive(Existing) + ' -ExistingInstall'
  else
    Drive := 'C:';
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
    Text := 'Your VisHeart login and data are unchanged.';
  Text := Text + #13#10#13#10 +
    'The first time Docker Desktop opens, it asks you to accept its terms. Then use "Start VisHeart" on the desktop. ' +
    'The first start downloads about 25 GB and can take an hour or more.';
  WizardForm.FinishedLabel.Caption := WizardForm.FinishedLabel.Caption + #13#10#13#10 + Text;
  WizardForm.AdjustLabelHeight(WizardForm.FinishedLabel);
end;

{ ---------- Uninstall ---------- }

function InitializeUninstall(): Boolean;
begin
  Result := True;
  DeleteData := SuppressibleMsgBox('Also delete all VisHeart data (patients, accounts, trained models)?' + #13#10#13#10 +
    'Yes: everything is removed and cannot be recovered.' + #13#10 +
    'No: the data is kept, and installing VisHeart again on this PC finds it again.',
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
    if DeleteData then begin
      Args := '/c docker compose';
      if FileExists(Deploy + '\release.env') then Args := Args + ' --env-file "' + Deploy + '\release.env"';
      if FileExists(Deploy + '\secrets.env') then Args := Args + ' --env-file "' + Deploy + '\secrets.env"';
      Args := Args + ' --profile cpu --profile gpu down -v --remove-orphans';
      if not Exec(ExpandConstant('{cmd}'), Args, Deploy, SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then begin
        { The database is still there, so keep everything, its passwords (secrets.env) above all: deleting them would
          leave a database that a new install of VisHeart cannot open. }
        DeleteData := False;
        SuppressibleMsgBox('Docker Desktop is not running, so the VisHeart database could not be deleted. VisHeart''s data ' +
          'and passwords have been kept in ' + ExpandConstant('{app}') + ', and installing VisHeart again on this PC finds them.' + #13#10#13#10 +
          'To delete everything: install VisHeart again, start Docker Desktop, then uninstall and choose Yes.',
          mbInformation, MB_OK, IDOK);
      end;
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
