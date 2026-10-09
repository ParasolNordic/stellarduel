// Aineistolähteet ja lisenssit: pieni linkki alkuvalikkoon ja erillinen tietoikkuna.
// Linkki lisätään jokaiseen elementtiin, jolla on attribuutti data-lisenssi. Yhteinen kaikille Helsingin 3D-mallia käyttäville peleille.
(function () {
  'use strict';
  const CSS = `
  .lic-link { display:inline-block; margin-top:10px; background:none; border:none; padding:4px 6px; color:#6b7390; font:inherit; font-size:11px; cursor:pointer; text-decoration:underline; text-underline-offset:2px; }
  .lic-link:hover, .lic-link:focus-visible { color:#c8d0e0; outline:none; }
  .lic-back { position:fixed; inset:0; z-index:50; display:flex; align-items:center; justify-content:center; background:rgba(3,4,10,0.7); padding:16px; box-sizing:border-box; touch-action:pan-y; }
  .lic-back[hidden] { display:none; }
  .lic-win { width:min(560px, 100%); max-height:90vh; overflow:auto; box-sizing:border-box; padding:18px 20px; background:#0a0c18; border:1px solid #2a2f48; color:#c8d0e0;
    font-family:"Share Tech Mono", ui-monospace, monospace; font-size:13px; line-height:1.6; text-align:left; box-shadow:0 0 40px rgba(0,0,0,0.6); -webkit-user-select:text; user-select:text; }
  .lic-win h2 { font-family:Orbitron, sans-serif; font-weight:500; font-size:15px; letter-spacing:2px; margin:0 0 10px; color:#e8ecf5; }
  .lic-win p { margin:0 0 10px; }
  .lic-win dl { margin:0 0 10px; display:grid; grid-template-columns:auto 1fr; gap:2px 10px; }
  .lic-win dt { color:#6b7390; } .lic-win dd { margin:0; }
  .lic-win a { color:#4fd6ff; word-break:break-all; }
  .lic-close { display:block; margin:14px 0 0 auto; background:transparent; color:#4fd6ff; border:1px solid #4fd6ff; padding:8px 16px; font:inherit; cursor:pointer; }
  .lic-close:hover, .lic-close:focus-visible { background:rgba(79,214,255,0.15); outline:none; }`;
  const HTML = `
  <div class="lic-win" role="dialog" aria-modal="true" aria-labelledby="licTitle">
    <h2 id="licTitle">AINEISTOT JA TEKIJÄNOIKEUDET</h2>
    <p>Pelin Helsingin 3D-kaupunkiympäristö perustuu Helsingin kaupungin avoimeen 3D-kaupunkimalliaineistoon.</p>
    <dl>
      <dt>Aineiston tuottaja</dt><dd>Helsingin kaupunki</dd>
      <dt>Aineisto</dt><dd>Helsingin 3D-kaupunkitietomalli (LoD2)</dd>
      <dt>Lisenssi</dt><dd>Creative Commons Nimeä 4.0 Kansainvälinen (CC BY 4.0)</dd>
      <dt>Lisenssin ehdot</dt><dd><a href="https://creativecommons.org/licenses/by/4.0/deed.fi" target="_blank" rel="noopener noreferrer">https://creativecommons.org/licenses/by/4.0/deed.fi</a></dd>
      <dt>Aineiston lähde</dt><dd><a href="https://kartta.hel.fi/3d/" target="_blank" rel="noopener noreferrer">https://kartta.hel.fi/3d/</a></dd>
    </dl>
    <p>Alkuperäistä 3D-aineistoa on muokattu, yksinkertaistettu ja muunnettu pelikäyttöön soveltuvaksi vektorigrafiikaksi.</p>
    <p>Peli on itsenäinen tuotanto, eikä Helsingin kaupunki ole sen kehittäjä, julkaisija tai sponsori.</p>
    <button class="lic-close" type="button">SULJE</button>
  </div>`;
  function init() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const back = document.createElement('div'); back.className = 'lic-back'; back.hidden = true; back.innerHTML = HTML; document.body.appendChild(back);
    let opener = null;
    const close = () => { back.hidden = true; if (opener) opener.focus(); };
    const open = ev => { opener = ev && ev.currentTarget; back.hidden = false; back.querySelector('.lic-close').focus(); };
    back.querySelector('.lic-close').addEventListener('click', close);
    back.addEventListener('pointerdown', ev => { if (ev.target === back) close(); });
    // näppäimet eivät valu peliin, kun ikkuna on auki
    window.addEventListener('keydown', ev => { if (back.hidden) return; ev.stopImmediatePropagation(); if (ev.key === 'Escape') { ev.preventDefault(); close(); } }, true);
    for (const el of document.querySelectorAll('[data-lisenssi]')) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'lic-link'; b.textContent = '© Aineistolähteet ja lisenssit';
      b.addEventListener('click', open); el.appendChild(b);
    }
    window.HKI_LISENSSIT = { open, close };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
