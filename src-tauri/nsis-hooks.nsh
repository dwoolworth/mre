!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\MRE" "" "Open with MRE"
  WriteRegStr HKCU "Software\Classes\Directory\shell\MRE" "Icon" "$INSTDIR\MRE.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\MRE\command" "" '"$INSTDIR\MRE.exe" "%V"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\MRE"
!macroend
