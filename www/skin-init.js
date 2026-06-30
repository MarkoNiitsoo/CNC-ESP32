import { initializeSkinSystem, KNOWN_SKINS } from './lib/ui-skins.js';

const warnings = [];

function showWarning(message) {
  warnings.push(message);
  console.warn(message);
  const status = document.querySelector('#skin-status');
  if (status) status.textContent = message;
  window.dispatchEvent(new CustomEvent('cnc-skin-warning', { detail: { message } }));
}

function setupSelector(manager) {
  const selector = document.querySelector('#skin-selector');
  if (!selector) return;
  selector.textContent = '';
  KNOWN_SKINS.forEach((skin) => {
    const option = document.createElement('option');
    option.value = skin.id;
    option.textContent = skin.name;
    selector.append(option);
  });
  selector.value = manager.activeManifest.id;
  const status = document.querySelector('#skin-status');
  if (status && !warnings.length) status.textContent = `${manager.activeManifest.name} active`;
  selector.addEventListener('change', async () => {
    selector.disabled = true;
    try {
      const active = await manager.apply(selector.value);
      selector.value = active.id;
      if (status) status.textContent = `${active.name} active`;
      window.dispatchEvent(new CustomEvent('cnc-skin-change', { detail: { skin: active } }));
    } catch (error) {
      showWarning(`Could not apply skin: ${error.message}`);
    } finally {
      selector.disabled = false;
    }
  });
}

initializeSkinSystem({ root: document, onWarning: showWarning })
  .then((manager) => {
    window.CncSkin = manager;
    setupSelector(manager);
    const observer = new MutationObserver((changes) => {
      changes.forEach((change) => change.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) manager.applyIcons(node);
      }));
    });
    observer.observe(document.body, { childList: true, subtree: true });
    manager.applyIcons(document);
    window.dispatchEvent(new CustomEvent('cnc-skin-ready', { detail: { skin: manager.activeManifest } }));
  })
  .catch((error) => showWarning(`Skin system unavailable; base theme remains active. ${error.message}`));
