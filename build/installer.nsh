!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER

Var astralDesktopState
Var astralStartState
Var astralDesktopBox
Var astralStartBox

LangString astralShortcutTitle 1033 "Shortcuts"
LangString astralShortcutTitle 1049 "Ярлыки"
LangString astralShortcutSub 1033 "Choose where to add Astral"
LangString astralShortcutSub 1049 "Куда добавить Astral"
LangString astralShortcutHint 1033 "Updates keep the shortcuts you already have."
LangString astralShortcutHint 1049 "При обновлении уже созданные ярлыки сохраняются."
LangString astralDesktopLabel 1033 "Add Astral to the desktop"
LangString astralDesktopLabel 1049 "Добавить Astral на рабочий стол"
LangString astralStartLabel 1033 "Add Astral to the Start menu"
LangString astralStartLabel 1049 "Добавить Astral в меню «Пуск»"

!macro customInit
  StrCpy $astralDesktopState ${BST_CHECKED}
  StrCpy $astralStartState ${BST_CHECKED}
!macroend

!macro customPageAfterChangeDir
  Page custom astralShortcutCreate astralShortcutLeave

  Function astralShortcutCreate
    ${If} ${Silent}
    ${OrIf} ${isUpdated}
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "$(astralShortcutTitle)" "$(astralShortcutSub)"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 24u "$(astralShortcutHint)"
    Pop $0

    ${NSD_CreateCheckbox} 0 32u 100% 14u "$(astralDesktopLabel)"
    Pop $astralDesktopBox
    ${NSD_SetState} $astralDesktopBox $astralDesktopState

    ${NSD_CreateCheckbox} 0 50u 100% 14u "$(astralStartLabel)"
    Pop $astralStartBox
    ${NSD_SetState} $astralStartBox $astralStartState

    nsDialogs::Show
  FunctionEnd

  Function astralShortcutLeave
    ${NSD_GetState} $astralDesktopBox $astralDesktopState
    ${NSD_GetState} $astralStartBox $astralStartState
  FunctionEnd
!macroend

!macro customInstall
  ${IfNot} ${isUpdated}
    ${If} $astralDesktopState == ${BST_CHECKED}
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${Else}
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
    ${EndIf}

    ${If} $astralStartState == ${BST_CHECKED}
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${Else}
      WinShell::UninstShortcut "$newStartMenuLink"
      Delete "$newStartMenuLink"
    ${EndIf}

    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend

!endif

!macro customUnInstall
  ${IfNot} ${isKeepShortcuts}
    WinShell::UninstShortcut "$oldDesktopLink"
    Delete "$oldDesktopLink"
    ${If} $oldDesktopLink != $newDesktopLink
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
    ${EndIf}
    WinShell::UninstShortcut "$oldStartMenuLink"
    Delete "$oldStartMenuLink"
    ${If} $oldStartMenuLink != $newStartMenuLink
      WinShell::UninstShortcut "$newStartMenuLink"
      Delete "$newStartMenuLink"
    ${EndIf}
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend
