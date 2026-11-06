/**
 * HUD track picker: lists window.GW_TRACKS and reloads into the chosen one.
 */
(function () {
  'use strict';

  function init() {
    const btn = document.getElementById('btnTrackPicker');
    const menu = document.getElementById('trackMenu');
    const lbl = document.getElementById('lblTrackPicker');
    const tracks = window.GW_TRACKS || [];
    const active = window.ACTIVE_TRACK;
    if (!btn || !menu || tracks.length === 0) return;

    if (lbl && active) lbl.textContent = active.name;
    const sub = document.getElementById('editorTrackSubtitle');
    if (sub && active) sub.textContent = active.name + ' — Track Designer';

    tracks.forEach(function (t) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'exp9-track-menu-item' + (active && t.id === active.id ? ' active' : '');
      item.setAttribute('role', 'menuitem');
      const d = t.data;
      const len = d.totalLengthMeters ? Math.round(d.totalLengthMeters) + 'm' : '';
      const ghost = d.ghostData ? 'vs ' + d.ghostData.rider + ' ' + d.ghostData.lapTimeFormatted : '';
      item.innerHTML = '<strong></strong><small></small>';
      item.querySelector('strong').textContent = t.label;
      item.querySelector('small').textContent = [len, ghost].filter(Boolean).join(' · ');
      item.addEventListener('click', function () {
        close();
        if (!active || t.id !== active.id) window.setActiveTrack(t.id);
      });
      menu.appendChild(item);
    });

    function open() { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
    function close() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.blur(); }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.hidden) open(); else close();
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) close();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
