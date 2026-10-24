@echo off
REM Fallblattuhr starten: Helper + Chrome im Kiosk-Vollbild.
REM   Uhr-starten.cmd          -> Helper minimiert (Normalbetrieb)
REM   Uhr-starten.cmd --setup  -> Helper sichtbar (beim allerersten Start fuer WhatsApp-QR)
REM Beenden der Uhr: Alt+F4 im Chrome-Fenster.

setlocal

REM Helper nur starten, wenn er im Projekt liegt (optional).
if exist "%~dp0helper\package.json" (
  if /I "%~1"=="--setup" (
    start "FallblattHelper" cmd /k "cd /d %~dp0helper && npm start"
  ) else (
    start "FallblattHelper" /min cmd /k "cd /d %~dp0helper && npm start"
  )
  timeout /t 3 /nobreak >nul
)

REM Backslashes im Projekt-Pfad in Slashes fuer die file://-URL wandeln
set "HTMLPATH=%~dp0index.html"
set "HTMLPATH=%HTMLPATH:\=/%"

"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required --user-data-dir="%LOCALAPPDATA%\FallblattUhrChrome" --no-first-run --disable-session-crashed-bubble --disable-features=Translate,CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling "file:///%HTMLPATH%"

endlocal
