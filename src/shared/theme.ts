// Colors for the native Window Controls Overlay shown by the Windows frameless
// title bar (titleBarStyle: 'hidden' + titleBarOverlay). The overlay sits on
// the app header, whose top edge is `--bg-secondary`, and its glyphs use
// `--text-primary`; keep these in sync with the CSS variables. The app ships a
// single dark theme, so there is only one palette.
export const TITLE_BAR_OVERLAY_COLORS = { color: '#26211A', symbolColor: '#F5EEE3' }

/** Height of the window-controls strip; matches the 56px app header. */
export const TITLE_BAR_OVERLAY_HEIGHT = 56
