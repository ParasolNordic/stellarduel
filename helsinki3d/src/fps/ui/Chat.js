// Tiimiradio: tekstiviestit saman paitavärin pelaajille. Sotilas-LCD-näytön näköinen ruutu, joka tulee esiin
// viestin saapuessa tai kirjoitettaessa ja häviää hetken kuluttua.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Chat {
  constructor({ root, onSend, onOpen, onClose }) {
    Object.assign(this, { root, onSend, onOpen, onClose });
    this.log = root.querySelector('.lcd-log'); this.input = root.querySelector('input'); this.title = root.querySelector('.lcd-title');
    this.open = false; this.hideT = 0;
    this.input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); const t = this.input.value.trim(); if (t) this.onSend(t); this.close(); }
      else if (e.key === 'Escape') this.close();
    });
    root.querySelector('.lcd-send')?.addEventListener('click', () => { const t = this.input.value.trim(); if (t) this.onSend(t); this.close(); });
  }
  setTeam(label, color, alone) {
    this.title.innerHTML = `TIIMIRADIO · <b style="color:${color}">${esc(label)}</b>${alone ? ' <i>– ei muita tiimissä</i>' : ''}`;
  }
  show() { this.root.classList.remove('hidden', 'fade'); }
  openInput() {
    this.open = true; this.show(); this.root.classList.add('typing');
    this.input.value = ''; setTimeout(() => this.input.focus(), 0); this.onOpen?.();
  }
  close() {
    if (!this.open) return;
    this.open = false; this.root.classList.remove('typing'); this.input.blur(); this.hideT = 6; this.onClose?.();
  }
  add(msg, mine) {
    const d = document.createElement('div'); d.className = 'lcd-line' + (mine ? ' me' : '');
    const t = new Date(); const hh = String(t.getHours()).padStart(2, '0'), mm = String(t.getMinutes()).padStart(2, '0');
    d.innerHTML = `<span class="ts">${hh}:${mm}</span> <span class="who">${esc(msg.name)}&gt;</span> ${esc(msg.text)}`;
    this.log.appendChild(d); while (this.log.children.length > 8) this.log.firstChild.remove();
    this.show(); this.hideT = 8;
  }
  update(dt) {
    if (this.open || this.hideT <= 0) return;
    this.hideT -= dt;
    if (this.hideT <= 0) this.root.classList.add('fade');
  }
}
