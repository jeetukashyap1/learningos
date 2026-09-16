# Holds a SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) lock
# for the given number of seconds so Windows does not sleep while long E2E
# runs are in flight. Changes no power settings; the lock dies with this
# process. Usage: powershell -NoProfile -File scripts/keep-awake.ps1 [seconds]

param([int]$Seconds = 7200)

Add-Type -Namespace Win32 -Name Power -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@

# ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x1)
$result = [Win32.Power]::SetThreadExecutionState(0x80000000 -bor 0x00000001)
if ($result -eq 0) {
  Write-Error "SetThreadExecutionState failed"
  exit 1
}

Write-Output "keep-awake active for $Seconds seconds (PID $PID)"
Start-Sleep -Seconds $Seconds
# Releasing is automatic when the process exits.
