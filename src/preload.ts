import { contextBridge, ipcRenderer } from "electron";
import type { OpticalDrive, PreservationJob } from "./shared";

contextBridge.exposeInMainWorld("loadPlay", {
  scanDrives: () => ipcRenderer.invoke("drives:scan"),
  listSystems: () => ipcRenderer.invoke("systems:list"),
  probeDisc: (drive: OpticalDrive) => ipcRenderer.invoke("disc:probe", drive),
  scanTools: () => ipcRenderer.invoke("tools:scan"),
  chooseDestination: () => ipcRenderer.invoke("destination:choose"),
  startJob: (job: PreservationJob) => ipcRenderer.invoke("job:start", job),
  onJobOutput: (listener: (message: string) => void) => {
    ipcRenderer.on("job:output", (_event, message) => listener(message));
  }
});