{ Included by visheart.iss (and by a preview script when the page is checked by eye).
  The finish page shows the login and the next steps in a box the user can scroll, select and copy from, and moves the
  "Start VisHeart now" / restart choices below that box. }

function NextStepsText(): String;
begin
  Result :=
    'NEXT STEPS' + #13#10 +
    '1. If the installer asks you to restart Windows, restart first.' + #13#10 +
    '2. Open Docker Desktop once and accept its terms (only the first time).' + #13#10 +
    '3. Double-click the "VisHeart" heart icon on the desktop (also in the Start menu). It starts VisHeart and ' +
    'opens it in your browser. The first start downloads about 25 GB and can take an hour or more; later starts ' +
    'take about a minute, and when VisHeart is already running it opens at once.' + #13#10 +
    '4. Log in, then change the admin password in Profile Settings (http://localhost:3000/profile).' + #13#10 +
    '5. To stop VisHeart: Start menu > VisHeart > Stop VisHeart. Your data is kept.' + #13#10#13#10 +
    'Do not start VisHeart with the Run button in Docker Desktop: that starts only part of VisHeart, which then ' +
    'fails.' + #13#10#13#10 +
    'TO UNINSTALL: Windows Settings > Apps > Installed apps > VisHeart > ... > Uninstall.' + #13#10 +
    'Full guide: ' + ExpandConstant('{app}') + '\INSTALL.md';
end;

procedure ShowFinishInfo(Text: String);
var
  Info: TNewMemo;
  Below: Integer;
begin
  WizardForm.FinishedLabel.Caption := 'VisHeart is installed. Your login and the next steps are below; you can ' +
    'select and copy them (Ctrl+C).';
  WizardForm.AdjustLabelHeight(WizardForm.FinishedLabel);

  Info := TNewMemo.Create(WizardForm);
  Info.Parent := WizardForm.FinishedPage;
  Info.Left := WizardForm.FinishedLabel.Left;
  Info.Width := WizardForm.FinishedLabel.Width;
  Info.Top := WizardForm.FinishedLabel.Top + WizardForm.FinishedLabel.Height + ScaleY(8);
  Info.Height := WizardForm.FinishedPage.ClientHeight - Info.Top - ScaleY(70);
  Info.ReadOnly := True;
  Info.WordWrap := True;
  Info.ScrollBars := ssVertical;
  Info.Text := Text;

  Below := Info.Top + Info.Height + ScaleY(8);
  WizardForm.RunList.Top := Below;
  WizardForm.RunList.Height := WizardForm.FinishedPage.ClientHeight - Below;
  WizardForm.YesRadio.Top := Below;
  WizardForm.NoRadio.Top := Below + WizardForm.YesRadio.Height + ScaleY(4);
end;
