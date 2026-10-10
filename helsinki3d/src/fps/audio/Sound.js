// Äänet syntetisoidaan WebAudiolla (ei äänitiedostoja): laukaukset kohinasta, suodattimista ja matalasta
// iskusta, kaupungin kaiku konvoluutiolla, räjähdykset, lataus- ja lukkonapsahdukset, osumamerkit, askeleet.
// Muiden pelaajien äänet sijoitetaan 3D-tilaan (PannerNode), etäisyys vaimentaa ja tummentaa.
export class Sound {
  constructor() {
    this.ctx = null; this.volume = 0.8; this.listener = null;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(c.destination);
    // valkoinen kohina 2 s
    const n = c.sampleRate * 2, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = b;
    // kaupunkikaiku: rakennusten seinistä palaava hajautunut heijastus
    const ir = c.createBuffer(2, c.sampleRate * 1.6, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const x = ir.getChannelData(ch); for (let i = 0; i < x.length; i++) { const t = i / c.sampleRate; const early = (t > 0.03 && t < 0.2) ? (Math.random() < 0.004 ? 0.8 : 0) : 0; x[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t / 1.6, 3) * 0.35 + early * (Math.random() * 2 - 1)) * (t < 0.012 ? 0 : 1); } }
    this.verb = c.createConvolver(); this.verb.buffer = ir;
    this.verbIn = c.createGain(); this.verbIn.gain.value = 0.45; this.verbIn.connect(this.verb); this.verb.connect(this.master);
    this.listener = c.listener;
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  get ok() { return !!this.ctx && this.ctx.state === 'running'; }

  setListener(pos, fwd, up) {
    const L = this.listener; if (!L) return;
    const t = this.ctx.currentTime;
    if (L.positionX) { L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t); L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t); L.upX.setValueAtTime(up.x, t); L.upY.setValueAtTime(up.y, t); L.upZ.setValueAtTime(up.z, t); }
    else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
  }
  // äänilähteen ulostulo: paikallinen (oma ase) tai 3D-paikannettu; kauempana tummempi
  out(pos, gain = 1, verb = 0.5) {
    const c = this.ctx, g = c.createGain(); g.gain.value = gain;
    let node = g;
    if (pos) {
      const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 6; p.rolloffFactor = 1.1; p.maxDistance = 600;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass';
      const L = this.listener, lx = L.positionX ? L.positionX.value : 0, ly = L.positionY ? L.positionY.value : 0, lz = L.positionZ ? L.positionZ.value : 0;
      const dist = Math.hypot(pos.x - lx, pos.y - ly, pos.z - lz);
      lp.frequency.value = Math.max(900, 18000 / (1 + dist / 25));
      g.connect(lp); lp.connect(p); p.connect(this.master);
      const v = c.createGain(); v.gain.value = verb * Math.min(1.5, 0.4 + dist / 60); g.connect(v); v.connect(this.verbIn);
    } else {
      g.connect(this.master);
      const v = c.createGain(); v.gain.value = verb; g.connect(v); v.connect(this.verbIn);
    }
    return node;
  }
  noiseSrc(t, dur, rate = 1) { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = rate; s.start(t, Math.random() * Math.max(0, 1.9 - (dur + 0.05) * rate), dur + 0.05); return s; }
  env(g, t, a, peak, decay, tail = 0) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.15), t + a + decay); g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay + tail); }

  shot(def, pos = null) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime, s = def.snd, out = this.out(pos, pos ? 1.6 : 1, 0.35 * s.tail);
    const dist = pos ? 1 : 0;
    // runko: kaistanpäästetty kohina
    const n = this.noiseSrc(t, s.decay + 0.3), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = s.f * (0.92 + Math.random() * 0.16); bp.Q.value = s.q;
    const g = c.createGain(); this.env(g, t, 0.001, 0.9 * s.gain, s.decay, 0.25 * s.tail);
    n.connect(bp); bp.connect(g); g.connect(out);
    // kirkas paukahdus (yliäänen "crack")
    const n2 = this.noiseSrc(t, 0.05, 1.3), hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const g2 = c.createGain(); this.env(g2, t, 0.0005, 0.6 * s.crack * (dist ? 0.7 : 1), 0.025);
    n2.connect(hp); hp.connect(g2); g2.connect(out);
    // matala isku
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(s.thump * 2.2, t); o.frequency.exponentialRampToValueAtTime(s.thump * 0.6, t + 0.12);
    const g3 = c.createGain(); this.env(g3, t, 0.002, 0.9 * s.gain, 0.1, 0.05);
    o.connect(g3); g3.connect(out); o.start(t); o.stop(t + 0.3);
    if (def.kind === 'rocket') this.whoosh(t, out);
  }
  whoosh(t, out) {
    const c = this.ctx, n = this.noiseSrc(t, 1.2), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(2200, t + 0.25); bp.frequency.exponentialRampToValueAtTime(700, t + 1.1);
    const g = c.createGain(); this.env(g, t, 0.03, 0.6, 0.6, 0.4); n.connect(bp); bp.connect(g); g.connect(out);
  }
  // jatkuva suhina lentävälle raketille (palauttaa päivitettävän olion)
  rocketLoop(pos) {
    if (!this.ok) return null;
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.9;
    const g = c.createGain(); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.5, t + 0.1);
    const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 5; p.rolloffFactor = 1.2;
    s.connect(bp); bp.connect(g); g.connect(p); p.connect(this.master); s.start(t);
    const set = q => { if (p.positionX) { p.positionX.value = q.x; p.positionY.value = q.y; p.positionZ.value = q.z; } else p.setPosition(q.x, q.y, q.z); };
    set(pos);
    return { set, stop: () => { const tt = c.currentTime; g.gain.cancelScheduledValues(tt); g.gain.setValueAtTime(g.gain.value, tt); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.1); s.stop(tt + 0.15); } };
  }
  explosion(pos, big = true) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime, out = this.out(pos, big ? 3.2 : 2.6, 1.1);
    const n = this.noiseSrc(t, 2.5, 0.7), lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(6000, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.6); lp.frequency.exponentialRampToValueAtTime(90, t + 2.4);
    const g = c.createGain(); this.env(g, t, 0.004, 1.0, 0.5, 1.8); n.connect(lp); lp.connect(g); g.connect(out);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(24, t + 0.9);
    const g2 = c.createGain(); this.env(g2, t, 0.005, 1.2, 0.4, 0.8); o.connect(g2); g2.connect(out); o.start(t); o.stop(t + 1.6);
    // rätinä (sirpaleet, roskat)
    for (let i = 0; i < 14; i++) {
      const tt = t + 0.15 + Math.random() * 1.4, k = this.noiseSrc(tt, 0.03, 1.5), hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1500 + Math.random() * 3000;
      const kg = c.createGain(); this.env(kg, tt, 0.001, 0.12 + Math.random() * 0.15, 0.02); k.connect(hp); hp.connect(kg); kg.connect(out);
    }
  }
  click(freq = 2500, gain = 0.25, when = 0, pos = null, dur = 0.018) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime + when, out = this.out(pos, 1, 0.15);
    const n = this.noiseSrc(t, dur + 0.03), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 3;
    const g = c.createGain(); this.env(g, t, 0.0008, gain, dur); n.connect(bp); bp.connect(g); g.connect(out);
  }
  // latausäänet aseen tyypin mukaan (ajoitettu animaatioon)
  reload(def) {
    const T = def.reload;
    if (def.reloadMode === 'shell') { this.click(1800, 0.25, 0.12); this.click(900, 0.2, 0.2); return; }
    this.click(1400, 0.3, T * 0.18); this.click(700, 0.25, T * 0.25, null, 0.04);
    this.click(1100, 0.3, T * 0.62); this.click(2600, 0.35, T * 0.72);
    if (def.id === 'launcher') this.click(500, 0.35, T * 0.78, null, 0.06);
    else this.click(3200, 0.35, T * 0.9);
  }
  cycle(def) { if (def.id === 'shotgun') { this.click(900, 0.4, 0.06, null, 0.05); this.click(1500, 0.4, 0.3, null, 0.04); } else { this.click(2200, 0.3, 0.05); this.click(1200, 0.35, 0.25, null, 0.04); this.click(1800, 0.35, 0.55, null, 0.03); this.click(2600, 0.3, 0.8); } }
  dry() { this.click(3500, 0.2, 0, null, 0.01); }
  swap() { this.click(1200, 0.18, 0, null, 0.03); this.click(2200, 0.2, 0.12); }
  tone(freq, dur, gain, type = 'sine', when = 0, slide = 0) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    this.env(g, t, 0.003, gain, dur); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  hitmark(head) { this.tone(head ? 1900 : 1300, 0.06, 0.18, 'triangle'); if (head) this.tone(2900, 0.12, 0.12, 'sine', 0.03); }
  killConfirm() { this.tone(660, 0.1, 0.2, 'triangle'); this.tone(990, 0.18, 0.2, 'triangle', 0.08); }
  hurt() { if (!this.ok) return; const c = this.ctx, t = c.currentTime, out = this.out(null, 1, 0); const n = this.noiseSrc(t, 0.2, 0.5), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; const g = c.createGain(); this.env(g, t, 0.003, 0.7, 0.12); n.connect(lp); lp.connect(g); g.connect(out); this.tone(90, 0.15, 0.5, 'sine', 0, 0.5); }
  step(sprint, pos = null) { this.click(sprint ? 380 : 300, sprint ? 0.12 : 0.07, 0, pos, 0.05); }
  land(k) { this.click(200, 0.15 + k * 0.3, 0, null, 0.08); }
  bounce(pos) { this.click(3000, 0.25, 0, pos, 0.02); this.click(4400, 0.12, 0.01, pos, 0.015); }
  ricochet(pos) { if (Math.random() < 0.5) return; this.tone(2400 + Math.random() * 2000, 0.25, 0.04, 'sine', 0, 0.4); }
  impact(pos, kind) { this.click(kind === 'buildings' ? 2400 : 900, 0.12, 0, pos, 0.02); }
  pin() { this.click(4200, 0.2, 0, null, 0.01); this.click(2000, 0.2, 0.08, null, 0.03); }
}
