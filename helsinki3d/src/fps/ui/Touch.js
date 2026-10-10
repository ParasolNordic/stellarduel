// Kosketusohjaus puhelimille ja tableteille: vasen peukalo = liikkumistikku (vie reunaan asti = juoksu),
// oikea peukalo = katselu vetämällä. Ampumisnappia voi samalla vetää, jolloin tähtäys seuraa sormea.
// Pointer Events -rajapinta, jokainen sormi seurataan omalla tunnisteellaan (moni sormi yhtä aikaa).
const R = 58;                    // tikun säde pikseleinä

export class TouchControls {
  constructor({ root, player, weapons, onLook, actions }) {
    Object.assign(this, { root, player, weapons, onLook, actions });
    this.stick = null; this.looks = new Map();
    this.base = root.querySelector('#stickBase'); this.knob = root.querySelector('#stickKnob');
    const zone = root.querySelector('#stickZone'), look = root.querySelector('#lookZone');
    zone.addEventListener('pointerdown', e => this.stickDown(e));
    look.addEventListener('pointerdown', e => this.lookDown(e));
    addEventListener('pointermove', e => this.move(e), { passive: false });
    addEventListener('pointerup', e => this.up(e)); addEventListener('pointercancel', e => this.up(e));
    for (const b of root.querySelectorAll('[data-act]')) {
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        const act = b.dataset.act;
        b.classList.add('down');
        if (act === 'fire') { this.weapons.trigger = true; this.weapons.pressed = true; this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY, fire: true, el: b }); }
        else { this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY, el: b, button: true }); this.actions[act]?.(); }
      });
    }
  }
  stickDown(e) {
    if (this.stick) return;
    e.preventDefault();
    this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.base.style.transform = `translate(${e.clientX - R}px, ${e.clientY - R}px)`; this.base.classList.add('on');
    this.knob.style.transform = 'translate(0px, 0px)';
  }
  lookDown(e) { e.preventDefault(); this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY }); }
  move(e) {
    if (this.stick && e.pointerId === this.stick.id) {
      e.preventDefault();
      let dx = e.clientX - this.stick.x, dy = e.clientY - this.stick.y;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // kuollut alue keskellä, sitten analoginen nopeus
      const m = Math.min(1, l / R), k = m < 0.12 ? 0 : (m - 0.12) / 0.88;
      const ax = l > 0 ? dx / l * k : 0, ay = l > 0 ? -dy / l * k : 0;
      this.player.analog = { x: ax, y: ay };
      this.player.sprintTouch = l > R * 0.98 && ay > 0.75;
      return;
    }
    const L = this.looks.get(e.pointerId);
    if (!L || L.button) return;
    e.preventDefault();
    this.onLook(e.clientX - L.x, e.clientY - L.y);
    L.x = e.clientX; L.y = e.clientY;
  }
  up(e) {
    if (this.stick && e.pointerId === this.stick.id) { this.stick = null; this.player.analog = null; this.player.sprintTouch = false; this.base.classList.remove('on'); return; }
    const L = this.looks.get(e.pointerId);
    if (!L) return;
    if (L.fire) this.weapons.trigger = false;
    if (L.el) L.el.classList.remove('down');
    this.looks.delete(e.pointerId);
  }
  reset() {
    this.stick = null; this.looks.clear(); this.player.analog = null; this.player.sprintTouch = false; this.weapons.trigger = false;
    this.base.classList.remove('on'); this.root.querySelectorAll('.down').forEach(b => b.classList.remove('down'));
  }
}
