import { describe, expect, it } from 'vitest';
import { SLOP, TapController } from '../src/ui/input';

// One complete single-pointer tap: down at the origin, release over `cell`.
const tap = (c: TapController, id: number, cell: number, kind: 'mouse' | 'touch' | 'pen' = 'touch') => {
  c.down(id, 0, 0, kind, 0);
  return c.up(id, cell);
};

const NONE = { kind: 'none' };

describe('TapController: mouse', () => {
  it('click applies immediately and never touches selection', () => {
    const c = new TapController();
    expect(tap(c, 1, 5, 'mouse')).toEqual({ kind: 'apply', cell: 5 });
    expect(c.selected).toBe(-1);
  });

  it('click on no cell does nothing', () => {
    const c = new TapController();
    expect(tap(c, 1, -1, 'mouse')).toEqual(NONE);
  });

  it('drag beyond 6px does not apply and move() reports a drag', () => {
    const c = new TapController();
    expect(SLOP.mouse).toBe(6);
    c.down(1, 0, 0, 'mouse', 0);
    expect(c.move(1, 3, 0)).toBe(false);
    expect(c.move(1, 7, 0)).toBe(true);
    expect(c.dragging).toBe(true);
    expect(c.up(1, 5)).toEqual(NONE);
    expect(c.selected).toBe(-1);
  });

  it('movement of exactly the slop is still a click', () => {
    const c = new TapController();
    c.down(1, 0, 0, 'mouse', 0);
    expect(c.move(1, 6, 0)).toBe(false);
    expect(c.dragging).toBe(false);
    expect(c.up(1, 2)).toEqual({ kind: 'apply', cell: 2 });
  });
});

describe('TapController: touch selection', () => {
  it('first tap selects, second tap on the same cell applies and clears', () => {
    const c = new TapController();
    expect(tap(c, 1, 4)).toEqual({ kind: 'select', cell: 4 });
    expect(c.selected).toBe(4);
    expect(tap(c, 2, 4)).toEqual({ kind: 'apply', cell: 4 });
    expect(c.selected).toBe(-1);
  });

  it('tap on another cell re-selects', () => {
    const c = new TapController();
    tap(c, 1, 4);
    expect(tap(c, 2, 9)).toEqual({ kind: 'select', cell: 9 });
    expect(c.selected).toBe(9);
  });

  it('tap on nothing deselects', () => {
    const c = new TapController();
    tap(c, 1, 4);
    expect(tap(c, 2, -1)).toEqual({ kind: 'deselect' });
    expect(c.selected).toBe(-1);
  });

  it('pen follows the same selection rules as touch', () => {
    const c = new TapController();
    expect(tap(c, 1, 3, 'pen')).toEqual({ kind: 'select', cell: 3 });
    expect(tap(c, 2, 3, 'pen')).toEqual({ kind: 'apply', cell: 3 });
    expect(c.selected).toBe(-1);
  });

  it('clearSelection resets the preview', () => {
    const c = new TapController();
    tap(c, 1, 4);
    c.clearSelection();
    expect(c.selected).toBe(-1);
  });

  it('small jitter within touch slop (8px) still counts as a tap', () => {
    const c = new TapController();
    expect(SLOP.touch).toBe(10);
    c.down(1, 0, 0, 'touch', 0);
    expect(c.move(1, 8, 0)).toBe(false);
    expect(c.dragging).toBe(false);
    expect(c.up(1, 4)).toEqual({ kind: 'select', cell: 4 });
  });
});

describe('TapController: multi-pointer (pinch)', () => {
  it.each([
    ['first finger lifts first', [1, 2]],
    ['second finger lifts first', [2, 1]],
  ])('pinch with real movement never applies or selects (%s)', (_label, order) => {
    const c = new TapController();
    c.down(1, 0, 0, 'touch', 0);
    c.down(2, 100, 100, 'touch', 0);
    expect(c.move(1, 30, 0)).toBe(false);
    expect(c.move(2, 130, 100)).toBe(false);
    expect(c.up(order[0], 4)).toEqual(NONE);
    expect(c.up(order[1], 4)).toEqual(NONE);
    expect(c.selected).toBe(-1);
  });

  it.each([
    ['first finger lifts first', [1, 2]],
    ['second finger lifts first', [2, 1]],
  ])('pinch where fingers barely move still gives none (%s)', (_label, order) => {
    const c = new TapController();
    c.down(1, 0, 0, 'touch', 0);
    c.down(2, 100, 100, 'touch', 0);
    expect(c.move(1, 1, 0)).toBe(false);
    expect(c.move(2, 100, 101)).toBe(false);
    expect(c.up(order[0], 4)).toEqual(NONE);
    expect(c.up(order[1], 4)).toEqual(NONE);
    expect(c.selected).toBe(-1);
  });

  it('up() while another pointer is still down returns none', () => {
    const c = new TapController();
    c.down(1, 0, 0, 'touch', 0);
    c.down(2, 50, 50, 'touch', 0);
    expect(c.up(1, 4)).toEqual(NONE);
    expect(c.active).toBe(1);
  });

  it('multi flag is sticky: a later single finger does not tap', () => {
    const c = new TapController();
    c.down(1, 0, 0, 'touch', 0);
    c.down(2, 0, 0, 'touch', 0);
    c.up(1, 4);
    c.up(2, 4);
    // Fresh gesture is clean again, so a lone tap works.
    expect(tap(c, 3, 4)).toEqual({ kind: 'select', cell: 4 });
  });

  it('move() returns false during multi-touch', () => {
    const c = new TapController();
    c.down(1, 0, 0, 'touch', 0);
    c.down(2, 200, 0, 'touch', 0);
    expect(c.move(1, 80, 0)).toBe(false);
    expect(c.move(2, 260, 0)).toBe(false);
    expect(c.dragging).toBe(true);
  });

  it('cancelling one finger of a pinch still yields none for the other', () => {
    const c = new TapController();
    c.down(1, 0, 0, 'touch', 0);
    c.down(2, 50, 50, 'touch', 0);
    c.cancel(1);
    expect(c.up(2, 4)).toEqual(NONE);
    expect(c.active).toBe(0);
    expect(c.kind).toBe(null);
  });
});

describe('TapController: cancel', () => {
  it('pointercancel mid-tap, then up, gives none', () => {
    const c = new TapController();
    c.down(1, 0, 0, 'touch', 0);
    c.cancel(1);
    expect(c.up(1, 4)).toEqual(NONE);
    expect(c.selected).toBe(-1);
  });

  it('cancel resets the gesture so the next tap works', () => {
    const c = new TapController();
    c.down(1, 0, 0, 'touch', 0);
    c.cancel(1);
    expect(c.active).toBe(0);
    expect(c.kind).toBe(null);
    expect(c.dragging).toBe(false);
    expect(tap(c, 2, 4)).toEqual({ kind: 'select', cell: 4 });
  });

  it('cancel does not reset an existing preview', () => {
    const c = new TapController();
    tap(c, 1, 4);
    c.down(2, 0, 0, 'touch', 0);
    c.cancel(2);
    expect(c.selected).toBe(4);
  });

  it('cancel for an unknown id is a no-op', () => {
    const c = new TapController();
    c.down(1, 0, 0, 'mouse', 0);
    c.cancel(99);
    expect(c.active).toBe(1);
    expect(c.up(1, 2)).toEqual({ kind: 'apply', cell: 2 });
  });
});

describe('TapController: buttons and stale events', () => {
  it('right-button click gives none', () => {
    const c = new TapController();
    c.down(1, 0, 0, 'mouse', 2);
    expect(c.up(1, 3)).toEqual(NONE);
  });

  it('right-button drag does not report a pan', () => {
    const c = new TapController();
    c.down(1, 0, 0, 'mouse', 2);
    expect(c.move(1, 40, 0)).toBe(false);
  });

  it('right-button touch tap never selects', () => {
    const c = new TapController();
    c.down(1, 0, 0, 'touch', 2);
    expect(c.up(1, 4)).toEqual(NONE);
    expect(c.selected).toBe(-1);
  });

  it('stale up for an unknown id gives none and changes nothing', () => {
    const c = new TapController();
    expect(c.up(99, 3)).toEqual(NONE);
    tap(c, 1, 4);
    expect(c.up(1, 4)).toEqual(NONE); // second release of the same id
    expect(c.selected).toBe(4);
  });

  it('kind reports the first pointer of the gesture and resets afterwards', () => {
    const c = new TapController();
    expect(c.kind).toBe(null);
    c.down(1, 0, 0, 'pen', 0);
    expect(c.kind).toBe('pen');
    c.up(1, 2);
    expect(c.kind).toBe(null);
  });
});
