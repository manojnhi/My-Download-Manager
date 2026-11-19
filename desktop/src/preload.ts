import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('myDownloadManager', {
  inspectUrl: (url: string) => ipcRenderer.invoke('downloads:inspect', url),
  readClipboardUrls: () => ipcRenderer.invoke('downloads:read-clipboard'),
  pickFolder: () => ipcRenderer.invoke('downloads:pick-folder'),
  addDownload: (url: string, confirmExecutable = false) =>
    ipcRenderer.invoke('downloads:add', { url, confirmExecutable }),
  pause: (id: string) => ipcRenderer.invoke('downloads:pause', id),
  resume: (id: string) => ipcRenderer.invoke('downloads:resume', id),
  remove: (id: string) => ipcRenderer.invoke('downloads:remove', id),
  onUpdated: (cb: (data: unknown) => void) =>
    ipcRenderer.on('downloads:updated', (_e, data) => cb(data)),
});
