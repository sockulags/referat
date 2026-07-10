@echo off
rem Starts the referat diarization server (install first with install.ps1).
rem Extra arguments are passed through, e.g.: start-server.bat --host 0.0.0.0
cd /d "%~dp0"
where uv >nul 2>nul
if %errorlevel%==0 (
  uv run diarization-server %*
) else if exist "%USERPROFILE%\.local\bin\uv.exe" (
  "%USERPROFILE%\.local\bin\uv.exe" run diarization-server %*
) else (
  echo uv is not installed - run install.ps1 first.
  exit /b 1
)
