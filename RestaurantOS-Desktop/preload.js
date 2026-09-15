const { contextBridge, ipcRenderer } = require('electron');

// Same contextIsolation + no-nodeIntegration pattern as the current live app's own
// preload.js (the Stage 2b security fix) -- the renderer (the Next.js frontend) never gets
// direct Node/Electron access, only these specific, deliberate bridge functions.
contextBridge.exposeInMainWorld('restaurantOS', {
    listPrinters: () => ipcRenderer.invoke('hardware:listPrinters'),
    print: (payload) => ipcRenderer.invoke('hardware:print', payload),
    openCashDrawer: (printerId) => ipcRenderer.invoke('hardware:openCashDrawer', printerId),
    listPaymentTerminals: () => ipcRenderer.invoke('hardware:listPaymentTerminals'),
    getConfig: (key) => ipcRenderer.invoke('config:get', key),
    setConfig: (key, value) => ipcRenderer.invoke('config:set', key, value),

    // Weighing scale bridge
    listScales: () => ipcRenderer.invoke('hardware:listScales'),
    autoDetectScale: (options) => ipcRenderer.invoke('hardware:autoDetectScale', options),
    discoverNetworkScales: (subnetBase, options) => ipcRenderer.invoke('hardware:discoverNetworkScales', subnetBase, options),
    connectScale: (config) => ipcRenderer.invoke('hardware:connectScale', config),
    disconnectScale: () => ipcRenderer.invoke('hardware:disconnectScale'),
    getScaleReading: () => ipcRenderer.invoke('hardware:getScaleReading'),
    isScaleConnected: () => ipcRenderer.invoke('hardware:isScaleConnected'),
    onScaleWeight: (callback) => {
        const listener = (event, reading) => callback(reading);
        ipcRenderer.on('hardware:scale-weight', listener);
        return () => ipcRenderer.removeListener('hardware:scale-weight', listener);
    },
    onScaleError: (callback) => {
        const listener = (event, err) => callback(err);
        ipcRenderer.on('hardware:scale-error', listener);
        return () => ipcRenderer.removeListener('hardware:scale-error', listener);
    },
});
