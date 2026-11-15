// English, and the list of everything there is to translate: every other
// language is checked against these keys. UK spelling.
//
// To add a language, copy this file to <language>.ts (the code Home Assistant
// uses, such as "fr" or "pt-BR"), translate the values, keep the {words} in
// braces as they are, and add one line to LOADERS in shared/localize.ts. A
// key left out falls back to English.

const en = {
  // The dashboard card.
  "card.loading": "Loading...",
  "card.unavailable": "Diorama is not available",
  "card.empty": "No house drawn yet",
  "card.empty_admin": "Open {link} in the sidebar to draw it.",
  "card.empty_user": "Ask an administrator to draw it.",
  "card.room_gone": "This room is no longer there",
  "card.floor_gone": "This floor is no longer there",
  "card.choose_another": "Edit the card and choose another.",
  "card.scene_failed": "The 3D view could not be loaded",
  "card.reload": "Reload the page to try again.",

  // The 3D view, wherever it is shown.
  "view.no_webgl": "The 3D view needs WebGL, which this browser has switched off or does not have.",
  "view.reset": "Reset view",
  "view.reset_title": "Show everything",
  "view.cancel": "Cancel",
  "view.open": "Open",
  "view.close": "Close",
  "view.switch_on": "Switch on",
  "view.switch_off": "Switch off",
  "view.open_question": "Open {name}?",
  "view.close_question": "Close {name}?",
  "view.switch_on_question": "Switch on {name}?",
  "view.switch_off_question": "Switch off {name}?",

  // The card's settings.
  "settings.show": "Show",
  "settings.show_house": "The whole house",
  "settings.show_floor": "One floor",
  "settings.show_room": "One room",
  "settings.floor": "Floor",
  "settings.choose_floor": "Choose a floor",
  "settings.room": "Room",
  "settings.choose_room": "Choose a room",
  "settings.unnamed_room": "Unnamed room",
  "settings.nothing_drawn": "Nothing has been drawn yet. Open Diorama in the sidebar first.",
  "settings.floor_gap": "Space the floors apart, to see into the lower ones",
  "settings.look_from": "Look from",
  "settings.look_from_default": "Wherever shows it all",
  "settings.shape": "Shape",
  "settings.shape_wide": "Wide (16:9)",
  "settings.shape_standard": "Standard (4:3)",
  "settings.shape_square": "Square",
  "settings.shape_tall": "Tall (3:4)",
  "settings.walls": "Walls",
  "settings.walls_auto": "Lower the ones in the way",
  "settings.walls_full": "All at full height",
  "settings.walls_low": "All low",
  "settings.interactive": "Tapping a device works it",
  "settings.controls": "The view can be turned and zoomed",
  "settings.day_night": "Day and night follow the sun",
} as const;

export default en;
