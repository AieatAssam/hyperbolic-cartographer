/**
 * DOM UI colours as CSS custom properties. Tokens live in palette.ts; this file may touch the document.
 */
import { BOARD, UI, hexString } from './palette';

/** Apply palette UI tokens to :root (call once at startup before paint). */
export function applyUiCssVars(el: HTMLElement = document.documentElement): void {
  const s = el.style;
  s.setProperty('--bg', hexString(UI.bg));
  s.setProperty('--ink', hexString(UI.ink));
  s.setProperty('--muted', hexString(UI.muted));
  s.setProperty('--gold', hexString(BOARD.gold));
  s.setProperty('--cyan', hexString(BOARD.rim));
  s.setProperty('--red', hexString(UI.danger));
  s.setProperty('--green', hexString(UI.pos));
  s.setProperty('--glass', `rgba(${UI.glassRgb.join(', ')}, ${UI.glassAlpha})`);
  s.setProperty('--line', `rgba(${UI.lineRgb.join(', ')}, ${UI.lineAlpha})`);
  s.setProperty('--control-bg', hexString(UI.controlBg));
  s.setProperty('--field-bg', hexString(UI.fieldBg));
  s.setProperty('--panel-bg', hexString(UI.panelBg));
  s.setProperty('--primary-on-gold', hexString(UI.primaryOnGold));
  s.setProperty('--bar-lo', hexString(UI.barLo));
  s.setProperty('--bar-hi', hexString(UI.barHi));
  s.setProperty('--danger-soft', hexString(UI.dangerSoft));
  s.setProperty('--gain-label', hexString(UI.gainLabel));
  s.setProperty('--gain-label-bg', hexString(UI.gainLabelBg));
  s.setProperty('--dev-bg', `rgba(${UI.devPanelBg.join(', ')}, ${UI.devPanelBgAlpha})`);
  s.setProperty('--dev-border', `rgba(${UI.dangerRgb.join(', ')}, 0.5)`);
  s.setProperty('--flash', hexString(UI.flash));
}
