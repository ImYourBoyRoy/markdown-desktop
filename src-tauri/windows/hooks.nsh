; Markdown Desktop stores all application-owned state under its Tauri
; identifier. Purge both Windows application-data roots after NSIS removes
; the installed files. This keeps uninstall behavior deterministic instead of
; depending on the optional default NSIS data checkbox.
;
; Also register Default Programs Capabilities so Windows Settings can list the
; app and deep-link with ms-settings:defaultapps?registeredAppUser/Machine=…
; FileAssociations ProgIds match NSIS APP_ASSOCIATE ("Markdown document").
; Silent default changes are blocked by Windows; Settings confirmation is required.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\${PRODUCTNAME}\Capabilities"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities" "ApplicationDescription" "A focused desktop viewer and editor for Markdown files."
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".md" "Markdown document"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".markdown" "Markdown document"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".mdown" "Markdown document"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".mkdown" "Markdown document"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"
  DeleteRegKey SHCTX "Software\${PRODUCTNAME}\Capabilities"
  DeleteRegKey /ifempty SHCTX "Software\${PRODUCTNAME}"

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
