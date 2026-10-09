// Estää iPhonen/iPadin Safaria zoomaamasta peliruutuun.
// iOS ei noudata viewport-tagin user-scalable=no / maximum-scale -asetuksia (saavutettavuussyistä), joten
// kahden peukalon yhtäaikainen käyttö (kaksi tikkua tai tikku + nappi) tulkitaan nipistykseksi ja nopea
// kaksoisnapautus zoomaukseksi. Pointer-tapahtumien preventDefault ei estä näitä, vaan tarvitaan
// touch- ja gesture-tapahtumien käsittely. Valikoiden vieritys yhdellä sormella sallitaan.
(function () {
  'use strict';
  const SCROLLABLE = '.scr, .box, .lic-win, .lic-back, #selBox, #placePanel, input, textarea, select';
  const opt = { passive: false, capture: true };
  const inScroll = t => t && t.closest && t.closest(SCROLLABLE);
  // nipistys: kaksi tai useampi sormi -> ei koskaan selaimen zoomia
  document.addEventListener('touchstart', ev => { if (ev.touches.length > 1) ev.preventDefault(); }, opt);
  document.addEventListener('touchmove', ev => {
    if (ev.touches.length > 1 || (typeof ev.scale === 'number' && ev.scale !== 1)) { ev.preventDefault(); return; }
    if (!inScroll(ev.target)) ev.preventDefault();         // pelialueella ei vieritystä eikä zoomia
  }, opt);
  // Safarin omat nipistyseleet
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, ev => ev.preventDefault(), opt);
  // kaksoisnapautus: toinen napautus 350 ms sisällä ei saa zoomata (tekstikentät sallitaan)
  let lastEnd = 0;
  document.addEventListener('touchend', ev => {
    const now = Date.now(), t = ev.target;
    if (now - lastEnd < 350 && !(t && t.closest && t.closest('input, textarea, select, a'))) ev.preventDefault();
    lastEnd = now;
  }, opt);
  document.addEventListener('dblclick', ev => ev.preventDefault(), opt);
  // jos sivu on jo ehtinyt zoomautua (esim. vanha välilehti), palautetaan mittakaava asettamalla viewport uudelleen
  const meta = document.querySelector('meta[name=viewport]');
  const BASE = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  function resetZoom() {
    const vv = window.visualViewport;
    if (!meta || !vv || vv.scale <= 1.01) return;
    meta.setAttribute('content', BASE.replace('maximum-scale=1', 'maximum-scale=1.01'));
    setTimeout(() => meta.setAttribute('content', BASE), 30);
  }
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => setTimeout(resetZoom, 250));
  window.addEventListener('orientationchange', () => setTimeout(resetZoom, 400));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(resetZoom, 200); });
})();
