@echo off
REM ---------------------------------------------------------------------------
REM Move Next.js build output (.next) OUTSIDE the OneDrive-synced project folder.
REM
REM Why this exists:
REM   OneDrive "Files On-Demand" dehydrates files inside .next into reparse
REM   points. Node then misclassifies them as symbolic links, and readlink()
REM   fails with EINVAL (errno -4071) or reads fail with ENOENT (errno -4058).
REM   That makes `next build` fail intermittently with errors such as:
REM       EINVAL: invalid argument, readlink '.next\package.json'
REM   Keeping .next in a normal local folder removes OneDrive from the equation.
REM
REM What it creates (idempotent - safe to run again any time):
REM   <project>\.next                         -> junction to BUILD_DIR\.next
REM   BUILD_DIR\node_modules                  -> junction to <project>\node_modules
REM
REM Re-running it also wipes BUILD_DIR\.next, so a build never inherits stale or
REM half-written artifacts (those show up as spurious prerender failures such as
REM "Expected workUnitAsyncStorage to have a store" or EBUSY locks on a chunk).
REM
REM The node_modules link is required because the compiled server output now
REM physically lives under BUILD_DIR, and Node resolves packages by walking up
REM from that location. It is placed NEXT TO the .next folder (not inside it) so
REM that Next's automatic dist-dir cleanup never deletes it.
REM
REM To undo: delete the .next junction in the project and build normally.
REM ---------------------------------------------------------------------------
setlocal
set "PROJECT=%~dp0.."
set "BUILD_DIR=%USERPROFILE%\LearningOS-build"

if not exist "%BUILD_DIR%\" mkdir "%BUILD_DIR%"

REM 1. Drop the project-side junction first so nothing holds the target open.
if exist "%PROJECT%\.next\" (
  REM A junction is removed with rmdir (no /s); a real folder needs /s /q.
  rmdir "%PROJECT%\.next" 2>nul || rmdir /s /q "%PROJECT%\.next"
)

REM 2. Rebuild the external .next from scratch so no stale output survives.
if exist "%BUILD_DIR%\.next\" (
  rmdir "%BUILD_DIR%\.next" 2>nul || rmdir /s /q "%BUILD_DIR%\.next"
)
mkdir "%BUILD_DIR%\.next" 2>nul

REM 3. Recreate the node_modules sibling link so it can never go stale.
if exist "%BUILD_DIR%\node_modules\" rmdir "%BUILD_DIR%\node_modules" 2>nul
mklink /J "%BUILD_DIR%\node_modules" "%PROJECT%\node_modules"
if errorlevel 1 goto :failed

REM 4. Point the project .next at the external build dir.
mklink /J "%PROJECT%\.next" "%BUILD_DIR%\.next"
if errorlevel 1 goto :failed

echo.
echo Done. Next.js build output now lives in:
echo   %BUILD_DIR%\.next
echo.
echo Run "npm run build" as usual.
endlocal
exit /b 0

:failed
echo.
echo Setup failed. Make sure you are not running from inside a virtualized or
echo restricted shell, then run this script again.
endlocal
exit /b 1
