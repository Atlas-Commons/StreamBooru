'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const pickSite = (arg) => (arg && typeof arg === 'object' && 'site' in arg ? arg.site : arg);

contextBridge.exposeInMainWorld('api', {
  // Config
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),

  // Fetch posts
  fetchBooru: (payload) => ipcRenderer.invoke('booru:fetch', payload),
  autocomplete: (payload) => ipcRenderer.invoke('booru:autocomplete', payload),

  // External
  openExternal: (url) => ipcRenderer.invoke('openExternal', url),

  // Images
  downloadImage: ({ url, siteName, fileName }) => ipcRenderer.invoke('download:image', { url, siteName, fileName }),
  downloadBulk: (items, options = {}) => ipcRenderer.invoke('download:bulk', { items, options }),
  downloadBulkCancel: () => ipcRenderer.invoke('download:bulkCancel'),
  proxyImage: (url) => ipcRenderer.invoke('image:proxy', { url }),

  // Site helpers
  favoritePost: (payload) => ipcRenderer.invoke('booru:favorite', payload),
  authCheck: (siteOrPayload) => ipcRenderer.invoke('booru:authCheck', { site: pickSite(siteOrPayload) }),
  rateLimit: (siteOrPayload) => ipcRenderer.invoke('booru:rateLimit', { site: pickSite(siteOrPayload) }),

  // Local favorites
  getLocalFavoriteKeys: () => ipcRenderer.invoke('favorites:keys'),
  getLocalFavorites: () => ipcRenderer.invoke('favorites:list'),
  toggleLocalFavorite: (post) => ipcRenderer.invoke('favorites:toggle', { post }),
  favCounts: (keys) => ipcRenderer.invoke('favorites:counts', { keys }),

  // Account + sync
  accountGet: () => ipcRenderer.invoke('account:get'),
  accountSetServer: (base) => ipcRenderer.invoke('account:setServer', base),
  accountRegister: (username, password) => ipcRenderer.invoke('account:register', { username, password }),
  accountLoginLocal: (username, password) => ipcRenderer.invoke('account:loginLocal', { username, password }),
  accountLoginDiscord: () => ipcRenderer.invoke('account:loginDiscord'),
  accountLinkDiscord: () => ipcRenderer.invoke('account:linkDiscord'),
  accountUnlinkDiscord: () => ipcRenderer.invoke('account:unlinkDiscord'),
  accountLogout: () => ipcRenderer.invoke('account:logout'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  syncOnLogin: () => ipcRenderer.invoke('sync:onLogin'),
  syncPullFavorites: () => ipcRenderer.invoke('sync:fav:pull'),
  sitesGetRemote: () => ipcRenderer.invoke('sites:getRemote'),
  sitesSaveRemote: (sites) => ipcRenderer.invoke('sites:saveRemote', sites),
});

contextBridge.exposeInMainWorld('events', {
  onConfigChanged: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_evt, cfg) => handler(cfg);
    ipcRenderer.on('config:changed', listener);
    return () => ipcRenderer.removeListener('config:changed', listener);
  },
  onFavoritesChanged: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = () => handler();
    ipcRenderer.on('favorites:changed', listener);
    return () => ipcRenderer.removeListener('favorites:changed', listener);
  },
  onAccountChanged: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = () => handler();
    ipcRenderer.on('account:changed', listener);
    return () => ipcRenderer.removeListener('account:changed', listener);
  },
  onDownloadProgress: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_evt, progress) => handler(progress);
    ipcRenderer.on('download:progress', listener);
    return () => ipcRenderer.removeListener('download:progress', listener);
  }
});
