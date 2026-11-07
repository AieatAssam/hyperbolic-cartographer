/** Short placement feedback tones (Web Audio). No-op when reduced motion or autoplay blocked. */

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export function playChime(kind: 'constellation' | 'link' | 'place'): void {
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = ac();
  if (!c) return;
  const start = () => {
    const o = c.createOscillator();
    const g = c.createGain();
    const f = kind === 'constellation' ? 587.33 : kind === 'link' ? 440 : 523.25;
    o.frequency.value = f;
    o.type = kind === 'constellation' ? 'triangle' : 'sine';
    const t0 = c.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (kind === 'constellation' ? 0.35 : 0.22));
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + 0.4);
    if (kind === 'constellation') {
      const o2 = c.createOscillator();
      const g2 = c.createGain();
      o2.frequency.value = 880;
      o2.type = 'sine';
      g2.gain.setValueAtTime(0.0001, t0 + 0.08);
      g2.gain.exponentialRampToValueAtTime(0.08, t0 + 0.12);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.38);
      o2.connect(g2).connect(c.destination);
      o2.start(t0 + 0.08);
      o2.stop(t0 + 0.42);
    }
  };
  if (c.state === 'suspended') c.resume().then(start).catch(() => {});
  else start();
}
