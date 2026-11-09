// First-play prompts: one line at a time, each disappears once the player does it.
import type { Game } from './game';
import type { Input } from './input';

const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

interface Step { text: string; done: (g: Game, i: Input, shopOpen: boolean) => boolean; maxTime?: number; when?: (g: Game) => boolean }

export class Tutorial {
  private i = 0;
  private t = 0;
  private start = { x: 0, y: 0, aim: 0 };
  finished = false;
  private steps: Step[];

  constructor(g: Game, input: Input) {
    this.start = { x: g.player.x, y: g.player.y, aim: input.aim };
    this.steps = [
      {
        text: touch ? 'Drag on the left side to move' : 'Move with W A S D',
        done: g => Math.hypot(g.player.x - this.start.x, g.player.y - this.start.y) > 50,
      },
      {
        text: touch ? 'Drag on the right side to aim. Your blaster fires on its own' : 'Aim with the mouse. Your blaster fires on its own',
        done: (_g, i) => Math.abs(Math.atan2(Math.sin(i.aim - this.start.aim), Math.cos(i.aim - this.start.aim))) > 0.4,
      },
      {
        text: 'Gems drop Shards. Open the Shop to upgrade',
        when: g => g.anythingAffordable(),
        done: (_g, _i, shop) => shop,
        maxTime: 30,
      },
      {
        text: 'Specialty shots: buy one in the Shop, then tap its button to fire it',
        done: g => Object.values(g.shots).some(s => s.active > 0 || s.cd > 0),
        maxTime: 30,
      },
      {
        text: 'Follow the gold arrow and break the Keystone',
        done: () => false,
        maxTime: 7,
      },
    ];
  }

  /** Returns the prompt to show this frame, or null. */
  update(g: Game, input: Input, shopOpen: boolean, dt: number): string | null {
    if (this.finished) return null;
    const s = this.steps[this.i];
    if (s.when && !s.when(g)) return null;
    this.t += dt;
    if (s.done(g, input, shopOpen) || (s.maxTime && this.t > s.maxTime)) {
      this.i++;
      this.t = 0;
      if (this.i === 1) this.start.aim = input.aim;
      if (this.i >= this.steps.length) { this.finished = true; return null; }
      return null;
    }
    return shopOpen ? null : s.text;
  }
}
