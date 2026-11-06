/**
 * Track Registry — lists the playable tracks and picks the active one.
 *
 * Active track resolution: ?track=<id> URL param → last choice (localStorage) → default.
 * Everything else reads window.ACTIVE_TRACK. Switching tracks reloads the page.
 */
(function (global) {
  'use strict';

  const DEFAULT_TRACK_ID = 'ridgeback';
  const STORAGE_KEY = 'gamerwheels_track';

  const tracks = [];
  function add(data, id, label) {
    if (!data) return;
    data.id = data.id || id;
    tracks.push({ id: data.id, label: label || data.name, data: data });
  }
  add(global.TRACK_DATA_RIDGEBACK, 'ridgeback', 'Ridgeback Canyon (new)');
  add(global.TRACK_DATA_HOLLISTER, 'hollister', 'Hollister Hills RFTR (classic)');

  function find(id) {
    return tracks.find(function (t) { return t.id === id; }) || null;
  }

  let requested = null;
  try { requested = new URLSearchParams(global.location.search).get('track'); } catch (e) { /* ignore */ }
  if (!find(requested)) {
    try { requested = global.localStorage.getItem(STORAGE_KEY); } catch (e) { requested = null; }
  }
  const active = find(requested) || find(DEFAULT_TRACK_ID) || tracks[0];

  global.GW_TRACKS = tracks;
  global.ACTIVE_TRACK = active ? active.data : null;

  global.setActiveTrack = function (id) {
    if (!find(id)) return;
    try { global.localStorage.setItem(STORAGE_KEY, id); } catch (e) { /* ignore */ }
    const url = new URL(global.location.href);
    url.searchParams.set('track', id);
    global.location.href = url.toString();
  };

  // Ghost rider display name for the active track (e.g. "Nico", "Pacer")
  global.getGhostName = function () {
    const t = global.ACTIVE_TRACK;
    return (t && t.ghostData && t.ghostData.rider) || 'Ghost';
  };
})(typeof window !== 'undefined' ? window : this);
