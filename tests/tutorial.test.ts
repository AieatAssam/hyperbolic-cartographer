import { describe, expect, it } from 'vitest';
import Decimal from 'break_eternity.js';
import { initialState, graphOf } from '../src/core/state';
import { place } from '../src/core/economy';
import {
  STEPS,
  currentStep,
  dismissTutorial,
  freshTutorial,
  hasBoostedMill,
  initialTutorial,
  nextStep,
  parseTutorial,
  reopenTutorial,
  serializeTutorial,
  syncTutorial,
} from '../src/ui/tutorial';

describe('tutorial', () => {
  it('fresh state starts at step 0, not done', () => {
    const t = initialTutorial(initialState());
    expect(t).toEqual({ step: 0, dismissed: false, done: false });
    expect(currentStep(t)?.id).toBe('ink');
  });

  it('does not auto-advance the manual ink step, even with no springs', () => {
    const s = initialState();
    const t = freshTutorial();
    expect(syncTutorial(t, s)).toBe(t);
    expect(syncTutorial(t, s).step).toBe(0);
  });

  it('advances past the spring step once a spring is placed', () => {
    const s = initialState();
    let t = nextStep(freshTutorial());
    expect(currentStep(t)?.id).toBe('spring');
    expect(place(s, 0, 'spring')).toBe(true);
    t = syncTutorial(t, s);
    expect(currentStep(t)?.id).toBe('save');
  });

  it('a mill next to a spring completes save and boost, and stops at manual preview', () => {
    const s = initialState();
    let t = nextStep(freshTutorial());
    place(s, 0, 'spring');
    s.ink = new Decimal(1000);
    place(s, graphOf(s).neighbours[0][0], 'mill');
    t = syncTutorial(t, s);
    expect(currentStep(t)?.id).toBe('preview');
    expect(t.step).toBe(STEPS.length - 1);
    expect(t.done).toBe(false);
    expect(syncTutorial(t, s)).toBe(t);
  });

  it('nextStep past the last step finishes the tutorial', () => {
    let t = freshTutorial();
    for (let i = 0; i < STEPS.length; i++) t = nextStep(t);
    expect(t.done).toBe(true);
    expect(t.step).toBe(STEPS.length);
    expect(currentStep(t)).toBeNull();
  });

  it('reopening a finished tutorial restarts it at step 0', () => {
    const done = nextStep({ step: STEPS.length - 1, dismissed: true, done: false });
    const r = reopenTutorial(done);
    expect(r).toEqual({ step: 0, dismissed: false, done: false });
  });

  it('dismiss and reopen toggle the dismissed flag', () => {
    const t = freshTutorial();
    const d = dismissTutorial(t);
    expect(d.dismissed).toBe(true);
    expect(d.step).toBe(0);
    expect(reopenTutorial(d).dismissed).toBe(false);
    expect(t.dismissed).toBe(false); // input untouched
  });

  it('parseTutorial falls back to the initial state on garbage or null', () => {
    const s = initialState();
    const init = initialTutorial(s);
    expect(parseTutorial(null, s)).toEqual(init);
    expect(parseTutorial('not json', s)).toEqual(init);
    expect(parseTutorial('[1,2]', s)).toEqual(init);
    expect(parseTutorial('{"step":"x"}', s)).toEqual(init);
    expect(parseTutorial('null', s)).toEqual(init);
  });

  it('parseTutorial clamps the step into range', () => {
    const s = initialState();
    expect(parseTutorial('{"step":-4,"dismissed":false,"done":false}', s).step).toBe(0);
    expect(parseTutorial('{"step":99,"dismissed":false,"done":false}', s).step).toBe(STEPS.length);
  });

  it('serialize and parse round-trip', () => {
    const s = initialState();
    const t = { step: 2, dismissed: true, done: false };
    expect(parseTutorial(serializeTutorial(t), s)).toEqual(t);
  });

  it('initialTutorial marks a progressed save as done', () => {
    const s = initialState();
    s.drifts = 1;
    expect(initialTutorial(s)).toEqual({ step: STEPS.length, dismissed: false, done: true });
  });

  it('initialTutorial detects an existing boosted mill', () => {
    const s = initialState();
    place(s, 0, 'spring');
    s.ink = new Decimal(1000);
    place(s, graphOf(s).neighbours[0][0], 'mill');
    expect(hasBoostedMill(s)).toBe(true);
    expect(initialTutorial(s).done).toBe(true);
  });

  it('syncTutorial returns the same object when nothing changed', () => {
    const s = initialState();
    const t = freshTutorial();
    expect(syncTutorial(t, s)).toBe(t);
    const done = { step: STEPS.length, dismissed: false, done: true };
    expect(syncTutorial(done, s)).toBe(done);
  });

  it('every step body renders without NaN', () => {
    const s = initialState();
    for (const step of STEPS) {
      const text = step.body(s);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});
