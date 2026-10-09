// Suorituskykymittari: FPS, ruutuajat (keskiarvo, mediaani, 95. persentiili), piirtokutsut, kolmiot ja
// näytönohjaimen muistiin ladatut resurssit. Lisäksi vakioitu mittausajo kameran vakioasennoista.
export class Perf {
  constructor(renderer) {
    this.renderer = renderer;
    this.samples = new Float32Array(240); this.n = 0; this.i = 0;
    this.last = performance.now();
    this.calls = 0; this.tris = 0;
  }
  // kutsutaan kerran ruudussa renderöinnin jälkeen
  tick() {
    const now = performance.now(), dt = now - this.last; this.last = now;
    if (dt > 0 && dt < 5000) { this.samples[this.i] = dt; this.i = (this.i + 1) % this.samples.length; this.n = Math.min(this.n + 1, this.samples.length); }
    const r = this.renderer.info.render; this.calls = r.calls; this.tris = r.triangles;
  }
  summary(windowFrames = 120) {
    const n = Math.min(this.n, windowFrames); if (!n) return null;
    const arr = []; for (let k = 0; k < n; k++) arr.push(this.samples[(this.i - 1 - k + this.samples.length) % this.samples.length]);
    const avg = arr.reduce((a, b) => a + b, 0) / n; arr.sort((a, b) => a - b);
    const m = this.renderer.info.memory;
    return { fps: 1000 / avg, avgMs: avg, p50: arr[Math.floor(n * 0.5)], p95: arr[Math.min(n - 1, Math.floor(n * 0.95))],
      calls: this.calls, triangles: this.tris, textures: m.textures, geometries: m.geometries };
  }
  reset() { this.n = 0; this.i = 0; this.last = performance.now(); }
}

// Mittausajo: jokaisesta kameran asennosta mitataan sama aika, tulokset taulukkona ja konsoliin.
export async function runBenchmark({ perf, setPose, poses, seconds = 4, warmup = 1, onStep = () => {} }) {
  const results = [];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (const pose of poses) {
    onStep(pose.name);
    setPose(pose);
    await wait(warmup * 1000);
    perf.reset();
    const t0 = performance.now();
    await wait(seconds * 1000);
    const frames = perf.n, s = perf.summary(frames);
    results.push({ pose: pose.name, frames, seconds: (performance.now() - t0) / 1000, ...s });
  }
  return results;
}
