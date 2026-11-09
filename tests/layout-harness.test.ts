import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// Layout harness is a Node script (untyped .mjs); the exports are the suite contract.
// @ts-expect-error no declaration file for scripts/layout.mjs
import { CASES, VIEWPORTS } from '../scripts/layout.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('layout harness', () => {
  it('keeps six viewports and 49 cases (no coverage drop)', () => {
    expect(VIEWPORTS.map((v: { name: string }) => v.name)).toEqual([
      '360x640', '390x844', '430x932', '844x390', '932x430', '1280x800',
    ]);
    expect(CASES).toHaveLength(49);
    const names = CASES.map((c: { name: string }) => c.name);
    for (const need of [
      'firstload', 'hud-control-rhythm', 'bridge-gain-label',
      'board-rendered-fresh', 'board-rendered-midgame',
      'manifold-klein-immersion-inboard', 'info-touch-scroll',
    ]) {
      expect(names).toContain(need);
    }
  });

  it('CI Layout QA step timeout covers the measured 1280x800 cold suite', () => {
    const yml = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
    const block = yml.split('- name: Layout QA')[1] ?? '';
    const mins = Number(/timeout-minutes:\s*(\d+)/.exec(block)?.[1]);
    // GHA 1280x800 was ~13s/case × 49 ≈ 10.6 min with a new page each case.
    expect(mins).toBeGreaterThanOrEqual(12);
    expect(mins).toBeLessThanOrEqual(20);
  });

  it('logs per-case duration into report.json', () => {
    const src = readFileSync(join(ROOT, 'scripts/layout.mjs'), 'utf8');
    expect(src).toMatch(/results\.push\(\{[^}]*ms/);
    expect(src).toMatch(/totalMs/);
    expect(src).toContain('${ms}ms');
  });
});
