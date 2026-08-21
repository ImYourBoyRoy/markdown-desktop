; Markdown Desktop stores all application-owned state under its Tauri
; identifier. Purge both Windows application-data roots after NSIS removes
; the installed files. This keeps uninstall behavior deterministic instead of
; depending on the optional default NSIS data checkbox.
!macro NSIS_HOOK_POSTUNINSTALL
  ; Read the launching user's environment explicitly. This remains correct for
  ; current-user installs even when Windows has changed the shell context while
  ; the uninstaller is removing its own files.
  ReadEnvStr $0 "APPDATA"
  ${If} $0 != ""
    RMDir /r "$0\com.markdownnative.desktop"
  ${EndIf}
  ReadEnvStr $0 "LOCALAPPDATA"
  ${If} $0 != ""
    RMDir /r "$0\com.markdownnative.desktop"
  ${EndIf}
!macroend
