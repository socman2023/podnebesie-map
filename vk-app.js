'use strict';

/*
 * ВК-адаптер карты Поднебесья.
 * Не требует авторизации, личных данных и регистрации пользователя.
 * Вне ВКонтакте сохранены обычные URL, карта и Web Share/копирование ссылки.
 * ВКонтакте используется отдельно поставляемый локальный VK Bridge 2.15.12.
 */
(function () {
  const launch = new URLSearchParams(window.location.search);
  const bridge = window.vkBridge || null;
  const vkAppId = /^\d+$/.test(launch.get('vk_app_id') || '') ? launch.get('vk_app_id') : null;
  const embedded = Boolean(
    bridge && typeof bridge.isEmbedded === 'function' && bridge.isEmbedded()
  );
  const inVK = Boolean(bridge && (embedded || (vkAppId && launch.has('vk_platform'))));
  let routeHandlers = null;
  let applyingExternalRoute = false;
  let lastVKLocation = null;
  let noticeTimer = null;

  function decodeRoute(fragment) {
    if (typeof fragment !== 'string') return null;
    const raw = fragment.replace(/^#/, '');
    const id = new URLSearchParams(raw).get('place');
    // Идентификаторы — только стабильные ASCII slug'и, без путей и HTML.
    return id && /^[a-zA-Z0-9_-]{1,80}$/.test(id) ? id : null;
  }

  function encodeRoute(id) {
    return id ? '#place=' + encodeURIComponent(id) : '';
  }

  function showNotice(text) {
    const feedback = document.getElementById('action-feedback');
    if (!feedback) return;
    feedback.textContent = text;
    feedback.hidden = false;
    if (noticeTimer) window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => { feedback.hidden = true; }, 3600);
  }

  function bridgeSend(method, params) {
    if (!inVK || !bridge || typeof bridge.send !== 'function') {
      return Promise.reject(new Error('VK Bridge недоступен в этом окружении'));
    }
    try {
      return Promise.resolve(bridge.send(method, params));
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function applyIncoming(fragment, updateLocalHash) {
    const id = decodeRoute(fragment);
    if (updateLocalHash) {
      const desired = encodeRoute(id);
      if (window.location.hash !== desired) {
        const url = window.location.pathname + window.location.search + desired;
        window.history.replaceState(window.history.state, '', url);
      }
    }
    if (!routeHandlers) return;
    applyingExternalRoute = true;
    try {
      if (id && routeHandlers.has(id)) routeHandlers.open(id);
      else routeHandlers.close();
    } finally {
      applyingExternalRoute = false;
    }
  }

  function setSelectedId(id, options) {
    if (applyingExternalRoute) return;
    const desired = encodeRoute(id);
    if (window.location.hash !== desired) {
      const url = window.location.pathname + window.location.search + desired;
      if (options && options.replace) window.history.replaceState({ podnebesieRoute: true }, '', url);
      else window.history.pushState({ podnebesieRoute: true }, '', url);
    }
    if (inVK && lastVKLocation !== desired) {
      lastVKLocation = desired;
      // VK Mini Apps: состояние #place=id участвует в навигации клиента.
      bridgeSend('VKWebAppSetLocation', { location: desired.slice(1) })
        .catch(() => { lastVKLocation = null; });
    }
  }

  function attachRoutes(handlers) {
    routeHandlers = handlers;
    applyIncoming(window.location.hash, false);
  }

  window.addEventListener('popstate', () => applyIncoming(window.location.hash, false));
  window.addEventListener('hashchange', () => applyIncoming(window.location.hash, false));

  if (inVK && bridge && typeof bridge.subscribe === 'function') {
    bridge.subscribe((event) => {
      const detail = event && event.detail;
      if (!detail || typeof detail.type !== 'string') return;
      if (detail.type === 'VKWebAppChangeFragment') {
        const fragment = detail.data && detail.data.location;
        if (typeof fragment !== 'string') return;
        applyIncoming(fragment, true);
      }
      if (detail.type === 'VKWebAppUpdateConfig') {
        const inset = detail.data && detail.data.insets;
        if (!inset || typeof inset !== 'object') return;
        for (const edge of ['top', 'right', 'bottom', 'left']) {
          if (typeof inset[edge] === 'number' && Number.isFinite(inset[edge])) {
            const value = Math.max(0, Math.min(150, inset[edge]));
            document.documentElement.style.setProperty('--vk-inset-' + edge, value + 'px');
          }
        }
      }
    });
    // VKWebAppInit обязателен, но сбой не должен мешать пользоваться картой.
    bridgeSend('VKWebAppInit').catch(() => {
      showNotice('Функции ВКонтакте временно недоступны. Картой можно пользоваться.');
    });
    document.documentElement.classList.add('vk-embedded');
  }

  function getLink(id) {
    const fragment = encodeRoute(id);
    if (inVK && vkAppId) return 'https://vk.com/app' + vkAppId + fragment;
    // Никогда не переносим vk_user_id, sign, токены и launch-параметры в ссылку.
    return window.location.origin + window.location.pathname + fragment;
  }

  async function share(id) {
    const link = getLink(id);
    if (inVK) {
      try {
        await bridgeSend('VKWebAppShare', { link });
        return;
      } catch (_) { /* Пользователь отменил или клиент не поддерживает. */ }
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Карта Поднебесья', url: link });
        return;
      } catch (_) { /* На некоторых платформах Web Share недоступен. */ }
    }
    try {
      await navigator.clipboard.writeText(link);
      showNotice('Ссылка скопирована');
    } catch (_) {
      // Для нестандартных WebView — доступная пользователю ручная копия.
      window.prompt('Скопируйте ссылку:', link);
    }
  }

  function addToFavorites() {
    bridgeSend('VKWebAppAddToFavorites')
      .then(() => showNotice('Запрос на добавление в избранное выполнен'))
      .catch(() => showNotice('Не удалось добавить в избранное. Проверьте настройки ВК.'));
  }

  function bindButtons() {
    const shareButton = document.getElementById('vk-share');
    const favoriteButton = document.getElementById('vk-favorite');
    const locationShareButton = document.getElementById('location-share');
    if (shareButton) {
      shareButton.hidden = false;
      shareButton.addEventListener('click', () => share(null));
    }
    if (locationShareButton) {
      locationShareButton.addEventListener('click', () => {
        const id = routeHandlers && typeof routeHandlers.selected === 'function'
          ? routeHandlers.selected() : decodeRoute(window.location.hash);
        share(id);
      });
    }
    if (favoriteButton && inVK) {
      favoriteButton.hidden = false;
      favoriteButton.addEventListener('click', addToFavorites);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindButtons, { once: true });
  } else {
    bindButtons();
  }

  window.PodnebesieVK = Object.freeze({
    attachRoutes,
    setSelectedId,
    getLink,
    share,
    isVK: inVK
  });
})();
