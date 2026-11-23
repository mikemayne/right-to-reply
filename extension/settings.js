'use strict';

(async () => {
  const api = globalThis.browser ?? globalThis.chrome;
  const storage = api.storage.local;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const host = /^https?:/.test(tab?.url ?? '') ? new URL(tab.url).hostname : '';
  const enabled = document.querySelector('#enabled');
  const site = document.querySelector('#site');
  const refresh = document.querySelector('#refresh');
  const status = document.querySelector('#status');
  const saved = await storage.get(['enabled', 'sites']);
  enabled.checked = saved.enabled !== false;
  enabled.disabled = false;
  site.checked = Boolean(host) && saved.sites?.[host] !== false;
  site.disabled = !host;
  function save(input, task) {
    input.addEventListener('change', async () => {
      input.disabled = true;
      try {
        await task(input.checked);
      } catch {
        input.checked = !input.checked;
        status.textContent = 'Could not save the setting.';
      } finally {
        input.disabled = false;
      }
    });
  }
  save(enabled, checked => storage.set({ enabled: checked }));
  save(site, async checked => {
    const { sites = {} } = await storage.get('sites');
    await storage.set({ sites: { ...sites, [host]: checked } });
  });
  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    status.textContent = 'Refreshing…';
    try {
      const result = await api.runtime.sendMessage({ type: 'refresh-responses', force: true });
      status.textContent = result?.state === 'partial' ? 'Available parties refreshed. Some parties are temporarily unavailable.' :
        result?.ok ? 'Approved responses refreshed.' :
        result?.state === 'cached' ? 'Refresh failed. Using the last approved responses.' : 'No approved responses available.';
    } catch {
      status.textContent = 'Could not refresh approved responses.';
    } finally {
      refresh.disabled = false;
    }
  });
})();
