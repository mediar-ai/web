; NSIS Hook Script for Mediar Installer
; Handles pre-install cleanup and post-install VC++ Redistributables

; =============================================================================
; PREINSTALL HOOK - Kill child processes before file installation
; =============================================================================
; This prevents "Error opening file for writing" during updates when
; bun.exe or terminator-mcp-agent.exe are still running from previous version
!macro NSIS_HOOK_PREINSTALL
  DetailPrint "[PREINSTALL] Stopping Mediar and child processes before update..."

  ; Kill mediar.exe first (the main app that spawns child processes)
  ; Must be killed before children to prevent respawning
  DetailPrint "[PREINSTALL] Stopping mediar.exe..."
  nsExec::ExecToStack 'taskkill /F /IM mediar.exe'
  Pop $0  ; return code
  Pop $1  ; output (unused)
  DetailPrint "[PREINSTALL] mediar.exe taskkill returned: $0"

  ; Kill bun.exe if running (spawned by mediar for workflow execution)
  ; taskkill returns 0 on success, 128 if process not found, other codes for errors
  DetailPrint "[PREINSTALL] Stopping bun.exe..."
  nsExec::ExecToStack 'taskkill /F /IM bun.exe'
  Pop $0  ; return code
  Pop $1  ; output (unused)
  DetailPrint "[PREINSTALL] bun.exe taskkill returned: $0"

  ; Kill terminator-mcp-agent.exe if running (MCP server sidecar)
  DetailPrint "[PREINSTALL] Stopping terminator-mcp-agent.exe..."
  nsExec::ExecToStack 'taskkill /F /IM terminator-mcp-agent.exe'
  Pop $0  ; return code
  Pop $1  ; output (unused)
  DetailPrint "[PREINSTALL] terminator-mcp-agent.exe taskkill returned: $0"

  ; Wait 3 seconds for file handles to be released (increased from 2s)
  DetailPrint "[PREINSTALL] Waiting for file handles to release..."
  Sleep 3000
  DetailPrint "[PREINSTALL] Ready to install files"
!macroend

; =============================================================================
; POSTINSTALL HOOK - Install VC++ Redistributables after files are copied
; =============================================================================
!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "[POSTINSTALL] Checking Visual C++ Redistributables..."

  ; Determine architecture and filename
  ${If} ${RunningX64}
    ${If} ${IsNativeARM64}
      StrCpy $2 "vc_redist.arm64.exe"
      DetailPrint "[POSTINSTALL] Installing VC++ Redistributables (ARM64)..."
    ${Else}
      StrCpy $2 "vc_redist.x64.exe"
      DetailPrint "[POSTINSTALL] Installing VC++ Redistributables (x64)..."
    ${EndIf}
  ${Else}
    ; 32-bit systems are not supported by terminator-mcp-agent
    DetailPrint "[POSTINSTALL] WARNING: 32-bit systems are not supported"
    Goto vcredist_done
  ${EndIf}

  ; Try multiple possible locations where Tauri might place resources
  ; Location 1: resources subdirectory (Tauri v2 with wildcard patterns)
  StrCpy $0 "$INSTDIR\resources\$2"
  IfFileExists "$0" vcredist_found

  ; Location 2: direct in INSTDIR
  StrCpy $0 "$INSTDIR\$2"
  IfFileExists "$0" vcredist_found

  ; Location 3: vcredist subdirectory in resources
  StrCpy $0 "$INSTDIR\resources\vcredist\$2"
  IfFileExists "$0" vcredist_found

  ; Not found in any location
  DetailPrint "[POSTINSTALL] WARNING: VC++ Redistributables installer not found"
  DetailPrint "[POSTINSTALL] Searched locations:"
  DetailPrint "  $INSTDIR\resources\$2"
  DetailPrint "  $INSTDIR\$2"
  DetailPrint "  $INSTDIR\resources\vcredist\$2"
  Goto vcredist_done

  vcredist_found:
  DetailPrint "[POSTINSTALL] Found installer at: $0"
  ; Check if file exists (redundant but for clarity)
  IfFileExists "$0" 0 vcredist_missing

  ; Run VC++ Redistributables installer silently
  ; /install = install mode
  ; /quiet = no UI
  ; /norestart = don't restart computer
  DetailPrint "[POSTINSTALL] Running: $0 /install /quiet /norestart"
  ExecWait '"$0" /install /quiet /norestart' $1

  ; Check exit code
  ${If} $1 == 0
    DetailPrint "[POSTINSTALL] VC++ Redistributables installed successfully"
  ${ElseIf} $1 == 1638
    DetailPrint "[POSTINSTALL] VC++ Redistributables already installed (newer or same version)"
  ${ElseIf} $1 == 3010
    DetailPrint "[POSTINSTALL] VC++ Redistributables installed (restart may be required)"
  ${Else}
    DetailPrint "[POSTINSTALL] VC++ Redistributables installation returned code: $1"
  ${EndIf}

  Goto vcredist_done

  vcredist_missing:
    DetailPrint "[POSTINSTALL] WARNING: VC++ Redistributables installer not found at: $0"

  vcredist_done:
!macroend
