// Estää iPhonen/iPadin Safaria zoomaamasta peliruutuun (kaksi peukaloa = nipistys, kaksoisnapautus = zoomaus).
// iOS ei noudata viewportin user-scalable=no -asetusta, joten tarvitaan touch- ja gesture-tapahtumien käsittely.
// Valikoiden vieritys yhdellä sormella sallitaan.
const SCROLLABLE = '.panel, input, textarea, select';
const opt = { passive: false, capture: true };
const inScroll = t => t && t.closest && t.closest(SCROLLABLE);
document.addEventListener('touchstart', ev => { if (ev.touches.length > 1 && !ev.target.closest?.('#touch')) ev.preventDefault(); }, opt);
document.addEventListener('touchmove', ev => {
  if (ev.touches.length > 1 || (typeof ev.scale === 'number' && ev.scale !== 1)) { ev.preventDefault(); return; }
  if (!inScroll(ev.target)) ev.preventDefault();
}, opt);
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, ev => ev.preventDefault(), opt);
let lastEnd = 0;
document.addEventListener('touchend', ev => {
  const now = Date.now(), t = ev.target;
  if (now - lastEnd < 350 && !(t && t.closest && t.closest('input, textarea, select, a'))) ev.preventDefault();
  lastEnd = now;
}, opt);
document.addEventListener('dblclick', ev => ev.preventDefault(), opt);
const meta = document.querySelector('meta[name=viewport]');
const BASE = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
function resetZoom() {
  const vv = window.visualViewport;
  if (!meta || !vv || vv.scale <= 1.01) return;
  meta.setAttribute('content', BASE.replace('maximum-scale=1', 'maximum-scale=1.01'));
  setTimeout(() => meta.setAttribute('content', BASE), 30);
}
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => setTimeout(resetZoom, 250));
addEventListener('orientationchange', () => setTimeout(resetZoom, 400));
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(resetZoom, 200); });
