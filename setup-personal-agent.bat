@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-personal-agent.ps1" %*
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
  echo.
  echo Setup failed. Review the message above.
  pause
  exit /b %RESULT%
)
echo.
echo Setup finished. Press any key to close this window.
pause
exit /b %RESULT%
