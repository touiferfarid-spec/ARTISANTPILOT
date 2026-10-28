'use strict';
// Independent map picker: the server alone validates the INSEE commune code.
(() => {
  const $ = id => document.getElementById(id);
  const cityInput = $('city');
  const list = $('citySuggestions');
  const feedback = $('cityFeedback');
  const radiusInput = $('coverageRadius');
  const radiusLabel = $('coverageRadiusValue');
  const cityLabel = $('coverageLocationLabel');
  const providerLabel = $('coverageMapProvider');
  const panel = $('coverageMap');
  let chosen = null, suggestions = [], active = -1, debounce = null, seq = 0;
  let initialized = false, mapMode = 'none', map = null, marker = null, circle = null, starting = null;
  const radius = () => Number(radiusInput.value || 20);
  const validCenter = c => c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng));

  function updateLabel() {
    radiusLabel.textContent = radius() + ' km';
    radiusInput.setAttribute('aria-valuetext', radius() + ' kilomètres');
    cityLabel.textContent = chosen
      ? chosen.name + ' · ' + radius() + ' km autour de la ville'
      : 'Choisissez une ville pour visualiser la zone';
  }
  function closeList() {
    list.classList.add('hidden');
    list.replaceChildren();
    cityInput.setAttribute('aria-expanded', 'false');
    active = -1;
  }
  function choose(entry) {
    chosen = {name: entry.name, code: entry.code, lat: Number(entry.lat), lng: Number(entry.lng)};
    cityInput.value = entry.name;
    feedback.textContent = '✓ ' + entry.name + ' (' + entry.department + ') — ville sélectionnée';
    feedback.classList.add('is-valid');
    closeList();
    updateLabel();
    redraw();
  }
  function drawResults() {
    list.replaceChildren();
    if (!suggestions.length) {
      closeList();
      feedback.textContent = 'Aucune commune trouvée. Essayez une autre orthographe.';
      return;
    }
    suggestions.forEach((c, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'city-result' + (index === active ? ' active' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', index === active ? 'true' : 'false');
      item.textContent = c.name + ' · ' + c.department + (c.postalCode ? ' · ' + c.postalCode : '');
      item.addEventListener('mousedown', e => e.preventDefault());
      item.addEventListener('click', () => choose(c));
      list.appendChild(item);
    });
    list.classList.remove('hidden');
    cityInput.setAttribute('aria-expanded', 'true');
  }
  async function search(value) {
    const request = ++seq;
    if (value.trim().length < 2) { closeList(); return; }
    try {
      const resp = await fetch('/api/locations/suggest?q=' + encodeURIComponent(value.trim()), {credentials:'same-origin'});
      if (!resp.ok) throw new Error('Recherche temporairement indisponible');
      const data = await resp.json();
      if (request !== seq || cityInput.value.trim() !== value.trim()) return;
      suggestions = Array.isArray(data.cities) ? data.cities : [];
      active = -1;
      drawResults();
    } catch {
      if (request !== seq) return;
      closeList();
      feedback.textContent = 'Suggestions indisponibles. Réessayez dans quelques instants.';
    }
  }
  cityInput.addEventListener('input', () => {
    chosen = null;
    seq++;
    closeList();
    feedback.classList.remove('is-valid');
    feedback.textContent = 'Choisissez une commune dans les suggestions.';
    updateLabel();
    redraw();
    clearTimeout(debounce);
    const current = cityInput.value;
    if (current.trim().length >= 2) debounce = setTimeout(() => search(current), 260);
  });
  cityInput.addEventListener('keydown', event => {
    if (list.classList.contains('hidden')) return;
    if (event.key === 'Escape') { closeList(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active = event.key === 'ArrowDown'
        ? (active + 1) % suggestions.length
        : (active + suggestions.length - 1) % suggestions.length;
      drawResults();
    } else if (event.key === 'Enter' && active >= 0 && suggestions[active]) {
      event.preventDefault();
      choose(suggestions[active]);
    }
  });
  document.addEventListener('click', event => {
    if (event.target !== cityInput && !list.contains(event.target)) closeList();
  });
  radiusInput.addEventListener('input', () => { updateLabel(); redraw(); });

  function updateGoogle() {
    if (!map || mapMode !== 'google') return;
    if (!validCenter(chosen)) {
      if (circle) circle.setMap(null);
      if (marker) marker.setMap(null);
      return;
    }
    const point = {lat: Number(chosen.lat), lng: Number(chosen.lng)};
    if (!circle) circle = new google.maps.Circle({
      map, center: point, radius: radius() * 1000,
      strokeColor: '#13aa90', strokeOpacity: 0.95, strokeWeight: 2,
      fillColor: '#19b79d', fillOpacity: 0.14
    });
    else { circle.setMap(map); circle.setCenter(point); circle.setRadius(radius() * 1000); }
    if (!marker) marker = new google.maps.Marker({map, position: point, title: 'Centre de la zone'});
    else { marker.setMap(map); marker.setPosition(point); }
    const bounds = circle.getBounds();
    if (bounds) map.fitBounds(bounds, 35);
    else map.setCenter(point);
  }
  function updateLeaflet() {
    if (!map || mapMode !== 'leaflet') return;
    if (!validCenter(chosen)) {
      if (circle) { circle.remove(); circle = null; }
      if (marker) { marker.remove(); marker = null; }
      return;
    }
    const point = [Number(chosen.lat), Number(chosen.lng)];
    if (!circle) circle = L.circle(point, {
      radius: radius() * 1000, color:'#13aa90', weight:2, fillColor:'#19b79d', fillOpacity:0.14
    }).addTo(map);
    else { circle.setLatLng(point); circle.setRadius(radius() * 1000); }
    if (!marker) marker = L.marker(point).addTo(map);
    else marker.setLatLng(point);
    map.fitBounds(circle.getBounds(), {padding:[25,25], maxZoom:13, animate:false});
    setTimeout(() => map.invalidateSize(), 100);
  }
  function redraw() {
    if (mapMode === 'google') updateGoogle();
    if (mapMode === 'leaflet') updateLeaflet();
  }
  function startGoogle() {
    if (!window.google?.maps || mapMode !== 'pending') return;
    mapMode = 'google';
    panel.replaceChildren();
    map = new google.maps.Map(panel, {
      center:{lat:46.6,lng:2.2}, zoom:6,
      mapTypeControl:false, streetViewControl:false, fullscreenControl:false,
      gestureHandling:'cooperative'
    });
    providerLabel.textContent = 'Carte Google Maps';
    redraw();
  }
  function startLeaflet() {
    if (mapMode === 'leaflet' || mapMode === 'google') return;
    if (window.L) {
      mapMode = 'leaflet';
      panel.replaceChildren();
      map = L.map(panel, {scrollWheelZoom:false}).setView([46.6,2.2],6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom:18, attribution:'&copy; OpenStreetMap contributors'
      }).addTo(map);
      providerLabel.textContent = 'Carte OpenStreetMap';
      redraw();
      setTimeout(() => map.invalidateSize(), 200);
      return;
    }
    if (starting === 'leaflet') return;
    starting = 'leaflet';
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => { starting = null; startLeaflet(); };
    script.onerror = () => {
      starting = null;
      providerLabel.textContent = 'La carte n’a pas pu être chargée';
    };
    document.head.appendChild(script);
  }
  function startMap() {
    if (initialized) { if (mapMode === 'leaflet') setTimeout(() => map?.invalidateSize(), 100); return; }
    initialized = true;
    fetch('/api/maps/config', {credentials:'same-origin'})
      .then(r => r.ok ? r.json() : Promise.reject(new Error('config')))
      .then(cfg => {
        if (!cfg.googleMapsConfigured || !cfg.browserKey) {startLeaflet(); return;}
        mapMode = 'pending';
        window.__artisanMapsReady = () => { if (mapMode === 'pending') startGoogle(); };
        const s = document.createElement('script');
        s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(cfg.browserKey) +
          '&v=weekly&language=fr&region=FR&callback=__artisanMapsReady';
        s.onerror = () => { if (mapMode === 'pending') startLeaflet(); };
        document.head.appendChild(s);
        setTimeout(() => { if (mapMode === 'pending') startLeaflet(); }, 10000);
      })
      .catch(() => startLeaflet());
  }
  function hydrate(profile) {
    closeList();
    radiusInput.value = String(Math.min(100, Math.max(1, Number(profile?.radius_km || 20))));
    if (profile?.city_code && validCenter({lat:profile.city_lat,lng:profile.city_lng})) {
      chosen = {code:profile.city_code,name:profile.city,lat:Number(profile.city_lat),lng:Number(profile.city_lng)};
      cityInput.value = chosen.name;
      feedback.textContent = '✓ Ville sélectionnée et enregistrée';
      feedback.classList.add('is-valid');
    } else {
      chosen = null;
      feedback.textContent = profile?.city ? 'Sélectionnez à nouveau la commune proposée pour activer le rayon.' : 'Choisissez une ville parmi les suggestions.';
      feedback.classList.remove('is-valid');
    }
    updateLabel(); redraw();
  }
  function selected() {
    if (!chosen) return null;
    return {city_code:chosen.code, city:chosen.name, radius_km:radius()};
  }
  updateLabel();
  window.ArtisanCoverage = {activate:startMap, hydrate, selection:selected};
})();