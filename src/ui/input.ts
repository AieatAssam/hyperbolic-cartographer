// Pure pointer-gesture controller. No DOM types, no window: the caller forwards
// pointer events as (id, coordinates, kind, button) and performs whatever TapAction comes back.

export type PointerKind = 'mouse' | 'touch' | 'pen';

export type TapAction =
  | { kind: 'none' }
  | { kind: 'apply'; cell: number }    // perform the tool action on cell now
  | { kind: 'select'; cell: number }   // touch/pen first tap: preview cell, do not buy
  | { kind: 'deselect' };              // touch tap on nothing: clear preview

/** px of movement (from a pointer's own start) before a press becomes a drag. */
export const SLOP = { mouse: 6, touch: 10, pen: 8 };

interface Tracked {
  x: number;
  y: number;
  kind: PointerKind;
}

const NONE: TapAction = { kind: 'none' };

export class TapController {
  /** Currently previewed cell, -1 if none. */
  selected = -1;

  private pointers = new Map<number, Tracked>();
  private gestureKind: PointerKind | null = null;
  private multi = false;      // 2+ pointers were down at some point in this gesture
  private moved = false;      // some pointer moved beyond its slop
  private cancelled = false;  // pointercancel / lostpointercapture arrived
  private primary = true;     // every button seen this gesture was button 0

  /** Pointer went down. button: 0 primary. */
  down(id: number, x: number, y: number, kind: PointerKind, button: number): void {
    if (this.pointers.size === 0) this.gestureKind = kind;
    if (button !== 0) this.primary = false;
    this.pointers.set(id, { x, y, kind });
    if (this.pointers.size >= 2) this.multi = true;
  }

  /** Pointer moved. Returns true only while this is a single-pointer primary drag (caller may pan). */
  move(id: number, x: number, y: number): boolean {
    const p = this.pointers.get(id);
    if (!p) return false;
    if (!this.moved && Math.hypot(x - p.x, y - p.y) > SLOP[p.kind]) this.moved = true;
    return this.pointers.size === 1 && !this.multi && this.primary && this.moved && !this.cancelled;
  }

  /** Pointer released over `cell` (-1 if not on a cell). Returns the action to perform. */
  up(id: number, cell: number): TapAction {
    const p = this.pointers.get(id);
    if (!p) return NONE;
    const eligible = !this.multi && !this.moved && !this.cancelled && this.primary;
    this.pointers.delete(id);
    if (this.pointers.size > 0) return NONE;
    this.endGesture();
    if (!eligible) return NONE;

    if (p.kind === 'mouse') return cell >= 0 ? { kind: 'apply', cell } : NONE;
    if (cell < 0) {
      this.selected = -1;
      return { kind: 'deselect' };
    }
    if (cell === this.selected) {
      this.selected = -1;
      return { kind: 'apply', cell };
    }
    this.selected = cell;
    return { kind: 'select', cell };
  }

  /** pointercancel / lostpointercapture: forget pointer, abort gesture (never places). */
  cancel(id: number): void {
    if (!this.pointers.delete(id)) return;
    this.cancelled = true;
    if (this.pointers.size === 0) this.endGesture();
  }

  clearSelection(): void {
    this.selected = -1;
  }

  /** Number of pointers currently down. */
  get active(): number {
    return this.pointers.size;
  }

  /** Current gesture has moved beyond slop or is multi-touch. */
  get dragging(): boolean {
    return this.moved || this.multi;
  }

  /** Kind of the current gesture's first pointer, null when no gesture is in progress. */
  get kind(): PointerKind | null {
    return this.gestureKind;
  }

  private endGesture(): void {
    this.gestureKind = null;
    this.multi = false;
    this.moved = false;
    this.cancelled = false;
    this.primary = true;
  }
}
