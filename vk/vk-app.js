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
  const vkAppId = '54823637';
  const verifiedLaunchId = launch.get('vk_app_id') === vkAppId;
  const embedded = Boolean(
    bridge && typeof bridge.isEmbedded === 'function' && bridge.isEmbedded()
  );
  const inVK = Boolean(bridge && (embedded || (verifiedLaunchId && launch.has('vk_platform'))));
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
        // Ответ на наш VKWebAppSetLocation не должен повторно открывать карточку
        // и сбрасывать внутреннюю историю переходов.
        if (encodeRoute(decodeRoute(fragment)) === window.location.hash) return;
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

  function showLinkPanel(link) {
    const panel = document.getElementById('share-panel');
    const field = document.getElementById('share-link');
    const status = document.getElementById('share-copy-status');
    if (!panel || !field) return;
    field.value = link;
    if (status) {
      status.textContent = '';
      status.hidden = true;
    }
    panel.hidden = false;
    field.focus({ preventScroll: true });
    field.select();
  }

  function hideLinkPanel() {
    const panel = document.getElementById('share-panel');
    if (panel) panel.hidden = true;
  }

  async function copyDisplayedLink() {
    const field = document.getElementById('share-link');
    const status = document.getElementById('share-copy-status');
    if (!field || !status || !field.value) return;
    let copied = false;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(field.value);
        copied = true;
      } catch (_) { /* WebView может запретить Clipboard API. */ }
    }
    if (!copied) {
      try {
        field.focus({ preventScroll: true });
        field.select();
        // Старые WebView иногда поддерживают копирование только через execCommand.
        copied = typeof document.execCommand === 'function' &&
          document.execCommand('copy') === true;
      } catch (_) { /* Оставим поле выделенным для ручного копирования. */ }
    }
    status.hidden = false;
    status.textContent = copied
      ? 'Ссылка скопирована.'
      : 'Не удалось скопировать автоматически. Выделите ссылку и скопируйте её вручную.';
  }

  // VK Bridge отклоняет Promise не только при техническом сбое, но и когда
  // пользователь закрывает стандартное окно отправки крестиком.
  // В этом случае не показываем резервную панель копирования.
  function isShareCancelled(error) {
    if (!error) return false;
    if (error.name === 'AbortError') return true;

    const details = error.error_data || error.data?.error_data ||
      error.detail?.data?.error_data || {};
    const type = error.error_type || error.data?.error_type ||
      error.detail?.data?.error_type;
    const reason = [
      details.error_reason,
      details.error_description,
      error.reason,
      error.message,
      error.error_reason
    ].filter(v => typeof v === 'string').join(' ');

    // В клиентах ВК распространён код client_error / 4 ("User denied").
    if (type === 'client_error' && Number(details.error_code) === 4) return true;
    return /abort|cancel|dismiss|user denied|user rejected|user closed|отмен|отклон|закрыл/i.test(reason);
  }

  async function share(id) {
    const link = getLink(id);
    if (inVK) {
      try {
        await bridgeSend('VKWebAppShare', { link });
        return;
      } catch (error) {
        // Закрытие штатного окна ВК — нормальная отмена, а не повод
        // предлагать копирование ссылки.
        if (isShareCancelled(error)) return;
        // Только при настоящей ошибке/недоступности показываем запасной способ.
        showLinkPanel(link);
        return;
      }
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Карта Поднебесья', url: link });
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') return;
      }
    }
    showLinkPanel(link);
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
    const closeShareButton = document.getElementById('share-close');
    const copyShareButton = document.getElementById('share-copy');
    const shareField = document.getElementById('share-link');
    if (closeShareButton) closeShareButton.addEventListener('click', hideLinkPanel);
    if (copyShareButton) copyShareButton.addEventListener('click', copyDisplayedLink);
    if (shareField) {
      shareField.addEventListener('click', () => shareField.select());
      shareField.addEventListener('focus', () => shareField.select());
    }
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const panel = document.getElementById('share-panel');
      if (panel && !panel.hidden) {
        event.stopImmediatePropagation();
        hideLinkPanel();
      }
    }, true);
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
