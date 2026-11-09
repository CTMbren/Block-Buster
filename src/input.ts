// Touch: a floating joystick on the left of the screen moves, any other touch aims.
// Desktop: WASD / arrow keys move, the mouse aims. The blaster always auto-fires.

export class Input {
  moveX = 0;
  moveY = 0;
  aim = -Math.PI / 2;
  joy = { active: false, ox: 0, oy: 0, x: 0, y: 0 };
  private joyId: number | null = null;
  private aimId: number | null = null;
  private keys = new Set<string>();
  private center = { x: 0, y: 0 };
  readonly JOY_R = 56;

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
  }

  private down = (e: PointerEvent) => {
    e.preventDefault();
    const touchLike = e.pointerType !== 'mouse';
    if (touchLike && this.joyId === null && e.clientX < this.el.clientWidth * 0.45) {
      this.joyId = e.pointerId;
      this.joy = { active: true, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    } else {
      this.aimId = e.pointerId;
      this.setAim(e.clientX, e.clientY);
    }
    this.el.setPointerCapture?.(e.pointerId);
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId === this.joyId) {
      this.joy.x = e.clientX;
      this.joy.y = e.clientY;
    } else if (e.pointerId === this.aimId || e.pointerType === 'mouse') {
      this.setAim(e.clientX, e.clientY);
    }
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.joy.active = false;
    }
    if (e.pointerId === this.aimId) this.aimId = null;
  };

  private setAim(x: number, y: number) {
    const dx = x - this.center.x, dy = y - this.center.y;
    if (dx * dx + dy * dy > 64) this.aim = Math.atan2(dy, dx);
  }

  update() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    if (k.has('w') || k.has('arrowup')) y -= 1;
    if (k.has('s') || k.has('arrowdown')) y += 1;
    if (this.joy.active) {
      let dx = this.joy.x - this.joy.ox, dy = this.joy.y - this.joy.oy;
      const d = Math.hypot(dx, dy);
      if (d > this.JOY_R) { // drag the joystick base along so it never feels stuck
        this.joy.ox += (dx / d) * (d - this.JOY_R);
        this.joy.oy += (dy / d) * (d - this.JOY_R);
        dx = this.joy.x - this.joy.ox; dy = this.joy.y - this.joy.oy;
      }
      x += dx / this.JOY_R;
      y += dy / this.JOY_R;
    }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    if (m < 0.12) { x = 0; y = 0; }
    this.moveX = x;
    this.moveY = y;
  }
}
