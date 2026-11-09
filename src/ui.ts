// DOM overlay: HUD, ability buttons, shop tray, pause, results and the permanent upgrade shop.
import {
  BOOSTS, BOOST_INFO, ORE_LINES, SHOTS, SHOT_INFO, SP_ITEMS, CLEAR_TARGET,
  abilitySlots, availableShots, fmt, oreCost, blasterStats, shotStats,
  type ShotId, type OreLine,
} from './economy';
import type { Game, LevelResult } from './game';
import { CHALLENGE_BIT, challengeLabel, challengeTitle } from './challenge';
import type { SaveData } from './save';

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;
const h = (html: string) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild as HTMLElement; };

export interface UiHandlers {
  play(level: number): void;
  resume(): void;
  pause(): void;
  abandon(): void;
  toggleMute(): void;
  toggleAimFollow(): boolean;
  toggleSmartAim(): void;
  buyOre(id: OreLine): void;
  buySp(id: string): void;
  resetSave(): void;
}

export class Ui {
  root: HTMLElement;
  private hud!: HTMLElement;
  private abilityEls: Partial<Record<ShotId, HTMLElement>> = {};
  shopOpen = false;
  private shopEl!: HTMLElement;
  private lastHud = '';
  private lastShop = '';
  private oreTab: 'ore' | 'sp' = 'ore';

  constructor(root: HTMLElement, private on: UiHandlers) {
    this.root = root;
  }

  clear() { this.root.innerHTML = ''; this.lastTip = null; this.shopOpen = false; this.abilityEls = {}; this.lastHud = ''; this.lastShop = ''; }

  // ---------------- title ----------------
  showTitle(save: SaveData) {
    this.clear();
    const next = save.highest + 1;
    const el = h(`
      <div class="screen title">
        <div class="title-card plate">
          <div class="logo">Block Buster</div>
          <div class="sub">Drill through the crystal mine. Break the Keystone.</div>
          <button class="btn go" data-play="${next}"><small>Enter level</small><b>${next}</b></button>
          ${save.highest > 0 ? `<div class="row-btns"><button class="btn ghost" data-pick>Choose level…</button></div>` : ''}
          <div class="howto">
            <div><b>Move</b><span>Drag on the left side (WASD)</span></div>
            <div><b>Aim</b><span>Drag with your right thumb (mouse)</span></div>
            <div><b>Fire</b><span>Automatic</span></div>
            <div><b>Abilities</b><span>Buy in the shop, tap to fire</span></div>
          </div>
          <div class="wallet"><span class="ore-ic"></span>${fmt(save.ore)} Ore <span class="sp-ic">✦</span>${save.sp} skill points</div>
          <div class="row-btns small">
            <button class="btn ghost" data-mute>${save.muted ? 'Sound off' : 'Sound on'}</button>
            <button class="btn ghost" data-upgrades>Upgrades</button>
          </div>
        </div>
      </div>`);
    el.addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest('button');
      if (!t) return;
      if (t.dataset.play) this.on.play(+t.dataset.play);
      if (t.hasAttribute('data-mute')) { this.on.toggleMute(); this.showTitle(save); }
      if (t.hasAttribute('data-pick')) this.showLevelPicker(save);
      if (t.hasAttribute('data-upgrades')) this.showResults(null, save);
    });
    this.root.appendChild(el);
  }

  private showLevelPicker(save: SaveData) {
    const max = save.highest + 1;
    const cells = Array.from({ length: max }, (_, i) => {
      const L = i + 1, s = save.stars[L] ?? 0;
      const n = (s & 1 ? 1 : 0) + (s & 2 ? 1 : 0) + (s & 4 ? 1 : 0);
      const bonus = s & CHALLENGE_BIT ? '<i class="bonus-dot">✦</i>' : '';
      return `<button class="lvl-cell ${L === max ? 'next' : ''}" data-play="${L}"><b>${L}</b><span>${'★'.repeat(n)}${'☆'.repeat(3 - n)}${bonus}</span></button>`;
    }).reverse().join('');
    const el = h(`<div class="modal"><div class="plate sheet"><div class="sheet-head"><h2>Choose level</h2><button class="x" data-close>✕</button></div>
      <p class="hint">Replays keep paying Ore. Stars pay skill points once per level.</p><div class="lvl-grid">${cells}</div></div></div>`);
    el.addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest('button');
      if (!t) return;
      if (t.dataset.play) this.on.play(+t.dataset.play);
      if (t.hasAttribute('data-close')) el.remove();
    });
    this.root.appendChild(el);
  }

  // ---------------- in level ----------------
  showLevel(game: Game) {
    this.clear();
    this.hud = h(`
      <div class="hud">
        <div class="top">
          <div class="lvl plate"><b>Level</b><strong>${game.L}</strong></div>
          <div class="wallet-hud plate">
            <div class="cur"><span class="shard-ic"></span><span data-shards>0</span></div>
            <div class="cur"><span class="ore-ic"></span><span data-ore>0</span></div>
          </div>
          <button class="shop-btn plate" data-shop><span class="shard-ic"></span>Shop</button>
          <button class="icon-btn plate" data-pause aria-label="Pause">❚❚</button>
        </div>
        <div class="objectives" data-obj></div>
        <div class="collapse" data-collapse hidden></div>
        <div class="tip" data-tip hidden></div>
        <div class="abilities" data-abilities></div>
        <div class="tray" data-tray hidden></div>
      </div>`);
    this.root.appendChild(this.hud);
    this.shopEl = $(this.hud, '[data-tray]');
    $(this.hud, '[data-pause]').addEventListener('click', () => this.on.pause());
    $(this.hud, '[data-shop]').addEventListener('click', () => this.toggleShop(game, !this.shopOpen));

    const ab = $(this.hud, '[data-abilities]');
    // A button only fires if the touch both starts and ends on it, so a slipping aim thumb can't trigger it.
    const press = (b: HTMLElement, act: () => void) => {
      let armed = -1;
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); armed = e.pointerId; b.classList.add('pressed'); });
      b.addEventListener('pointerleave', () => { armed = -1; b.classList.remove('pressed'); });
      b.addEventListener('pointercancel', () => { armed = -1; b.classList.remove('pressed'); });
      b.addEventListener('pointerup', e => { b.classList.remove('pressed'); if (armed === e.pointerId) act(); armed = -1; });
    };
    availableShots(game.perm).forEach(id => {
      const info = SHOT_INFO[id];
      const b = h(`<button class="ability" style="--c:${info.color}" aria-label="${info.name}">
        <span class="ring"></span><span class="ic">${info.icon}</span><span class="t"></span></button>`);
      press(b, () => { if (game.shots[id].lvl === 0) this.toggleShop(game, true); else game.triggerShot(id); });
      ab.appendChild(b);
      this.abilityEls[id] = b;
    });
    if (game.hasSmartAim) {
      const b = h(`<button class="smart-toggle plate" aria-label="Smart Aim"><span>◎</span><small>Auto</small></button>`);
      const sync = () => b.classList.toggle('on', game.smartAimOn);
      press(b, () => { this.on.toggleSmartAim(); sync(); });
      sync();
      ab.appendChild(b);
    }
    this.updateHud(game, true);
  }

  toggleShop(game: Game, open: boolean) {
    this.shopOpen = open;
    this.shopEl.hidden = !open;
    this.lastShop = '';
    if (open) this.renderShop(game);
  }

  private renderShop(game: Game) {
    const b = game.blaster;
    const slots = abilitySlots(game.perm);
    const avail = availableShots(game.perm);
    const boostRows = BOOSTS.map(id => {
      const info = BOOST_INFO[id];
      const cost = game.boostCost(id);
      const nxt = { ...game.boosts, [id]: game.boosts[id] + 1 };
      const nb = blasterStats(nxt, game.perm);
      const fx = id === 'damage' ? `${fmt(b.damage)} → <b>${fmt(nb.damage)}</b>` :
        id === 'fireRate' ? `${b.fireRate.toFixed(1)}/s → <b>${nb.fireRate.toFixed(1)}/s</b>` :
        id === 'speed' ? `${Math.round(b.speed)} → <b>${Math.round(nb.speed)}</b>` :
        `${b.range.toFixed(1)} → <b>${nb.range.toFixed(1)}</b> hexes`;
      return this.shopRow(`boost:${id}`, info.icon, info.name, game.boosts[id], fx, cost, game.shards >= cost, '#ffb35a');
    }).join('');
    const shotRows = SHOTS.map(id => {
      const info = SHOT_INFO[id];
      const st = game.shots[id];
      if (!avail.includes(id)) return `<div class="row locked"><span class="ric" style="--c:${info.color}">${info.icon}</span><div class="txt"><div class="nm">${info.name}</div><div class="fx">Unlock with skill points between levels</div></div></div>`;
      const cost = game.shotCost(id);
      const slotFull = st.lvl === 0 && game.shotsOwned >= slots;
      const s = game.shotStats(id);
      const n = st.lvl > 0 ? (st.lvl + 1) : 1;
      const ns = shotStatsPreview(game, id, n);
      const fx = st.lvl === 0 ? `${info.desc}. ${s.active.toFixed(1)}s on, ${Math.round(s.cooldown)}s cooldown` :
        `${detail(id, s)} → <b>${detail(id, ns)}</b>, ${ns.active.toFixed(1)}s / ${Math.round(ns.cooldown)}s`;
      if (slotFull) return `<div class="row locked"><span class="ric" style="--c:${info.color}">${info.icon}</span><div class="txt"><div class="nm">${info.name}</div><div class="fx">All ${slots} ability slots used this level</div></div></div>`;
      return this.shopRow(`shot:${id}`, info.icon, info.name, st.lvl, fx, cost, game.canBuyShot(id), info.color, st.lvl === 0 ? (cost === 0 ? 'Free' : 'Buy') : undefined);
    }).join('');
    const html = `
      <div class="plate sheet">
        <div class="sheet-head"><h2>Field shop</h2><span class="live paused">❚❚ paused</span><button class="x" data-close>✕</button></div>
        <div class="bal"><span class="shard-ic"></span><b>${fmt(game.shards)}</b> Shards</div>
        <div class="grp">Blaster</div>${boostRows}
        <div class="grp">Specialty shots <span class="slots">${game.shotsOwned}/${slots} slots</span></div>${shotRows}
      </div>`;
    if (html === this.lastShop) return;
    this.lastShop = html;
    this.shopEl.innerHTML = html;
    this.shopEl.onclick = e => {
      if (e.target === this.shopEl) { this.toggleShop(game, false); return; } // tapped outside the menu
      const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!t) return;
      if (t.hasAttribute('data-close')) { this.toggleShop(game, false); return; }
      const k = t.dataset.buy;
      if (!k) return;
      const [type, id] = k.split(':');
      if (type === 'boost') game.buyBoost(id as never); else game.buyShot(id as ShotId);
      this.renderShop(game);
      this.updateHud(game, true);
    };
  }

  private shopRow(key: string, icon: string, name: string, lvl: number, fx: string, cost: number, can: boolean, col: string, label?: string) {
    return `<div class="row"><span class="ric" style="--c:${col}">${icon}</span>
      <div class="txt"><div class="nm">${name} ${lvl ? `<span class="lv">Lv ${lvl}</span>` : ''}</div><div class="fx">${fx}</div></div>
      <button class="buy ${can ? '' : 'off'}" data-buy="${key}" ${can ? '' : 'disabled'}><small>${label ?? 'Upgrade'}</small><span><i class="shard-ic"></i>${cost === 0 ? '0' : fmt(cost)}</span></button></div>`;
  }

  /** Called every frame; does cheap work every frame and heavier text updates when values change. */
  updateHud(game: Game, force = false) {
    if (!this.hud) return;
    for (const id of SHOTS) {
      const el = this.abilityEls[id];
      if (!el) continue;
      const st = game.shots[id];
      let state = 'locked', p = 0, txt = '';
      if (st.lvl > 0) {
        const s = game.shotStats(id);
        if (st.active > 0) { state = 'active'; p = st.active / s.active; txt = st.active.toFixed(1); }
        else if (st.cd > 0) { state = 'cooling'; p = 1 - st.cd / s.cooldown; txt = Math.ceil(st.cd) + 's'; }
        else { state = 'ready'; p = 1; txt = 'TAP'; }
      } else txt = 'shop';
      if (el.dataset.state !== state) el.dataset.state = state;
      el.style.setProperty('--p', String(p));
      const t = el.querySelector('.t')!;
      if (t.textContent !== txt) t.textContent = txt;
    }
    const lv = game.level;
    const ch = game.challenge;
    const chText = challengeLabel(ch, game.time);
    const key = [chText, ch.done, Math.floor(game.shards), Math.floor(game.oreEarned), game.goldsBroken, Math.floor(game.clearPct * 100), game.generatorsLeft, lv.keystone.broken, game.gateOpen ? Math.ceil(game.collapseT) : -1, game.anythingAffordable()].join('|');
    if (!force && key === this.lastHud) { if (this.shopOpen) this.renderShop(game); return; }
    this.lastHud = key;
    $(this.hud, '[data-shards]').textContent = fmt(game.shards);
    $(this.hud, '[data-ore]').textContent = fmt(game.oreEarned);
    const clear = Math.floor(game.clearPct * 100);
    const gens = lv.generators.length;
    const objs = [
      lv.keystone.broken ? `<div class="chip done">◆ Keystone</div>` :
        gens && game.generatorsLeft ? `<div class="chip field">⌁ Generators ${gens - game.generatorsLeft}/${gens}</div>` : `<div class="chip key">◆ Keystone</div>`,
      `<div class="chip ${game.goldsBroken >= lv.goldTotal ? 'done' : 'gold'}">★ Gold ${game.goldsBroken}/${lv.goldTotal}</div>`,
      `<div class="chip ${game.clearPct >= CLEAR_TARGET ? 'done' : ''}">Clear ${clear}%<span class="bar"><i style="width:${Math.min(100, clear / CLEAR_TARGET)}%"></i></span></div>`,
    ];
    objs.push(`<div class="chip bonus ${ch.done ? 'done' : ''}">✦ ${ch.done ? 'Bonus complete' : chText}</div>`);
    $(this.hud, '[data-obj]').innerHTML = objs.join('');
    const col = $(this.hud, '[data-collapse]');
    if (game.gateOpen) { col.hidden = false; col.innerHTML = `Exit open · mine collapses in <b>${Math.ceil(game.collapseT)}s</b>`; }
    $(this.hud, '[data-shop]').classList.toggle('glow', game.anythingAffordable());
    if (this.shopOpen) this.renderShop(game);
  }

  private lastTip: string | null = null;
  setTip(text: string | null) {
    if (!this.hud || text === this.lastTip) return;
    this.lastTip = text;
    const el = $(this.hud, '[data-tip]');
    el.hidden = !text;
    if (text) el.textContent = text;
  }

  showPause(save: SaveData) {
    const followLabel = (on: boolean) => `Idle aim: ${on ? 'follows movement' : 'holds direction'}`;
    const el = h(`<div class="modal"><div class="plate sheet small-sheet">
      <div class="sheet-head"><h2>Paused</h2></div>
      <button class="btn go" data-resume><b>Resume</b></button>
      <div class="row-btns"><button class="btn ghost" data-follow>${followLabel(save.aimFollow)}</button></div>
      <div class="row-btns"><button class="btn ghost" data-mute>${save.muted ? 'Sound off' : 'Sound on'}</button>
      <button class="btn ghost danger" data-abandon>Leave level</button></div>
      <p class="hint">Leaving keeps the Ore you've mined but earns no stars.</p></div></div>`);
    el.addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest('button');
      if (!t) return;
      if (t.hasAttribute('data-resume')) { el.remove(); this.on.resume(); }
      if (t.hasAttribute('data-mute')) { this.on.toggleMute(); t.textContent = t.textContent === 'Sound on' ? 'Sound off' : 'Sound on'; }
      if (t.hasAttribute('data-abandon')) { el.remove(); this.on.abandon(); }
      if (t.hasAttribute('data-follow')) t.textContent = followLabel(this.on.toggleAimFollow());
    });
    this.root.appendChild(el);
  }

  // ---------------- results + permanent upgrades ----------------
  showResults(res: (LevelResult & { newStars: number; spGained: number }) | null, save: SaveData) {
    this.clear();
    const next = save.highest + 1;
    const starHtml = res ? [
      [1, 'Break the Keystone'], [2, `Clear ${Math.round(CLEAR_TARGET * 100)}% of gems`], [4, 'All golden gems'],
    ].map(([bit, label], i) => {
      const got = res.stars & (bit as number);
      const fresh = res.newStars & (bit as number);
      return `<div class="star ${got ? 'got' : 'miss'}" style="animation-delay:${0.25 + i * 0.35}s"><span>★</span><small>${label}</small>${fresh ? '<em>+SP</em>' : ''}</div>`;
    }).join('') : '';
    const bonusHtml = res ? (() => {
      const got = res.stars & CHALLENGE_BIT, fresh = res.newStars & CHALLENGE_BIT;
      return `<div class="bonus-row ${got ? 'got' : 'miss'}"><span>✦</span><div><b>Bonus</b> ${challengeTitle(res.challenge)}</div>${fresh ? '<em>+1 SP</em>' : got ? '<small>done before</small>' : '<small>missed</small>'}</div>`;
    })() : '';
    const title = !res ? 'Workshop' : res.reason === 'abandon' ? 'Level left' : res.reason === 'collapse' ? 'Mine collapsed' : 'Level cleared';
    const el = h(`
      <div class="screen results">
        <div class="res-top">
          <h2>${title}${res ? ` <span>· Level ${res.L}</span>` : ''}</h2>
          ${res ? `<div class="stars">${starHtml}</div>${bonusHtml}
          <div class="rewards">
            <div class="rw plate"><span class="sp-ic">✦</span><b>+${res.spGained}</b><small>skill points</small></div>
            <div class="rw plate"><span class="ore-ic"></span><b>+${fmt(res.ore)}</b><small>Ore (${fmt(res.salvage)} salvage)</small></div>
            <div class="rw plate"><b>${Math.floor(res.time / 60)}:${String(Math.floor(res.time % 60)).padStart(2, '0')}</b><small>time · ${Math.round(res.clearPct * 100)}% clear · gold ${res.golds}/${res.goldTotal}</small></div>
          </div>` : ''}
        </div>
        <div class="plate upgrades">
          <div class="wallet big"><span class="ore-ic"></span><b>${fmt(save.ore)}</b> Ore <span class="sp-ic">✦</span><b>${save.sp}</b> skill points</div>
          <div class="tabs"><button data-tab="ore" class="${this.oreTab === 'ore' ? 'on' : ''}">Ore · stats</button><button data-tab="sp" class="${this.oreTab === 'sp' ? 'on' : ''}">Skill points · unlocks</button></div>
          <div class="list" data-list></div>
        </div>
        <div class="foot">
          <button class="btn ghost" data-title>Menu</button>
          ${res && res.L !== next ? `<button class="btn ghost" data-play="${res.L}">Replay ${res.L}</button>` : ''}
          <button class="btn go" data-play="${next}"><small>Next</small><b>Level ${next}</b></button>
        </div>
      </div>`);
    this.root.appendChild(el);
    const list = $(el, '[data-list]');
    const renderList = () => {
      if (this.oreTab === 'ore') {
        let group = '';
        list.innerHTML = ORE_LINES.filter(l => !l.id.startsWith('poison') || save.perm.sp.unlockPoison).map(l => {
          const n = save.perm.ore[l.id] ?? 0;
          const cost = oreCost(l, n);
          const can = save.ore >= cost;
          const shot = SHOTS.find(id => SHOT_INFO[id].name === l.group);
          const info = shot ? `<button class="info-btn" data-info="${shot}" aria-label="About ${l.group}">i</button>` : '';
          const head = l.group !== group ? `<div class="grp">${(group = l.group)}${info}</div>` : '';
          return `${head}<div class="row"><div class="txt"><div class="nm">${l.name} <span class="lv">Lv ${n}</span></div><div class="fx">${l.effect(n)} → <b>${l.effect(n + 1)}</b></div></div>
            <button class="buy ${can ? '' : 'off'}" data-ore-buy="${l.id}" ${can ? '' : 'disabled'}><small>Upgrade</small><span><i class="ore-ic"></i>${fmt(cost)}</span></button></div>`;
        }).join('');
      } else {
        list.innerHTML = SP_ITEMS.map(it => {
          const owned = save.perm.sp[it.id] ?? 0;
          const maxed = owned >= it.max;
          const blocked = it.requires && !save.perm.sp[it.requires];
          const cost = it.cost(owned);
          const can = !maxed && !blocked && save.sp >= cost;
          return `<div class="row ${maxed ? 'owned' : ''}"><div class="txt"><div class="nm">${it.name} ${it.max === Infinity && owned ? `<span class="lv">×${owned}</span>` : ''}</div><div class="fx">${it.desc}${blocked ? ' <i>Needs the third slot first.</i>' : ''}${it.effect && !maxed ? `<br>${it.effect(owned)}` : ''}</div></div>
            ${maxed ? '<span class="owned-tag">Owned</span>' : `<button class="buy sp ${can ? '' : 'off'}" data-sp-buy="${it.id}" ${can ? '' : 'disabled'}><small>Unlock</small><span>✦ ${cost}</span></button>`}</div>`;
        }).join('');
      }
    };
    renderList();
    el.addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!t) return;
      if (t.dataset.info) { this.showShotInfo(t.dataset.info as ShotId, save); return; }
      if (t.dataset.tab) { this.oreTab = t.dataset.tab as 'ore' | 'sp'; el.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b === t)); renderList(); }
      if (t.dataset.oreBuy) { this.on.buyOre(t.dataset.oreBuy as OreLine); this.refreshWallet(el, save); renderList(); }
      if (t.dataset.spBuy) { this.on.buySp(t.dataset.spBuy); this.refreshWallet(el, save); renderList(); }
      if (t.dataset.play) this.on.play(+t.dataset.play);
      if (t.hasAttribute('data-title')) this.showTitle(save);
    });
  }

  /** Explains a specialty shot and what your permanent upgrades currently give it. */
  private showShotInfo(id: ShotId, save: SaveData) {
    const info = SHOT_INFO[id];
    const p = save.perm;
    const lvOf = (k: OreLine) => p.ore[k] ?? 0;
    const now = shotStats(id, 1, p);
    const withOre = (k: OreLine) => shotStats(id, 1, { ...p, ore: { ...p.ore, [k]: lvOf(k) + 1 } });
    const nStr = withOre(`${id}Str` as OreLine), nDur = withOre(`${id}Dur` as OreLine), nCd = withOre(`${id}Cd` as OreLine);
    const blurb: Record<ShotId, string> = {
      multishot: 'Fires extra shots in a fan alongside every blaster shot. Great for chewing through wide walls.',
      ricochet: 'Shots bounce off gems and bedrock instead of stopping, losing 25% damage per bounce. Use the laser sight to line up bank shots.',
      piercing: 'Shots pass through gems, hitting each one, losing 20% damage per gem. Best down long lines of gems.',
      poison: 'Gems you hit keep taking damage over time. Poison also stops regenerating gems from healing.',
    };
    const strWhat: Record<ShotId, string> = {
      multishot: '+1 extra shot, then 1 more every 2 levels',
      ricochet: '1 bounce, then 1 more every 1.5 levels',
      piercing: 'Passes 1 gem, then 1 more every 1.5 levels',
      poison: '50% of shot damage per second for 3s, +10% and +0.5s per level',
    };
    const row = (name: string, lv: number, what: string, cur: string, next: string) =>
      `<tr><td><b>${name}</b> <span class="lv">Lv ${lv}</span><div class="fx">${what}</div></td><td>${cur}</td><td><b>${next}</b></td></tr>`;
    const el = h(`<div class="modal"><div class="plate sheet info-sheet">
      <div class="sheet-head"><span class="ric" style="--c:${info.color}">${info.icon}</span><h2>${info.name}</h2><button class="x" data-close>✕</button></div>
      <p class="info-blurb">${blurb[id]}</p>
      <table class="info-table">
        <thead><tr><th>Upgrade</th><th>Now</th><th>Next level</th></tr></thead>
        <tbody>
          ${row('Strength', lvOf(`${id}Str` as OreLine), strWhat[id], detail(id, now), detail(id, nStr))}
          ${row('Active time', lvOf(`${id}Dur` as OreLine), 'How long it stays on after you tap it (approaches 8s)', `${now.active.toFixed(1)}s`, `${nDur.active.toFixed(1)}s`)}
          ${row('Cooldown', lvOf(`${id}Cd` as OreLine), 'Wait before you can tap it again (never below 3s)', `${now.cooldown.toFixed(1)}s`, `${nCd.cooldown.toFixed(1)}s`)}
        </tbody>
      </table>
      <p class="hint">Values are for the shot as first bought in a level. You still buy it with Shards each level; every extra Shard upgrade during the level adds +1 to all three.</p>
    </div></div>`);
    el.addEventListener('click', e => { if (e.target === el || (e.target as HTMLElement).closest('[data-close]')) el.remove(); });
    this.root.appendChild(el);
  }

  private refreshWallet(el: HTMLElement, save: SaveData) {
    $(el, '.wallet.big').innerHTML = `<span class="ore-ic"></span><b>${fmt(save.ore)}</b> Ore <span class="sp-ic">✦</span><b>${save.sp}</b> skill points`;
  }
}

function detail(id: ShotId, s: { extraShots: number; bounces: number; pierces: number; poisonFrac: number }) {
  switch (id) {
    case 'multishot': return `+${s.extraShots} shots`;
    case 'ricochet': return `${s.bounces} bounces`;
    case 'piercing': return `through ${s.pierces}`;
    case 'poison': return `${Math.round(s.poisonFrac * 100)}% dmg/s`;
  }
}

function shotStatsPreview(game: Game, id: ShotId, lvl: number) {
  // stats if the shot were at `lvl` in this level
  const saved = game.shots[id].lvl;
  game.shots[id].lvl = lvl;
  const s = game.shotStats(id);
  game.shots[id].lvl = saved;
  return s;
}

