// Pelimekaniikan kerros. Kaupunkimaailma, kamera ja valaistus eivät tiedä peleistä mitään;
// pelit rekisteröityvät tänne ja saavat yhteisen kontekstin (scene, camera, world, lighting, rig).
// Tässä vaiheessa ainoa tila on 'explore' (vapaa tutkiminen ilman pelisääntöjä).
//
// Pelitilan rajapinta:
//   { id, name, enter(ctx), exit(ctx), update(dt, ctx) }
export class GameManager {
  constructor(ctx) { this.ctx = ctx; this.modes = new Map(); this.active = null; }
  register(mode) { this.modes.set(mode.id, mode); return this; }
  start(id) {
    const next = this.modes.get(id); if (!next) throw new Error('Tuntematon pelitila: ' + id);
    if (this.active && this.active.exit) this.active.exit(this.ctx);
    this.active = next;
    if (next.enter) next.enter(this.ctx);
  }
  update(dt) { if (this.active && this.active.update) this.active.update(dt, this.ctx); }
  get current() { return this.active ? this.active.id : null; }
}

// Vapaa tutkiminen: ei sääntöjä, pisteitä eikä ajoneuvoja. Kamera hoitaa liikkumisen.
export const ExploreMode = { id: 'explore', name: 'Vapaa tutkiminen', enter() {}, exit() {}, update() {} };
