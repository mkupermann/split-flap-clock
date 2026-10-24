@echo off
REM FallblattUhr.scr bauen (C# / .NET Framework 4.x, nur csc.exe, keine NuGet-Pakete).
REM Ausgabe: ..\FallblattUhr.scr im Projekt-Root.
setlocal
set "CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
set "OUT=%~dp0..\FallblattUhr.scr"

if not exist "%CSC%" (
  echo FEHLER: csc.exe nicht gefunden: %CSC%
  exit /b 1
)

"%CSC%" /nologo /target:winexe /out:"%OUT%" ^
  /r:System.dll ^
  /r:System.Management.dll ^
  /r:System.Drawing.dll ^
  /r:System.Windows.Forms.dll ^
  "%~dp0FallblattUhr.cs"
if errorlevel 1 (
  echo BUILD FEHLGESCHLAGEN
  exit /b 1
)

echo Gebaut: %OUT%
exit /b 0
