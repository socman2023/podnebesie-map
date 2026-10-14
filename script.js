'use strict';

/*
 * Интерактивная карта Поднебесья, v2.
 * Leaflet CRS.Simple: исходная картинка 6670x4764; точка JSON {x,y} отсчитывается
 * от левого верхнего угла изображения. В CRS.Simple широта растёт снизу вверх.
 */
const MAP_WIDTH = 6670;
const MAP_HEIGHT = 4764;
const TYPE_NAMES = {
  state: 'Государство или владение', city: 'Город', tribe: 'Народ',
  place: 'Место', water: 'Водный объект', landmark: 'Достопримечательность',
  link: 'Ссылка'
};
const $ = (id) => document.getElementById(id);

const mapElement = $('map');
const statusElement = $('map-status');
const loadingElement = $('loading-state');
const searchForm = $('search-form');
const searchInput = $('search-input');
const searchResults = $('search-results');
const typeFilter = $('type-filter');
const listToggle = $('list-toggle');
const listPanel = $('list-panel');
const listItems = $('list-items');
const details = $('details');
const detailsTitle = $('details-title');
const detailsType = $('details-type');
const detailsImage = $('details-image');
const detailsDescription = $('details-description');
const detailsLinks = $('details-links');
const detailsBack = $('details-back');

let map = null;
let imageBounds = null;
let fitZoom = -5;
let previewOverlay = null;
let detailOverlay = null;
let detailReady = false;
let previewFallbackUsed = false;
let detailFallbackUsed = false;
const DETAIL_PRELOAD_ZOOM_GAIN = 0.75;
const DETAIL_SHOW_ZOOM_GAIN = 1.35;
let locations = [];
let selectedId = null;
let historyIds = [];
const byId = new Map();
const markers = new Map();

function folded(text) {
  return String(text || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
}

function coord(loc) {
  return [MAP_HEIGHT - loc.y, loc.x];
}

function matchesFilter(loc) {
  return typeFilter.value === 'all' || loc.type === typeFilter.value;
}

function searchMatches() {
  const q = folded(searchInput.value);
  return locations.filter((loc) => matchesFilter(loc) && folded(loc.title).includes(q))
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
}

function labelType(type) {
  return TYPE_NAMES[type] || 'Объект';
}

function makeResultButton(loc) {
  const btn = document.createElement('button');
  btn.type = 'button';
  const name = document.createElement('span');
  name.textContent = loc.title;
  const type = document.createElement('span');
  type.className = 'result-type';
  type.textContent = labelType(loc.type);
  btn.append(name, type);
  btn.addEventListener('click', () => {
    searchResults.hidden = true;
    listPanel.hidden = true;
    listToggle.setAttribute('aria-expanded', 'false');
    goToLocation(loc, true);
  });
  return btn;
}

function renderSearchResults() {
  searchResults.replaceChildren();
  const q = folded(searchInput.value);
  if (!q) {
    searchResults.hidden = true;
    return;
  }
  const matches = searchMatches();
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = 'Ничего не найдено. Попробуйте другое название или категорию.';
    searchResults.append(empty);
  } else {
    matches.slice(0, 8).forEach((loc) => searchResults.append(makeResultButton(loc)));
  }
  searchResults.hidden = false;
}

function renderList() {
  listItems.replaceChildren();
  const matches = searchMatches();
  if (!matches.length) {
    const message = document.createElement('p');
    message.className = 'empty-message';
    message.textContent = 'Нет объектов для выбранного фильтра.';
    listItems.append(message);
  } else {
    const frag = document.createDocumentFragment();
    matches.forEach((loc) => frag.append(makeResultButton(loc)));
    listItems.append(frag);
  }
}

function safeDescription(html) {
  const source = document.createElement('template');
  source.innerHTML = String(html || '');
  const fragment = document.createDocumentFragment();
  const permitted = new Set(['B', 'STRONG', 'I', 'EM']);
  const excluded = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG', 'FORM']);
  function appendSafe(node, target) {
    if (node.nodeType === Node.TEXT_NODE) {
      target.append(document.createTextNode(node.textContent || ''));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || excluded.has(node.tagName)) return;
    if (node.tagName === 'BR') {
      target.append(document.createElement('br'));
      return;
    }
    const next = permitted.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : target;
    Array.from(node.childNodes).forEach((child) => appendSafe(child, next));
    if (next !== target) target.append(next);
  }
  Array.from(source.content.childNodes).forEach((node) => appendSafe(node, fragment));
  detailsDescription.replaceChildren(fragment);
}

function showCard(loc, pushHistory) {
  if (pushHistory && selectedId && selectedId !== loc.id) historyIds.push(selectedId);
  if (!pushHistory) historyIds = [];
  selectedId = loc.id;
  detailsType.textContent = labelType(loc.type);
  detailsTitle.textContent = loc.title;
  safeDescription(loc.description);
  detailsImage.hidden = true;
  detailsImage.removeAttribute('src');
  if (typeof loc.image === 'string' && loc.image.trim()) {
    detailsImage.alt = 'Иллюстрация: ' + loc.title;
    detailsImage.hidden = false;
    detailsImage.src = loc.image;
  }

  detailsLinks.replaceChildren();
  (loc.links || []).forEach((link) => {
    if (!link || typeof link.text !== 'string') return;
    const target = link.url || link.target;
    if (typeof target !== 'string') return;
    if (/^https?:\/\//i.test(target)) {
      try {
        const href = new URL(target, window.location.href);
        if (!['https:', 'http:'].includes(href.protocol)) return;
        const anchor = document.createElement('a');
        anchor.textContent = link.text + ' ↗';
        anchor.href = href.href;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        detailsLinks.append(anchor);
      } catch (_) { /* Неправильный URL пропускаем. */ }
    } else if (byId.has(target)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = link.text + ' →';
      button.addEventListener('click', () => goToLocation(byId.get(target), true));
      detailsLinks.append(button);
    }
  });

  detailsBack.hidden = historyIds.length === 0;
  details.hidden = false;
  for (const [id, marker] of markers) {
    const el = marker.getElement();
    if (el) el.classList.toggle('map-pin--selected', id === selectedId);
    marker.setZIndexOffset(id === selectedId ? 1000 : 0);
  }
  if (map) renderMarkers();
  requestAnimationFrame(() => detailsTitle.focus({ preventScroll: true }));
}

function closeCard() {
  if (details.hidden) return;
  details.hidden = true;
  selectedId = null;
  historyIds = [];
  for (const marker of markers.values()) {
    const el = marker.getElement();
    if (el) el.classList.remove('map-pin--selected');
    marker.setZIndexOffset(0);
  }
  if (map) renderMarkers();
}

function goToLocation(loc, addHistory) {
  if (!map || !loc) return;
  if (!matchesFilter(loc)) typeFilter.value = 'all';
  const targetZoom = Math.min(map.getMaxZoom(), Math.max(map.getZoom(), fitZoom + 2.5));
  map.setView(coord(loc), targetZoom, { animate: false });
  showCard(loc, addHistory);
  // Смещаем выбранное место в видимую часть карты НАД мобильной карточкой.
  if (window.matchMedia('(max-width: 600px)').matches && !details.hidden) {
    const sheetHeight = details.getBoundingClientRect().height;
    const mapHeight = map.getSize().y;
    map.panBy([0, -Math.min(sheetHeight / 2, mapHeight * 0.34)], { animate: false });
  }
}

function makeMarker(loc) {
  const type = Object.prototype.hasOwnProperty.call(TYPE_NAMES, loc.type) ? loc.type : 'place';
  const icon = L.divIcon({
    className: 'map-pin map-pin--' + type,
    html: '<span class="map-pin-core" aria-hidden="true"></span>',
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });
  const marker = L.marker(coord(loc), {
    icon, keyboard: true, riseOnHover: true, title: loc.title + ' — ' + labelType(loc.type)
  });
  const name = document.createElement('span');
  name.textContent = loc.title;
  marker.bindTooltip(name, { direction: 'top', offset: [0, -12] });
  marker.on('click', () => goToLocation(loc, true));
  marker.on('add', () => {
    const el = marker.getElement();
    if (!el) return;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', loc.title + ' — ' + labelType(loc.type));
    el.setAttribute('tabindex', '0');
    if (loc.id === selectedId) el.classList.add('map-pin--selected');
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        goToLocation(loc, true);
      }
    });
  });
  return marker;
}

/*
 * На минимальном масштабе не закрываем всю карту сотней маркеров.
 * Всё остаётся доступным через поиск/список. При увеличении появляется больше точек.
 * Указываем пользователю число реально отображаемых объектов.
 */
function renderMarkers() {
  if (!map) return;
  updateRasterQuality();
  const zoomGain = map.getZoom() - fitZoom;
  let visibleTypes = null;
  // Активный фильтр обязан показывать выбранную категорию на любом масштабе.
  if (typeFilter.value === 'all') {
    if (zoomGain < 1.0) visibleTypes = new Set(['state', 'link']);
    else if (zoomGain < 1.8) visibleTypes = new Set(['state', 'city', 'landmark', 'link']);
  }
  const priority = { state: 1, city: 2, landmark: 3, place: 4, water: 5, tribe: 6, link: 7 };
  const candidates = locations
    .filter((loc) => matchesFilter(loc) && (!visibleTypes || visibleTypes.has(loc.type) || loc.id === selectedId))
    .sort((a, b) => (a.id === selectedId ? -1 : b.id === selectedId ? 1 :
      (priority[a.type] || 8) - (priority[b.type] || 8)));
  const used = [];
  const accepted = new Set();
  const gap = zoomGain < 1 ? 37 : zoomGain < 2 ? 33 : 27;
  for (const loc of candidates) {
    const p = map.latLngToContainerPoint(coord(loc));
    const padding = 22;
    if (p.x < -padding || p.y < -padding || p.x > map.getSize().x + padding || p.y > map.getSize().y + padding) continue;
    const overlaps = used.some((previous) => Math.hypot(previous.x - p.x, previous.y - p.y) < gap);
    if (overlaps && loc.id !== selectedId) continue;
    used.push(p);
    accepted.add(loc.id);
  }
  for (const [id, marker] of markers) {
    const wanted = accepted.has(id);
    if (wanted && !map.hasLayer(marker)) marker.addTo(map);
    else if (!wanted && map.hasLayer(marker)) marker.removeFrom(map);
  }
  statusElement.textContent = 'На экране: ' + accepted.size +
    '. Всего объектов: ' + locations.filter(matchesFilter).length +
    '. Приблизьте карту или воспользуйтесь поиском.';
}

function updateFitZoom() {
  if (!map) return;
  map.invalidateSize({ pan: false });
  const nextFit = map.getBoundsZoom(imageBounds, false, L.point(18, 18));
  fitZoom = nextFit;
  map.setMinZoom(fitZoom);
  if (map.getZoom() < fitZoom) map.setZoom(fitZoom, { animate: false });
  renderMarkers();
}

function updateRasterQuality() {
  if (!map || !previewOverlay) return;
  const zoomGain = map.getZoom() - fitZoom;

  // Не скачиваем полноразмерную карту до первого приближения.
  if (!detailOverlay && zoomGain >= DETAIL_PRELOAD_ZOOM_GAIN) {
    detailOverlay = L.imageOverlay('map-full.webp', imageBounds, {
      alt: 'Подробная художественная карта Поднебесья',
      opacity: 0, interactive: false
    }).addTo(map);
    detailOverlay.on('load', () => {
      detailReady = true;
      detailOverlay.setOpacity(map.getZoom() - fitZoom >= DETAIL_SHOW_ZOOM_GAIN ? 1 : 0);
    });
    detailOverlay.on('error', () => {
      if (detailFallbackUsed) return;
      detailFallbackUsed = true;
      detailOverlay.setUrl('map-base.png');
    });
  }
  if (detailOverlay && detailReady) {
    detailOverlay.setOpacity(zoomGain >= DETAIL_SHOW_ZOOM_GAIN ? 1 : 0);
  }
}

function initMap() {
  if (!window.L) {
    loadingElement.textContent = 'Не удалось загрузить движок карты. Проверьте подключение к интернету и обновите страницу.';
    return;
  }
  imageBounds = L.latLngBounds([0, 0], [MAP_HEIGHT, MAP_WIDTH]);
  map = L.map(mapElement, {
    crs: L.CRS.Simple, minZoom: -7, maxZoom: 1.25,
    zoomSnap: 0, zoomDelta: 0.5, scrollWheelZoom: true,
    zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
    zoomControl: false, attributionControl: false,
    preferCanvas: false, keyboard: true
  });
  // Сначала малая WebP (~0.4 MB); исходный PNG остаётся безопасным fallback.
  previewOverlay = L.imageOverlay('map-preview.webp', imageBounds, {
    alt: 'Художественная карта мира Поднебесья',
    interactive: false
  }).addTo(map);
  previewOverlay.on('error', () => {
    if (previewFallbackUsed) return;
    previewFallbackUsed = true;
    previewOverlay.setUrl('map-base.png');
  });
  L.control.zoom({ position: 'topright', zoomInTitle: 'Приблизить', zoomOutTitle: 'Отдалить' }).addTo(map);
  map.fitBounds(imageBounds, { padding: [18, 18], animate: false });
  fitZoom = map.getBoundsZoom(imageBounds, false, L.point(18, 18));
  map.setMinZoom(fitZoom);
  // На телефоне карта стартует в удобном масштабе, а не микроскопическим обзором.
  // Кнопка «Вся карта» возвращает к общему виду в один тап.
  if (window.matchMedia('(max-width: 600px)').matches) {
    const fillZoom = map.getBoundsZoom(imageBounds, true, L.point(12, 12));
    map.setZoom(Math.min(map.getMaxZoom(), Math.max(fitZoom + 1.15, fillZoom)), { animate: false });
  }
  // Без maxBounds: нужно уметь смещать точки у края карты выше мобильной карточки.
  for (const loc of locations) markers.set(loc.id, makeMarker(loc));
  map.on('zoomend moveend', renderMarkers);
  window.addEventListener('resize', updateFitZoom);
  renderMarkers();
  loadingElement.hidden = true;
}

detailsImage.addEventListener('error', () => { detailsImage.hidden = true; });
$('details-close').addEventListener('click', closeCard);
detailsBack.addEventListener('click', () => {
  if (!historyIds.length) return;
  const previous = byId.get(historyIds.pop());
  if (previous) {
    goToLocation(previous, true);
    historyIds.pop(); // Удаляем автоматически добавленный текущий объект.
    detailsBack.hidden = historyIds.length === 0;
  }
});
$('reset-view').addEventListener('click', () => {
  if (map) map.fitBounds(imageBounds, { padding: [18, 18] });
});
listToggle.addEventListener('click', () => {
  listPanel.hidden = !listPanel.hidden;
  listToggle.setAttribute('aria-expanded', String(!listPanel.hidden));
  if (!listPanel.hidden) renderList();
});
$('list-close').addEventListener('click', () => {
  listPanel.hidden = true;
  listToggle.setAttribute('aria-expanded', 'false');
  listToggle.focus();
});
searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const first = searchMatches()[0];
  if (first) {
    searchResults.hidden = true;
    goToLocation(first, true);
  } else renderSearchResults();
});
searchInput.addEventListener('input', () => {
  renderSearchResults();
  if (!listPanel.hidden) renderList();
});
typeFilter.addEventListener('change', () => {
  renderSearchResults();
  if (!listPanel.hidden) renderList();
  if (selectedId && !matchesFilter(byId.get(selectedId))) closeCard();
  renderMarkers();
});
document.addEventListener('pointerdown', (event) => {
  if (!searchForm.contains(event.target)) searchResults.hidden = true;
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!searchResults.hidden) searchResults.hidden = true;
  else if (!listPanel.hidden) {
    listPanel.hidden = true;
    listToggle.setAttribute('aria-expanded', 'false');
    listToggle.focus();
  } else if (!details.hidden) closeCard();
});

fetch('locations.json')
  .then((response) => {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  })
  .then((data) => {
    if (!Array.isArray(data)) throw new Error('Некорректный формат locations.json');
    locations = data.filter((loc) => loc && typeof loc.id === 'string' &&
      typeof loc.title === 'string' && Number.isFinite(loc.x) && Number.isFinite(loc.y));
    locations.forEach((loc) => byId.set(loc.id, loc));
    initMap();
  })
  .catch((error) => {
    console.error('Ошибка инициализации карты:', error);
    loadingElement.textContent = 'Не удалось загрузить данные карты. Попробуйте обновить страницу.';
  });