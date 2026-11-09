/**
 * True when a key press belongs to the control that has focus rather than to page-wide
 * shortcuts: a text box, a native select, an editable element, an open dropdown/menu, or a
 * dialog. Without this check, pressing Delete in the segmentation page's Frame box cleared the
 * active mask, and typing "12" there would switch labels.
 */
export function isKeyForFocusedControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return (
    target.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]') !== null
  );
}

/**
 * True when the focused element uses the arrow keys and Space itself: a slider thumb, a dropdown
 * trigger, a radio group or a tab list. A page shortcut on those keys should step aside, or one
 * key press would act twice (move two steps, or open the dropdown and toggle playback at once).
 */
export function isArrowOrSpaceForFocusedControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.closest('[role="slider"], [role="combobox"], [role="radiogroup"], [role="tablist"]') !== null
  );
}
