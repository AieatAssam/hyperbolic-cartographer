import type { AudioApi } from './index';
import { LICENCES, PACKS, SFX_ASSETS, TRACKS, type Licence, type PackId } from './manifest';
import { MUSIC_STAGES, STAGE_LABEL } from './stage';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const link = (href: string, text: string) => {
  const a = el('a', '', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
};
const licenceName = (l: Licence) => LICENCES[l].name.replace(/ \(.*\)$/, '');

/** Re-runs `f` on audio changes while `node` is in the document; drops the listener once it has been removed. */
function live(api: AudioApi, node: HTMLElement, f: () => void) {
  let seen = false;
  const unsub = api.subscribe(() => {
    if (!node.isConnected) {
      if (seen) unsub();
      return;
    }
    seen = true;
    f();
  });
  f();
}

const SPEAKER_ON = '<path d="M4 9v6h4l5 4V5L8 9Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>';
const SPEAKER_OFF = '<path d="M4 9v6h4l5 4V5L8 9Z"/><path d="m17 9 5 6M22 9l-5 6"/>';

/** Small speaker button for the panel header: one tap mutes or restores all sound. */
export function soundToggle(api: AudioApi): HTMLButtonElement {
  const b = el('button', 'sound-toggle');
  b.type = 'button';
  b.dataset.qa = 'audio-quick-mute';
  b.dataset.audioSilent = '';
  b.onclick = () => {
    api.set({ muted: !api.settings().muted });
    if (!api.settings().muted) api.cue('toggle');
  };
  live(api, b, () => {
    const m = api.settings().muted;
    b.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${m ? SPEAKER_OFF : SPEAKER_ON}</svg>`;
    b.setAttribute('aria-label', m ? 'Turn sound on' : 'Mute sound');
    b.setAttribute('aria-pressed', String(m));
    b.title = m ? 'Sound is off. Tap to turn it on.' : 'Mute all sound';
  });
  return b;
}

function slider(api: AudioApi, key: 'music' | 'sfx', label: string, onCommit?: () => void) {
  const id = `audio-${key}`;
  const wrap = el('div', 'audio-slider');
  const lab = el('label', '', label);
  lab.htmlFor = id;
  const val = el('span', 'audio-value');
  const input = el('input');
  input.type = 'range';
  input.id = id;
  input.min = '0';
  input.max = '100';
  input.step = '5';
  input.dataset.qa = id;
  input.oninput = () => api.set({ [key]: Number(input.value) / 100 });
  if (onCommit) input.onchange = onCommit;
  live(api, wrap, () => {
    const pct = Math.round(api.settings()[key] * 100);
    if (document.activeElement !== input) input.value = String(pct);
    val.textContent = `${pct}%`;
    input.setAttribute('aria-valuetext', `${pct}%`);
    input.disabled = api.settings().muted;
  });
  const head = el('div', 'audio-slider-head');
  head.append(lab, val);
  wrap.append(head, input);
  return wrap;
}

/** Settings > Sound: mute, music and effects volume, what is playing. */
function soundCard(api: AudioApi): HTMLElement {
  const card = el('div', 'card audio-card');
  card.dataset.qa = 'audio-settings';
  card.dataset.audioSilent = '';
  const mute = el('button', 'audio-mute');
  mute.type = 'button';
  mute.dataset.qa = 'audio-mute';
  mute.onclick = () => {
    api.set({ muted: !api.settings().muted });
    if (!api.settings().muted) api.cue('toggle');
  };
  const status = el('p', 'audio-status');
  status.dataset.qa = 'audio-now-playing';
  live(api, card, () => {
    const m = api.settings().muted;
    mute.textContent = m ? 'Turn sound on' : 'Mute all sound';
    mute.setAttribute('aria-pressed', String(m));
    const t = api.nowPlaying();
    status.textContent = !api.supported()
      ? "This browser can't play the game's sound files."
      : m
        ? 'Sound is off.'
        : t
          ? `Now playing (${STAGE_LABEL[t.stage]}): “${t.title}” by ${t.author}.`
          : 'Music starts after your first tap or key press.';
  });
  card.append(
    el('h3', '', 'Sound'),
    mute,
    slider(api, 'music', 'Music'),
    slider(api, 'sfx', 'Sound effects', () => api.cue('preview-sfx')),
    status,
    el('p', 'help', 'Each stage has its own music. Sound gets quieter while the game is in a background tab. These settings are saved on this device.'),
  );
  return card;
}

const uses = (pack: PackId) =>
  [...new Set(SFX_ASSETS.filter((a) => a.pack === pack).flatMap((a) => a.use.split(', ')))].join(', ').toLowerCase();

function creditsList(): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const stage of MUSIC_STAGES) {
    out.push(el('h4', '', `Music: ${STAGE_LABEL[stage]}`));
    const ul = el('ul');
    for (const t of TRACKS.filter((x) => x.stage === stage)) {
      const li = el('li');
      li.append(link(t.page, `“${t.title}”`), ` by ${t.author}. ${licenceName(t.licence)}.`);
      ul.append(li);
    }
    out.push(ul);
  }
  out.push(el('h4', '', 'Sound effects'));
  const ul = el('ul');
  for (const [id, p] of Object.entries(PACKS) as [PackId, (typeof PACKS)[PackId]][]) {
    const li = el('li');
    li.append(link(p.page, `“${p.title}”`), ` by ${p.author}. ${licenceName(p.licence)}. Used for: ${uses(id)}.`);
    ul.append(li);
  }
  out.push(ul);
  const lic = el('p', 'audio-licences', 'Licence texts: ');
  (Object.keys(LICENCES) as Licence[]).forEach((l, i) => lic.append(i ? ', ' : '', link(LICENCES[l].url, licenceName(l))));
  out.push(lic, el('p', 'help', 'Long tracks were shortened with a fade-out, and every file was re-encoded and evened out in volume.'));
  return out;
}

/** Settings > Credits: every track and sound pack, in plain words. */
function creditsCard(): HTMLElement {
  const card = el('div', 'card audio-credits');
  card.dataset.qa = 'audio-credits';
  const details = el('details');
  const summary = el('summary', '', `Show all ${TRACKS.length} tracks and ${Object.keys(PACKS).length} sound packs`);
  summary.dataset.qa = 'audio-credits-toggle';
  const body = el('div');
  details.append(summary);
  // Built only while open: Chromium still lays out a closed <details>' content.
  details.addEventListener('toggle', () => (details.open ? (body.replaceChildren(...creditsList()), details.append(body)) : body.remove()));
  card.append(
    el('h3', '', 'Music and sound credits'),
    el('p', '', 'All music and sound effects are by other artists, shared under Creative Commons licences (CC0 or CC BY) that allow reuse. Thank you to them.'),
    details,
  );
  return card;
}

export const soundCards = (api: AudioApi): HTMLElement[] => [soundCard(api), creditsCard()];
