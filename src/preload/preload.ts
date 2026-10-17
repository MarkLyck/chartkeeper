import { contextBridge, ipcRenderer } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, type ChartKeeperApi, type Events, type Invoke } from '../shared/api';

// The one unchecked step: main registers each channel with the matching signature through handle() in src/main/ipc.ts.
const invoke = Object.fromEntries(Object.entries(INVOKE_CHANNELS).map(([method, channel]) => [method, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)])) as Invoke;

const subscribe =
  <K extends keyof Events>(event: K) =>
  (cb: (payload: Events[K]) => void) => {
    const listener = (_e: unknown, payload: Events[K]) => cb(payload);
    ipcRenderer.on(EVENT_CHANNELS[event], listener);
    return () => void ipcRenderer.removeListener(EVENT_CHANNELS[event], listener);
  };

const api: ChartKeeperApi = { ...invoke, onProgress: subscribe('progress'), onStateChanged: subscribe('state') };

contextBridge.exposeInMainWorld('chartkeeper', api);
