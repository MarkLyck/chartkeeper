import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ChartKeeperApi } from '../shared/api';

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

const subscribe = (channel: string) => (cb: (v: any) => void) => {
  const listener = (_e: unknown, v: unknown) => cb(v);
  ipcRenderer.on(channel, listener);
  return () => void ipcRenderer.removeListener(channel, listener);
};

const api: ChartKeeperApi = {
  getState: invoke(IPC.getState) as ChartKeeperApi['getState'],
  setSettings: invoke(IPC.setSettings) as ChartKeeperApi['setSettings'],
  chooseFolder: invoke(IPC.chooseFolder) as ChartKeeperApi['chooseFolder'],
  signIn: invoke(IPC.signIn) as ChartKeeperApi['signIn'],
  signOut: invoke(IPC.signOut) as ChartKeeperApi['signOut'],
  backupNow: invoke(IPC.backupNow) as ChartKeeperApi['backupNow'],
  listSnapshots: invoke(IPC.listSnapshots) as ChartKeeperApi['listSnapshots'],
  loadLayout: invoke(IPC.loadLayout) as ChartKeeperApi['loadLayout'],
  compare: invoke(IPC.compare) as ChartKeeperApi['compare'],
  restoreTargets: invoke(IPC.restoreTargets) as ChartKeeperApi['restoreTargets'],
  restore: invoke(IPC.restore) as ChartKeeperApi['restore'],
  restoreTemplates: invoke(IPC.restoreTemplates) as ChartKeeperApi['restoreTemplates'],
  openFolder: invoke(IPC.openFolder) as ChartKeeperApi['openFolder'],
  openOnTradingView: invoke(IPC.openOnTradingView) as ChartKeeperApi['openOnTradingView'],
  onProgress: subscribe(IPC.progress) as ChartKeeperApi['onProgress'],
  onStateChanged: subscribe(IPC.state) as ChartKeeperApi['onStateChanged'],
};

contextBridge.exposeInMainWorld('chartkeeper', api);
