// Touch: a floating move stick on the left of the screen and a floating aim stick anywhere else.
// Both appear where the thumb lands; the aim stick sets direction by how you drag, not where you
// touch, so your thumb never covers the action. Releasing the aim stick keeps the last direction.
// Desktop: WASD / arrow keys move, the mouse aims. The blaster always auto-fires.

export interface Stick { active: boolean; ox: number; oy: number; x: number; y: number }

export class Input {
  moveX = 0;
  moveY = 0;
  aim = -Math.PI / 2;
  /** True while a touch aim stick is held, or the mouse moved within the last second. */
  aimHeld = false;
  /** Set by settings: when not aiming, turn the turret toward the direction of travel. */
  followMove = false;
  joy: Stick = { active: false, ox: 0, oy: 0, x: 0, y: 0 };
  aimStick: Stick = { active: false, ox: 0, oy: 0, x: 0, y: 0 };
  private joyId: number | null = null;
  private aimId: number | null = null;
  private keys = new Set<string>();
  private center = { x: 0, y: 0 };
  private lastMouse = -1e9;
  readonly JOY_R = 56;
  readonly AIM_R = 50;
  private readonly AIM_DEAD = 9;

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.reset());
  }

  setCenter(x: number, y: number) {
    this.center.x = x;
    this.center.y = y;
  }

  reset() {
    this.keys.clear();
    this.joyId = this.aimId = null;
    this.joy.active = false;
    this.aimStick.active = false;
  }

  private down = (e: PointerEvent) => {
    e.preventDefault();
    if (e.pointerType === 'mouse') {
      this.mouseAim(e.clientX, e.clientY);
      return;
    }
    const s = { active: true, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    if (this.joyId === null && e.clientX < this.el.clientWidth * 0.45) {
      this.joyId = e.pointerId;
      this.joy = s;
    } else if (this.aimId === null) {
      this.aimId = e.pointerId;
      this.aimStick = s;
    }
    try { this.el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  };

  private move = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') { this.mouseAim(e.clientX, e.clientY); return; }
    if (e.pointerId === this.joyId) { this.joy.x = e.clientX; this.joy.y = e.clientY; }
    else if (e.pointerId === this.aimId) { this.aimStick.x = e.clientX; this.aimStick.y = e.clientY; }
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId === this.joyId) { this.joyId = null; this.joy.active = false; }
    if (e.pointerId === this.aimId) { this.aimId = null; this.aimStick.active = false; }
  };

  private mouseAim(x: number, y: number) {
    const dx = x - this.center.x, dy = y - this.center.y;
    if (dx * dx + dy * dy > 64) this.aim = Math.atan2(dy, dx);
    this.lastMouse = performance.now();
  }

  /** Keep a floating stick's base within reach of the thumb; returns the offset from the base. */
  private follow(s: Stick, R: number): [number, number] {
    let dx = s.x - s.ox, dy = s.y - s.oy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      s.ox += (dx / d) * (d - R);
      s.oy += (dy / d) * (d - R);
      dx = s.x - s.ox; dy = s.y - s.oy;
    }
    return [dx, dy];
  }

  update() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    if (k.has('w') || k.has('arrowup')) y -= 1;
    if (k.has('s') || k.has('arrowdown')) y += 1;
    if (this.joy.active) {
      const [dx, dy] = this.follow(this.joy, this.JOY_R);
      x += dx / this.JOY_R;
      y += dy / this.JOY_R;
    }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    if (m < 0.12) { x = 0; y = 0; }
    this.moveX = x;
    this.moveY = y;

    let aiming = false;
    if (this.aimStick.active) {
      const [dx, dy] = this.follow(this.aimStick, this.AIM_R);
      if (dx * dx + dy * dy > this.AIM_DEAD * this.AIM_DEAD) { this.aim = Math.atan2(dy, dx); aiming = true; }
      else aiming = true; // thumb is down: hold the current aim, don't hand over to auto
    }
    const mouseRecent = performance.now() - this.lastMouse < 1000;
    this.aimHeld = aiming || mouseRecent;
    if (!this.aimHeld && this.followMove && (x || y) && performance.now() - this.lastMouse > 3000) {
      this.aim = Math.atan2(y, x);
    }
  }
}
