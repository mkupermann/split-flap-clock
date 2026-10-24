@echo off
setlocal
set PROJECT=%~dp0..
node "%~dp0check-render.js"
exit /b %ERRORLEVEL%
