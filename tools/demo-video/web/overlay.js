(() => {
  const st = document.createElement('style');
  st.textContent = `
  .bg-scene{background:#07080f url(/demo-bg.png) 0 0/100% 100% no-repeat!important}.bg-scene>*{display:none!important}
  *{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}html{scroll-behavior:auto!important}.topbar{background:rgba(9,10,20,.97)!important}.toast{background:rgba(16,18,34,.97)!important}
  #demo-cursor{position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px)}
  #demo-cursor svg{filter:drop-shadow(0 3px 5px rgba(0,0,0,.65))}
  .demo-ripple{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:3px solid rgba(196,181,253,.95);z-index:2147483646;pointer-events:none;animation:demoRipple .6s ease-out forwards}
  @keyframes demoRipple{from{transform:scale(.3);opacity:1}to{transform:scale(1.5);opacity:0}}
  #demo-chips{position:fixed;right:20px;bottom:20px;z-index:2147483645;display:flex;flex-direction:column;gap:10px;align-items:flex-end;pointer-events:none}
  .demo-chip{display:flex;align-items:center;gap:12px;padding:12px 16px 12px 12px;border-radius:15px;background:rgba(10,12,26,.94);border:1px solid rgba(167,139,250,.6);color:#eef0ff;font:800 15px Manrope,system-ui,sans-serif;box-shadow:0 18px 44px -14px rgba(0,0,0,.9),0 0 0 5px rgba(139,92,246,.14);animation:demoChip .5s cubic-bezier(.2,.9,.3,1.2) both;max-width:470px;line-height:1.3}
  .demo-chip small{display:block;color:#b4b9dc;font-weight:600;font-size:12.5px;margin-top:2px}
  .demo-chip i{flex-shrink:0;width:32px;height:32px;border-radius:10px;display:grid;place-items:center;font-style:normal;font-size:17px;color:#fff;background:linear-gradient(135deg,#8b5cf6,#22d3ee)}
  .demo-chip.ok{border-color:rgba(52,211,153,.6);box-shadow:0 18px 44px -14px rgba(0,0,0,.9),0 0 0 5px rgba(52,211,153,.13)}
  .demo-chip.ok i{background:linear-gradient(135deg,#34d399,#22d3ee)}
  .demo-chip.pp{border-color:rgba(255,196,57,.65);box-shadow:0 18px 44px -14px rgba(0,0,0,.9),0 0 0 5px rgba(255,196,57,.13)}
  .demo-chip.pp i{background:#ffc439;color:#003087;font-weight:900;font-size:13px}
  .demo-chip.out{animation:demoChipOut .35s ease forwards}
  @keyframes demoChip{from{opacity:0;transform:translateY(16px) scale(.95)}to{opacity:1;transform:none}}
  @keyframes demoChipOut{to{opacity:0;transform:translateY(-10px)}}
  .demo-glow{box-shadow:0 0 0 3px rgba(52,211,153,.95),0 0 34px rgba(52,211,153,.45)!important;transition:box-shadow .4s}
  .demo-fill{animation:demoFill 1.1s ease}
  @keyframes demoFill{0%{box-shadow:0 0 0 0 rgba(139,92,246,0)}30%{box-shadow:0 0 0 4px rgba(139,92,246,.75),0 0 26px rgba(139,92,246,.6)}100%{box-shadow:0 0 0 0 rgba(139,92,246,0)}}`;
  const cursor = document.createElement('div'); cursor.id = 'demo-cursor';
  cursor.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4.5 2.8l14.6 8.6-6.5 1.5 3.7 6.9-2.8 1.5-3.7-6.9-5 4.4z" fill="#fff" stroke="#0b0c18" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const chips = document.createElement('div'); chips.id = 'demo-chips';
  const mount = () => { document.head.append(st); document.body.append(cursor, chips); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  addEventListener('mousemove', (e) => { cursor.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 3}px)`; }, true);
  addEventListener('mousedown', (e) => { const r = document.createElement('div'); r.className = 'demo-ripple'; r.style.left = `${e.clientX}px`; r.style.top = `${e.clientY}px`; document.body.append(r); setTimeout(() => r.remove(), 700); }, true);
  window.demoChip = (html, cls = '', ttl = 0) => { const el = document.createElement('div'); el.className = `demo-chip ${cls}`; el.innerHTML = html; chips.append(el); if (ttl) setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ttl); return el; };
  window.demoClearChips = () => chips.querySelectorAll('.demo-chip').forEach((el) => { el.classList.add('out'); setTimeout(() => el.remove(), 400); });
  window.demoScroll = (y, ms = 900) => new Promise((done) => {
    const from = scrollY; const to = Math.max(0, Math.min(y, document.documentElement.scrollHeight - innerHeight)); const t0 = performance.now();
    const step = (now) => { const p = Math.min(1, (now - t0) / ms); const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2; scrollTo(0, from + (to - from) * e); if (p < 1) requestAnimationFrame(step); else done(); };
    requestAnimationFrame(step);
  });
  // Scrolls so the element's top ends up at y (in the viewport); works for elements at the end of a sticky column too.
  window.demoReveal = (selector, ms = 800, y = 420) => {
    const el = document.querySelector(selector);
    return window.demoScroll(scrollY + el.getBoundingClientRect().top - y, ms);
  };
})();
