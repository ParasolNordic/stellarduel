// HUD: tähtäinristikko (laajenee hajonnan mukaan), osumamerkit, vahingon suunta, terveys, ammukset,
// asepaikat, tapahtumasyöte, tilannetaulukko, kuolema- ja ottelun loppunäkymät sekä kiikarin reunamaski.
// DOM päivitetään vain kun arvo muuttuu.
import { WEAPONS, WEAPON_LABEL } from '../weapons/defs.js';
import { colorName } from '../shared.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Hud {
  constructor() {
    this.el = $('hud'); this.cache = {};
    this.xh = $('xh'); this.xhParts = [...this.xh.querySelectorAll('i')];
    this.hit = $('hitmark'); this.hitT = 0;
    this.hurtT = 0;
    $('slots').innerHTML = WEAPONS.map((w, i) => `<div data-i="${i}"><b>${w.slot}</b>${w.short}</div>`).join('');
    this.slotEls = [...$('slots').children];
  }
  show(on) { this.el.classList.toggle('hidden', !on); }
  set(id, val, prop = 'textContent') { const k = id + prop; if (this.cache[k] === val) return; this.cache[k] = val; $(id)[prop] = val; }

  crosshair(spreadPx, visible, sprint) {
    const g = Math.round(Math.max(4, Math.min(spreadPx, 200)));
    if (g !== this.cache.xg) {
      this.cache.xg = g; const [t, b, l, r] = this.xhParts;
      t.style.transform = `translateY(${-g - 9}px)`; b.style.transform = `translateY(${g}px)`; l.style.transform = `translateX(${-g - 9}px)`; r.style.transform = `translateX(${g}px)`;
    }
    const o = visible ? (sprint ? 0.25 : 1) : 0;
    if (o !== this.cache.xo) { this.cache.xo = o; this.xh.style.opacity = o; }
  }
  hitmark(head, kill) {
    this.hit.className = kill ? 'kill' : head ? 'head' : ''; this.hitT = kill ? 0.45 : 0.22;
  }
  damage(fromAngle) {
    this.hurtT = 0.35;
    const d = document.createElement('div'); d.className = 'dmgdir'; d.style.transform = `rotate(${fromAngle}rad)`;
    $('dmgdirs').appendChild(d);
    requestAnimationFrame(() => requestAnimationFrame(() => { d.style.opacity = '0'; }));
    setTimeout(() => d.remove(), 1300);
  }
  health(hp) {
    hp = Math.max(0, Math.round(hp));
    this.set('hpnum', String(hp));
    if (this.cache.hpw !== hp) { this.cache.hpw = hp; $('hpfill').style.width = hp + '%'; $('hpfill').classList.toggle('low', hp < 35); $('vignette').style.opacity = hp < 40 ? String((40 - hp) / 40 * 0.9) : '0'; }
  }
  ammo(ws) {
    const d = ws.def, a = ws.ammo[ws.idx];
    this.set('wname', d.name);
    this.set('mag', String(a.mag));
    this.set('res', a.reserve === Infinity ? '/ ∞' : '/ ' + a.reserve);
    const low = a.mag <= Math.ceil(d.mag * 0.25);
    if (this.cache.low !== low) { this.cache.low = low; $('mag').classList.toggle('low', low); }
    this.set('nades', 'KRANAATIT ' + '● '.repeat(ws.grenades) + '○ '.repeat(Math.max(0, 3 - ws.grenades)));
    this.set('zoomlbl', d.zoom ? `KIIKARI ${ws.zoom}×` : '');
    if (this.cache.slot !== ws.idx) { this.cache.slot = ws.idx; this.slotEls.forEach((e, i) => e.classList.toggle('on', i === ws.idx)); }
    let hint = '';
    if (ws.state === 'reload') hint = 'LADATAAN…';
    else if (a.mag === 0 && a.reserve === 0) hint = 'EI AMMUKSIA – VAIHDA ASETTA';
    else if (a.mag === 0) hint = 'R = LATAA';
    this.set('hint', hint);
  }
  timer(t, limit) { const r = Math.max(0, limit - t); this.set('timer', `${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}`); }
  // tiimit = paitavärit; yläpalkissa tiimien yhteiset kaadot
  static teams(players) {
    const m = new Map();
    for (const p of players) { const t = m.get(p.color) || { color: p.color, kills: 0, deaths: 0, members: [] }; t.kills += p.kills; t.deaths += p.deaths; t.members.push(p); m.set(p.color, t); }
    return [...m.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }
  leaders(players, limit) {
    const s = Hud.teams(players).map(t => `<span style="border-color:${t.color}">${t.members.length > 1 ? colorName(t.color) + ' ×' + t.members.length : esc(t.members[0].name)} ${t.kills}</span>`).join('') +
      `<span style="border-color:transparent;color:#9aa6b2">/${limit}</span>`;
    this.set('lead', s, 'innerHTML');
  }
  board(players, myId, code, max = 6) {
    const rows = Hud.teams(players).map(t => {
      const head = `<tr class="team"><td><i style="background:${t.color}"></i></td><td>${colorName(t.color)}${t.members.length > 1 ? ' – TIIMI' : ''}</td><td>${t.kills}</td><td>${t.deaths}</td></tr>`;
      return head + t.members.sort((a, b) => b.kills - a.kills).map(p => `<tr class="${p.id === myId ? 'me' : ''}"><td></td><td>${esc(p.name)}${p.alive ? '' : ' <small>†</small>'}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`).join('');
    }).join('');
    this.set('brows', rows, 'innerHTML'); this.set('bcode', code || '');
    this.set('bsub', players.length < max ? `Peliin mahtuu vielä ${max - players.length} – jaa koodi ${code}. Sama paidan väri = sama tiimi.` : 'Sama paidan väri = sama tiimi.');
  }
  feed(html, mine) {
    const d = document.createElement('div'); d.innerHTML = html; if (mine) d.className = 'me';
    const f = $('feed'); f.appendChild(d); while (f.children.length > 5) f.firstChild.remove();
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 700); }, 5500);
  }
  killFeed(killer, victim, w, head) {
    const k = killer ? `<span style="color:${killer.color}">${esc(killer.name)}</span>` : '';
    const v = `<span style="color:${victim.color}">${esc(victim.name)}</span>`;
    return killer && killer !== victim ? `${k}<span class="w">${WEAPON_LABEL(w)}${head ? ' ◎' : ''}</span>${v}` : `${v}<span class="w">${WEAPON_LABEL(w)} · OMA RÄJÄHDE</span>`;
  }
  center(text, sub = '', dur = 1.6) {
    const c = $('center'); c.innerHTML = `<div>${esc(text)}</div>${sub ? `<div class="sm">${esc(sub)}</div>` : ''}`;
    clearTimeout(this.centerTO); this.centerTO = setTimeout(() => { c.innerHTML = ''; }, dur * 1000);
  }
  scopeMask(ls, amount) {
    const m = $('scopeMask');
    if (!ls.visible || amount <= 0.01) { if (this.cache.mask) { m.style.opacity = '0'; this.cache.mask = false; } return; }
    this.cache.mask = true;
    m.style.opacity = String(amount);
    m.style.background = `radial-gradient(circle at ${ls.x.toFixed(0)}px ${ls.y.toFixed(0)}px, transparent ${(ls.r * 0.98).toFixed(0)}px, rgba(0,0,0,0.92) ${(ls.r * 1.04).toFixed(0)}px, #000 ${(ls.r * 1.6).toFixed(0)}px)`;
  }
  update(dt) {
    if (this.hitT > 0) { this.hitT -= dt; this.hit.style.opacity = String(Math.max(0, Math.min(1, this.hitT * 6))); }
    if (this.hurtT > 0) { this.hurtT -= dt; $('hurt').style.opacity = String(Math.max(0, this.hurtT * 2.5)); }
  }
}
