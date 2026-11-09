// Canvas renderer in the "crystal mine" style: faceted gems in dark stone, lit by the rig's lantern.
import { HEX_R, HEX_W, hexCorners, hexPath } from './hex';
import { Kind, LINK_WINDOW, type Cell } from './level';
import { gemTier, type Game } from './game';
import type { Input, Stick } from './input';

const TIERS = [ // index 0 = grey stone (one hit left) .. 6 = amethyst
  { h: 28, s: 6, l: 44 }, { h: 350, s: 78, l: 46 }, { h: 27, s: 92, l: 49 }, { h: 46, s: 92, l: 54 },
  { h: 152, s: 70, l: 40 }, { h: 218, s: 80, l: 50 }, { h: 276, s: 66, l: 54 },
];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h} ${clamp(s, 0, 100)}% ${clamp(l, 3, 97)}% / ${a})`;
const LIGHT = { x: -0.55, y: -0.83 }; // sprites are lit from the upper left

type Sprite = HTMLCanvasElement;

export class Renderer {
  ctx: CanvasRenderingContext2D;
  w = 0; h = 0; dpr = 1; zoom = 1;
  private gem: Sprite[] = [];
  private gemCracked: Sprite[] = [];
  private floor: Sprite[] = [];
  private bedrock: Sprite[] = [];
  private keystone!: Sprite;
  private generator!: Sprite;
  private armor!: Sprite;
  private ore: Sprite[] = [];
  private spritePx = 0;
  private t = 0;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.zoom = clamp(Math.min(this.w, this.h * 0.75) / (HEX_W * 10), 0.6, 1.9);
    this.buildSprites();
  }

  // ---------------- sprites ----------------
  private makeCanvas(): [Sprite, CanvasRenderingContext2D, number] {
    const px = Math.ceil(HEX_R * 2.4 * this.zoom * this.dpr);
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d')!;
    const k = px / (HEX_R * 2.4);
    g.setTransform(k, 0, 0, k, px / 2, px / 2);
    return [c, g, k];
  }

  private buildSprites() {
    this.spritePx = Math.ceil(HEX_R * 2.4 * this.zoom * this.dpr);
    this.gem = TIERS.map((_, i) => this.drawGem(i, false));
    this.gemCracked = TIERS.map((_, i) => this.drawGem(i, true));
    this.floor = [0, 1, 2].map(i => this.drawFloor(i));
    this.bedrock = [0, 1].map(i => this.drawBedrock(i));
    this.keystone = this.drawKeystoneCell();
    this.generator = this.drawGenerator();
    this.armor = this.drawArmor();
    this.ore = [0, 1, 2].map(i => this.drawOre(i));
  }

  private poly(g: CanvasRenderingContext2D, pts: [number, number][]) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  }

  private drawGem(tier: number, cracked: boolean): Sprite {
    const [c, g] = this.makeCanvas();
    const T = TIERS[tier];
    const outer = hexCorners(0, 0, HEX_R * 0.86);
    const inner = hexCorners(LIGHT.x * 2.2, LIGHT.y * 2.2, HEX_R * 0.47);
    // shadow cast down-right, away from the light
    this.poly(g, hexCorners(3.5, 4.5, HEX_R * 0.86)); g.fillStyle = 'rgba(0,0,0,.55)'; g.fill();
    let best = -2, bi = 0;
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      const na = (Math.PI / 180) * (60 * i);
      const dot = Math.cos(na) * LIGHT.x + Math.sin(na) * LIGHT.y; // >0 faces the light
      if (dot > best) { best = dot; bi = i; }
      this.poly(g, [outer[i], outer[j], inner[j], inner[i]]);
      g.fillStyle = hsl(T.h, T.s + (dot < 0 ? 6 : -4), T.l + dot * 19 - 5 + (i % 2 ? 3 : 0));
      g.fill();
    }
    this.poly(g, inner);
    g.fillStyle = hsl(T.h, T.s - 6, T.l + 9); g.fill();
    g.strokeStyle = hsl(T.h, T.s, T.l + 30, 0.55); g.lineWidth = 0.8; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 0.7;
    for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(...outer[i]); g.lineTo(...inner[i]); g.stroke(); }
    this.poly(g, outer); g.strokeStyle = '#120b07'; g.lineWidth = 1.4; g.stroke();
    // specular rim on the edge facing the light
    g.beginPath(); g.moveTo(...outer[bi]); g.lineTo(...outer[(bi + 1) % 6]);
    g.strokeStyle = 'rgba(255,247,224,.7)'; g.lineWidth = 1.6; g.lineCap = 'round'; g.stroke();
    // small sparkle
    g.fillStyle = 'rgba(255,251,232,.85)';
    g.beginPath(); g.arc(-5, -6, 1.3, 0, Math.PI * 2); g.fill();
    if (cracked || tier === 0) {
      g.strokeStyle = '#0c0806'; g.lineWidth = tier === 0 ? 1.6 : 1.1; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(11, -6); g.moveTo(0, 0); g.lineTo(-7, 9); g.lineTo(-11, 7);
      g.moveTo(0, 0); g.lineTo(3, 11);
      g.stroke();
    }
    return c;
  }

  private drawFloor(v: number): Sprite {
    const [c, g] = this.makeCanvas();
    this.poly(g, hexCorners(0, 0, HEX_R * 1.03));
    const grd = g.createLinearGradient(-HEX_R, -HEX_R, HEX_R, HEX_R);
    grd.addColorStop(0, ['#4a3a2e', '#463629', '#4d3d31'][v]);
    grd.addColorStop(1, ['#33271f', '#2f241c', '#362a21'][v]);
    g.fillStyle = grd; g.fill();
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.stroke();
    // scratches and pebbles
    g.strokeStyle = 'rgba(255,230,200,.07)'; g.lineWidth = 0.8;
    for (let i = 0; i < 3; i++) {
      const a = v * 2 + i * 2.1;
      g.beginPath(); g.moveTo(Math.cos(a) * 8, Math.sin(a) * 8); g.lineTo(Math.cos(a) * 8 + 7, Math.sin(a) * 8 + 2); g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,.3)';
    for (let i = 0; i < 4; i++) { const a = v + i * 1.7; g.beginPath(); g.arc(Math.cos(a) * 11, Math.sin(a) * 10, 1.2 + (i % 2), 0, 7); g.fill(); }
    return c;
  }

  private drawBedrock(v: number): Sprite {
    const [c, g] = this.makeCanvas();
    const o = hexCorners(0, 0, HEX_R * 1.02);
    this.poly(g, o);
    const grd = g.createLinearGradient(-HEX_R, -HEX_R, HEX_R, HEX_R);
    grd.addColorStop(0, v ? '#5d5866' : '#56515f');
    grd.addColorStop(1, v ? '#2b2832' : '#26232c');
    g.fillStyle = grd; g.fill();
    // bevel: lit top-left edges, dark bottom-right edges
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6, na = (Math.PI / 180) * (60 * i);
      const dot = Math.cos(na) * LIGHT.x + Math.sin(na) * LIGHT.y;
      g.beginPath(); g.moveTo(...o[i]); g.lineTo(...o[j]);
      g.strokeStyle = dot > 0 ? `rgba(200,195,215,${0.35 * dot})` : `rgba(0,0,0,${-0.6 * dot})`;
      g.lineWidth = 2.5; g.stroke();
    }
    // cracks and grain
    g.strokeStyle = 'rgba(15,13,18,.55)'; g.lineWidth = 1; g.lineCap = 'round';
    g.beginPath();
    const a = v * 2.3;
    g.moveTo(Math.cos(a) * 14, Math.sin(a) * 14); g.lineTo(Math.cos(a) * 3, Math.sin(a) * 5); g.lineTo(Math.cos(a + 2) * 9, Math.sin(a + 2) * 10);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,.07)';
    for (let i = 0; i < 6; i++) { const b = v * 3 + i * 1.1; g.beginPath(); g.arc(Math.cos(b) * 11, Math.sin(b) * 10, 1.4, 0, 7); g.fill(); }
    return c;
  }

  private drawKeystoneCell(): Sprite {
    const [c, g] = this.makeCanvas();
    const outer = hexCorners(0, 0, HEX_R * 0.98);
    const inner = hexCorners(-2, -3, HEX_R * 0.5);
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      this.poly(g, [outer[i], outer[j], inner[j], inner[i]]);
      g.fillStyle = hsl(42, 90, 58 + (i < 3 ? 14 : -6) - i * 2);
      g.fill();
    }
    this.poly(g, inner); g.fillStyle = '#fff3c8'; g.fill();
    this.poly(g, outer); g.strokeStyle = '#5a3a08'; g.lineWidth = 1.5; g.stroke();
    return c;
  }

  private drawGenerator(): Sprite {
    const [c, g] = this.makeCanvas();
    const o = hexCorners(0, 0, HEX_R * 0.95);
    this.poly(g, o); g.fillStyle = '#1d1a18'; g.fill();
    const br = g.createLinearGradient(-HEX_R, -HEX_R, HEX_R, HEX_R);
    br.addColorStop(0, '#f3d68f'); br.addColorStop(0.5, '#c99a45'); br.addColorStop(1, '#7d5a22');
    g.strokeStyle = br; g.lineWidth = 3.2; g.stroke();
    for (let i = 0; i < 6; i += 2) { g.fillStyle = '#c99a45'; g.fillRect(o[i][0] - 2.5, o[i][1] - 2.5, 5, 5); }
    this.poly(g, hexCorners(0, 0, HEX_R * 0.55)); g.fillStyle = '#0b2a3a'; g.fill();
    g.strokeStyle = 'rgba(127,230,255,.6)'; g.lineWidth = 1; g.stroke();
    return c;
  }

  private drawArmor(): Sprite {
    const [c, g] = this.makeCanvas();
    const o = hexCorners(0, 0, HEX_R * 0.86);
    this.poly(g, o);
    const st = g.createLinearGradient(-HEX_R, -HEX_R, HEX_R, HEX_R);
    st.addColorStop(0, '#eef3f6'); st.addColorStop(0.5, '#8d979e'); st.addColorStop(1, '#3a4248');
    g.strokeStyle = st; g.lineWidth = 4; g.stroke();
    for (const p of o) { g.beginPath(); g.arc(p[0], p[1], 2, 0, 7); g.fillStyle = '#dfe6ea'; g.fill(); g.strokeStyle = '#2a2f33'; g.lineWidth = 0.7; g.stroke(); }
    return c;
  }

  private drawOre(v: number): Sprite {
    const [c, g] = this.makeCanvas();
    const grd = g.createLinearGradient(-15, 8, 15, -8);
    ['#ff6fd8', '#ffd36f', '#6fffb0', '#6fc8ff', '#c56fff'].forEach((col, i) => grd.addColorStop(i / 4, col));
    g.strokeStyle = grd; g.lineCap = 'round'; g.lineJoin = 'round';
    const k = v * 3;
    g.lineWidth = 2.8;
    g.beginPath(); g.moveTo(-15, 6 + k); g.lineTo(-5, -2); g.lineTo(3, 4); g.lineTo(15, -8); g.stroke();
    g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(-6, 12); g.lineTo(2, 8); g.lineTo(9, 13); g.stroke();
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(-8, -12); g.lineTo(-2, -8); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(-15, 6 + k); g.lineTo(-5, -2); g.lineTo(3, 4); g.lineTo(15, -8); g.stroke();
    return c;
  }

  // ---------------- frame ----------------
  draw(game: Game, input: Input, dt: number, menu = false) {
    this.t += dt;
    const { ctx, w, h, dpr, zoom } = this;
    const p = game.player;
    const shake = game.shake;
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    const camX = p.x, camY = p.y;
    const S = zoom * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#120d0a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(S, 0, 0, S, (w / 2 + sx) * dpr - camX * S, (h / 2 + sy) * dpr - camY * S);

    const halfW = w / 2 / zoom + HEX_W, halfH = h / 2 / zoom + HEX_W;
    const vis: Cell[] = [];
    for (const c of game.level.cells) if (Math.abs(c.x - camX) < halfW && Math.abs(c.y - camY) < halfH) vis.push(c);

    const spr = this.spritePx / S; // sprite size in world units
    const blit = (img: Sprite, x: number, y: number) => ctx.drawImage(img, x - spr / 2, y - spr / 2, spr, spr);
    const dmg = game.blaster.damage;
    const base = game.level.hpUnit;

    for (const c of vis) if (c.kind === Kind.Floor) blit(this.floor[Math.floor(c.shade * 3)], c.x, c.y);
    for (const c of vis) {
      switch (c.kind) {
        case Kind.Bedrock: blit(this.bedrock[c.shade > 0.5 ? 1 : 0], c.x, c.y); break;
        case Kind.Gem: {
          const tier = gemTier(c, base, dmg);
          const cracked = c.hp < c.maxHp * 0.5;
          blit(cracked ? this.gemCracked[tier] : this.gem[tier], c.x, c.y);
          if (c.armor) blit(this.armor, c.x, c.y);
          if (c.ore) blit(this.ore[Math.floor(c.shade * 3)], c.x, c.y);
          break;
        }
        case Kind.Generator: blit(this.generator, c.x, c.y); break;
        case Kind.Keystone: blit(this.keystone, c.x, c.y); break;
      }
    }

    // animated overlays
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 5);
    for (const c of vis) {
      if (c.kind === Kind.Gem && c.gold) {
        ctx.beginPath(); hexPath(ctx, c.x, c.y, HEX_R * 0.92);
        ctx.strokeStyle = `rgba(255,226,122,${0.65 + 0.35 * pulse})`; ctx.lineWidth = 3.4; ctx.stroke();
        ctx.strokeStyle = `rgba(255,226,122,${0.15 + 0.2 * pulse})`; ctx.lineWidth = 8; ctx.stroke();
        this.star(c.x, c.y, 5.5, '#fff0b0');
      }
      if (c.kind === Kind.Gem && (c.geode || c.oreAmt > 2 || (c.ore && game.gateOpen))) {
        // geodes and deposits shimmer; during the collapse every Ore gem glows (double Ore)
        const hue = (this.t * 90 + c.shade * 360) % 360;
        const a = c.geode ? 0.55 : game.gateOpen ? 0.5 + 0.3 * pulse : 0.3;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath(); hexPath(ctx, c.x, c.y, HEX_R * (c.geode ? 0.62 : 0.5));
        ctx.fillStyle = `hsla(${hue} 90% 70% / ${a * 0.35})`; ctx.fill();
        ctx.strokeStyle = `hsla(${hue} 90% 75% / ${a})`; ctx.lineWidth = c.geode ? 2.4 : 1.4; ctx.stroke();
        ctx.restore();
        if (c.geode) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(c.x + 4, c.y - 5, 1.6 + pulse, 0, 7); ctx.fill(); }
      }
      if (c.kind === Kind.Gem && c.regen) {
        const healing = c.hp < c.maxHp && c.idleT >= 2 && c.poisonT <= 0;
        ctx.strokeStyle = `rgba(150,255,170,${healing ? 0.5 + 0.4 * pulse : 0.35})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(c.x - 5, c.y); ctx.lineTo(c.x + 5, c.y); ctx.moveTo(c.x, c.y - 5); ctx.lineTo(c.x, c.y + 5); ctx.stroke();
        if (healing) { ctx.beginPath(); hexPath(ctx, c.x, c.y, HEX_R * 0.8); ctx.stroke(); }
      }
      if (c.kind === Kind.Gem && c.boom) {
        const r = 6 + 3 * pulse;
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * 1.6);
        g.addColorStop(0, '#fff4c4'); g.addColorStop(0.4, '#ff9a3a'); g.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, r * 1.6, 0, 7); ctx.fill();
      }
      if (c.kind === Kind.Generator) {
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 9 + 3 * pulse);
        g.addColorStop(0, '#e8fbff'); g.addColorStop(0.5, '#7fe6ff'); g.addColorStop(1, 'rgba(127,230,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, 12, 0, 7); ctx.fill();
      }
      if (c.poisonT > 0 && c.kind === Kind.Gem) {
        ctx.fillStyle = `rgba(120,255,140,${0.18 + 0.1 * pulse})`;
        ctx.beginPath(); hexPath(ctx, c.x, c.y, HEX_R * 0.8); ctx.fill();
      }
      if (c.flash > 0 && c.kind !== Kind.Floor && c.kind !== Kind.Bedrock) {
        ctx.fillStyle = `rgba(255,255,255,${c.flash * 0.55})`;
        ctx.beginPath(); hexPath(ctx, c.x, c.y, HEX_R * 0.86); ctx.fill();
      }
    }

    this.drawKeystoneAndField(game);
    if (!menu) { this.drawLaser(game); this.drawTargetBracket(game); }
    this.drawProjectiles(game);
    this.drawPlayer(game);
    this.drawParticles(game);
    this.drawBlasts(game);

    // lantern lighting: everything far from the rig fades into the dark
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R = Math.max(w, h);
    const cx = w / 2 + sx, cy = h / 2 + sy;
    const dark = ctx.createRadialGradient(cx, cy, 60 * zoom, cx, cy, R * 0.58);
    dark.addColorStop(0, 'rgba(10,6,4,0)');
    dark.addColorStop(0.3, 'rgba(10,6,4,.4)');
    dark.addColorStop(0.65, 'rgba(10,6,4,.78)');
    dark.addColorStop(1, 'rgba(10,6,4,.94)');
    ctx.fillStyle = dark; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    const flick = 0.16 + 0.03 * Math.sin(this.t * 13) + 0.015 * Math.sin(this.t * 7.3);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 200 * zoom);
    glow.addColorStop(0, `rgba(255,179,90,${flick})`); glow.addColorStop(1, 'rgba(255,179,90,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    // floating text (screen space, after lighting so it stays readable)
    for (const f of game.floaters) {
      const fx = (f.x - camX) * zoom + w / 2, fy = (f.y - camY) * zoom + h / 2;
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.font = `${f.big ? 700 : 600} ${f.big ? 20 : 13}px "Barlow Semi Condensed", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(f.text, fx, fy);
      ctx.fillStyle = f.color; ctx.fillText(f.text, fx, fy);
    }
    ctx.globalAlpha = 1;
    if (menu) return;
    this.drawCombo(game);
    this.drawArrows(game);
    this.drawStick(input.joy, input.JOY_R, '201,154,69', '243,214,143');
    this.drawStick(input.aimStick, input.AIM_R, '90,190,220', '170,235,255');
  }

  /** Laser sight: where the shot will land, including the bounce path while Ricochet is active. */
  private drawLaser(game: Game) {
    const ctx = this.ctx;
    const p = game.player;
    let x = p.x + Math.cos(p.angle) * 16, y = p.y + Math.sin(p.angle) * 16;
    let dx = Math.cos(p.angle), dy = Math.sin(p.angle);
    let left = game.blaster.range * HEX_W;
    let bounces = game.shots.ricochet.active > 0 ? Math.min(2, game.shotStats('ricochet').bounces) : 0;
    let pierce = game.shots.piercing.active > 0 ? game.shotStats('piercing').pierces : 0;
    const segs: [number, number, number, number, boolean][] = [];
    let sx = x, sy = y, bounced = false, last: Cell | null = null, end = false;
    while (left > 0 && !end) {
      x += dx * 5; y += dy * 5; left -= 5;
      const c = game.cellAtPixel(x, y);
      if (!c) break;
      if (c === last || c.kind === Kind.Floor) { if (c !== last) last = null; continue; }
      const hard = c.kind === Kind.Bedrock || (c.kind === Kind.Keystone && game.shielded);
      if (!hard && pierce > 0) { pierce--; last = c; continue; }
      segs.push([sx, sy, x, y, bounced]);
      if (bounces > 0) {
        const edge = Math.round(Math.atan2(y - c.y, x - c.x) / (Math.PI / 3)) * (Math.PI / 3);
        const nx = Math.cos(edge), ny = Math.sin(edge);
        const dot = dx * nx + dy * ny;
        if (dot < 0) { dx -= 2 * dot * nx; dy -= 2 * dot * ny; }
        x = c.x + nx * (HEX_R * 0.87 + 1.5); y = c.y + ny * (HEX_R * 0.87 + 1.5);
        sx = x; sy = y; bounces--; bounced = true; last = null;
      } else end = true;
    }
    if (!end) segs.push([sx, sy, x, y, bounced]);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.setLineDash([6, 7]);
    ctx.lineDashOffset = -this.t * 30;
    for (const [ax, ay, bx, by, b] of segs) {
      ctx.strokeStyle = b ? 'rgba(127,230,255,.55)' : 'rgba(255,214,150,.38)';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.setLineDash([]);
    const tail = segs[segs.length - 1];
    if (tail && end) {
      ctx.fillStyle = 'rgba(255,230,180,.75)';
      ctx.beginPath(); ctx.arc(tail[2], tail[3], 2.6, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  /** Corner brackets on the gem Smart Aim has picked. */
  private drawTargetBracket(game: Game) {
    const c = game.autoAiming ? game.autoTarget : null;
    if (!c) return;
    const ctx = this.ctx;
    const r = HEX_R * 1.05, k = 6;
    ctx.save();
    ctx.strokeStyle = c.gold ? '#ffe27a' : '#9ff0ff';
    ctx.lineWidth = 2;
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 6;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = c.x + sx * r, y = c.y + sy * r;
      ctx.beginPath(); ctx.moveTo(x - sx * k, y); ctx.lineTo(x, y); ctx.lineTo(x, y - sy * k); ctx.stroke();
    }
    ctx.restore();
  }

  private star(x: number, y: number, r: number, col: string) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  }

  private drawKeystoneAndField(game: Game) {
    const ctx = this.ctx;
    const k = game.level.keystone;
    const t = this.t;
    if (!k.broken) {
      // golden glow around the keystone
      const g = ctx.createRadialGradient(k.x, k.y, HEX_W * 0.5, k.x, k.y, HEX_W * 2.4);
      g.addColorStop(0, `rgba(255,214,120,${0.25 + 0.1 * Math.sin(t * 2.4)})`); g.addColorStop(1, 'rgba(255,214,120,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(k.x, k.y, HEX_W * 2.4, 0, 7); ctx.fill();
      // HP ring
      const frac = Math.max(0, k.hp / k.maxHp);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.beginPath(); ctx.arc(k.x, k.y, HEX_W * 1.75, 0, 7); ctx.stroke();
      ctx.strokeStyle = '#ffd27c';
      ctx.beginPath(); ctx.arc(k.x, k.y, HEX_W * 1.75, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
    }
    if (game.shielded) {
      // linked generator pairs: a pink tether, and a ghost with a countdown while one waits for its twin
      for (const gen of game.level.generators) {
        if (gen.link && gen.link !== undefined && game.level.generators.indexOf(gen) < game.level.generators.indexOf(gen.link)) {
          ctx.save();
          ctx.strokeStyle = 'rgba(255,154,230,.35)'; ctx.lineWidth = 2; ctx.setLineDash([3, 9]);
          ctx.lineDashOffset = t * 20;
          ctx.beginPath(); ctx.moveTo(gen.x, gen.y); ctx.lineTo(gen.link.x, gen.link.y); ctx.stroke();
          ctx.restore();
        }
        if (gen.relinkT && gen.relinkT > 0) {
          const f = gen.relinkT / LINK_WINDOW;
          ctx.save();
          ctx.strokeStyle = 'rgba(255,154,230,.9)'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(gen.x, gen.y, HEX_R * 0.9, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke();
          ctx.fillStyle = '#ffd0f2'; ctx.font = '700 14px "Barlow Semi Condensed", system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(gen.relinkT.toFixed(1), gen.x, gen.y + 5);
          ctx.restore();
        }
      }
      // HP rings on damaged generators
      for (const gen of game.level.generators) {
        if (gen.broken || gen.hp >= gen.maxHp) continue;
        const f = Math.max(0, gen.hp / gen.maxHp);
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.55)';
        ctx.beginPath(); ctx.arc(gen.x, gen.y, HEX_R * 1.15, 0, 7); ctx.stroke();
        ctx.strokeStyle = gen.link ? '#ff9ae6' : '#7fe6ff';
        ctx.beginPath(); ctx.arc(gen.x, gen.y, HEX_R * 1.15, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke();
      }
      // beams from each generator
      for (const gen of game.level.generators) {
        if (gen.broken) continue;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(127,230,255,.22)'; ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(gen.x, gen.y); ctx.lineTo(k.x, k.y); ctx.stroke();
        ctx.strokeStyle = 'rgba(200,245,255,.75)'; ctx.lineWidth = 1.6;
        ctx.setLineDash([10, 14]); ctx.lineDashOffset = -t * 60;
        ctx.beginPath(); ctx.moveTo(gen.x, gen.y); ctx.lineTo(k.x, k.y); ctx.stroke();
        ctx.restore();
      }
      // the bubble
      const r = HEX_W * 2.05;
      ctx.save();
      ctx.beginPath(); ctx.arc(k.x, k.y, r, 0, 7);
      ctx.fillStyle = `rgba(127,230,255,${0.08 + 0.04 * Math.sin(t * 3)})`; ctx.fill();
      ctx.strokeStyle = 'rgba(160,240,255,.8)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.clip();
      ctx.strokeStyle = 'rgba(160,240,255,.18)'; ctx.lineWidth = 1;
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
        ctx.beginPath(); hexPath(ctx, k.x + i * 14 + (j % 2) * 7, k.y + j * 12, 8); ctx.stroke();
      }
      ctx.restore();
    }
    if (game.gateOpen) {
      ctx.save();
      ctx.translate(k.x, k.y);
      for (let i = 0; i < 3; i++) {
        ctx.rotate(t * (1.5 + i * 0.6));
        ctx.strokeStyle = ['#ffe9a8', '#7fe6ff', '#b9a2ff'][i]; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, 14 + i * 6, 0, Math.PI * 1.3); ctx.stroke();
      }
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 22);
      g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,233,168,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 22, 0, 7); ctx.fill();
      ctx.restore();
    }
  }

  private drawProjectiles(game: Game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of game.projectiles) {
      const sp = Math.hypot(p.vx, p.vy);
      const tx = (p.vx / sp) * 9, ty = (p.vy / sp) * 9;
      ctx.strokeStyle = p.color; ctx.globalAlpha = 0.35; ctx.lineWidth = p.crit ? 7 : 5;
      ctx.beginPath(); ctx.moveTo(p.x - tx, p.y - ty); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = p.crit ? 3 : 2;
      ctx.strokeStyle = '#fffbe8';
      ctx.beginPath(); ctx.moveTo(p.x - tx * 0.6, p.y - ty * 0.6); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    ctx.restore();
  }

  private drawPlayer(game: Game) {
    const ctx = this.ctx;
    const p = game.player;
    ctx.save();
    ctx.translate(p.x, p.y);
    // treads/base
    ctx.beginPath(); hexPath(ctx, 0, 0, 14);
    ctx.fillStyle = '#2b221c'; ctx.fill();
    ctx.strokeStyle = '#c99a45'; ctx.lineWidth = 2; ctx.stroke();
    ctx.rotate(p.angle);
    // barrel
    const br = ctx.createLinearGradient(0, -4, 0, 4);
    br.addColorStop(0, '#f3d68f'); br.addColorStop(1, '#7d5a22');
    ctx.fillStyle = br; ctx.fillRect(2, -3.5, 17, 7);
    ctx.fillStyle = '#3b2f26'; ctx.fillRect(16, -4.5, 4, 9);
    // dome with lantern
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7);
    const d = ctx.createRadialGradient(-2, -3, 1, 0, 0, 8);
    d.addColorStop(0, '#fff3c8'); d.addColorStop(0.4, '#ffb35a'); d.addColorStop(1, '#8a4a12');
    ctx.fillStyle = d; ctx.fill();
    ctx.restore();
  }

  /** Expanding shockwave out to the blast radius. */
  private drawBlasts(game: Game) {
    const ctx = this.ctx;
    for (const b of game.blasts) {
      const k = b.t / 0.45, e = 1 - Math.pow(1 - k, 3);
      const r = Math.max(4, b.r * e + HEX_W * 0.4);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
      g.addColorStop(0, `rgba(255,240,190,${0.5 * (1 - k)})`);
      g.addColorStop(0.6, `rgba(255,140,50,${0.25 * (1 - k)})`);
      g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(255,200,120,${0.85 * (1 - k)})`; ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 7); ctx.stroke();
      ctx.restore();
    }
  }

  private drawParticles(game: Game) {
    const ctx = this.ctx;
    for (const pt of game.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, pt.life / pt.max * 1.4));
      ctx.fillStyle = pt.color;
      if (pt.kind === 1) { ctx.fillRect(pt.x - 1, pt.y - 1, 2, 2); continue; }
      ctx.save();
      ctx.translate(pt.x, pt.y); ctx.rotate(pt.rot);
      ctx.beginPath(); ctx.moveTo(0, -pt.size); ctx.lineTo(pt.size * 0.8, pt.size * 0.6); ctx.lineTo(-pt.size * 0.7, pt.size * 0.5); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.beginPath(); ctx.moveTo(0, -pt.size); ctx.lineTo(pt.size * 0.3, 0); ctx.lineTo(-pt.size * 0.2, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private drawCombo(game: Game) {
    if (game.combo < 3) return;
    const ctx = this.ctx;
    const x = this.w / 2, y = this.h / 2 - 54;
    ctx.font = `700 ${16 + Math.min(14, game.combo)}px "Barlow Semi Condensed", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.min(1, game.comboT * 3);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.strokeText(`×${game.combo} chain`, x, y);
    ctx.fillStyle = '#f3d68f'; ctx.fillText(`×${game.combo} chain`, x, y);
    ctx.globalAlpha = 1;
  }

  /** Edge-of-screen arrows pointing at the keystone (gold) and live generators (cyan). */
  private drawArrows(game: Game) {
    const { w, h, zoom } = this;
    const p = game.player;
    const k = game.level.keystone;
    const targets: { x: number; y: number; col: string; label: string; big: boolean }[] = [];
    if (!k.broken || game.gateOpen) targets.push({ x: k.x, y: k.y, col: '#ffd27c', label: game.gateOpen ? 'EXIT' : game.shielded ? 'KEYSTONE · shielded' : 'KEYSTONE', big: true });
    if (game.shielded) for (const g of game.level.generators) if (!g.broken) targets.push({ x: g.x, y: g.y, col: '#7fe6ff', label: '', big: false });
    const margin = 34, top = 120, bottom = 150;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 4);
    for (const t of targets) {
      const dx = (t.x - p.x) * zoom, dy = (t.y - p.y) * zoom;
      const sx = w / 2 + dx, sy = h / 2 + dy;
      if (sx > margin && sx < w - margin && sy > top && sy < h - bottom) continue;
      const ang = Math.atan2(dy, dx);
      // clamp to a rectangle inset from the screen edge
      const hw = w / 2 - margin, ht = h / 2 - top, hb = h / 2 - bottom;
      const cx = Math.cos(ang), cy = Math.sin(ang);
      const kx = Math.abs(cx) > 1e-4 ? hw / Math.abs(cx) : Infinity;
      const ky = cy < 0 ? ht / -cy : hb / Math.max(1e-4, cy);
      const s = Math.min(kx, ky);
      const ax = w / 2 + cx * s, ay = h / 2 + cy * s;
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(ang);
      const size = t.big ? 13 + pulse * 3 : 8;
      ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.7, size * 0.75); ctx.lineTo(-size * 0.35, 0); ctx.lineTo(-size * 0.7, -size * 0.75); ctx.closePath();
      ctx.fillStyle = t.col; ctx.shadowColor = t.col; ctx.shadowBlur = t.big ? 14 : 6; ctx.fill();
      ctx.restore();
      if (t.big) {
        const dist = Math.round(Math.hypot(t.x - p.x, t.y - p.y) / HEX_W);
        const ctx2 = this.ctx;
        ctx2.font = '600 12px "Barlow Semi Condensed", system-ui, sans-serif';
        ctx2.textAlign = 'center';
        const lx = ax - cx * 30, ly = ay - cy * 26 + 4;
        const txt = `${t.label} · ${dist} hexes`;
        const tw = ctx2.measureText(txt).width + 12;
        ctx2.fillStyle = 'rgba(23,18,15,.85)';
        ctx2.fillRect(lx - tw / 2, ly - 12, tw, 17);
        ctx2.fillStyle = t.col; ctx2.fillText(txt, lx, ly);
      }
    }
  }

  private drawStick(j: Stick, R: number, base: string, knob: string) {
    if (!j.active) return;
    const ctx = this.ctx;
    ctx.beginPath(); ctx.arc(j.ox, j.oy, R, 0, 7);
    ctx.fillStyle = 'rgba(43,34,28,.35)'; ctx.fill();
    ctx.strokeStyle = `rgba(${base},.6)`; ctx.lineWidth = 2; ctx.stroke();
    let dx = j.x - j.ox, dy = j.y - j.oy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    ctx.beginPath(); ctx.arc(j.ox + dx, j.oy + dy, 22, 0, 7);
    ctx.fillStyle = `rgba(${base},.55)`; ctx.fill();
    ctx.strokeStyle = `rgba(${knob},.9)`; ctx.stroke();
  }
}
