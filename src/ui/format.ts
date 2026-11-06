import Decimal from 'break_eternity.js';

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** Standard suffixes up to 1e33, scientific after (or always, with notation 'sci'). */
export function fmt(v: Decimal | number, notation: 'suffix' | 'sci' = 'suffix', small = 1): string {
  const d = new Decimal(v);
  if (d.lt(1000)) {
    const n = d.toNumber();
    return n < 10 && small > 0 && n % 1 ? n.toFixed(small) : Math.floor(n).toString();
  }
  const e = Math.floor(d.log10().toNumber());
  if (notation === 'sci' || e >= 36) return `${d.div(Decimal.pow(10, e)).toNumber().toFixed(2)}e${e}`;
  const k = Math.floor(e / 3);
  return `${d.div(Decimal.pow(1000, k)).toNumber().toFixed(2)}${SUFFIXES[k]}`;
}

export const fmtTime = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
};
