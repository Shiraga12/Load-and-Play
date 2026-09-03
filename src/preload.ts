import { contextBridge, ipcRenderer } from "electron";
import type { PreservationJob } from "./shared";

contextBridge.exposeInMainWorld("loadPlay", {
  scanDrives: () => ipcRenderer.invoke("drives:scan"),
  scanTools: () => ipcRenderer.invoke("tools:scan"),
  chooseDestination: () => ipcRenderer.invoke("destination:choose"),
  startJob: (job: PreservationJob) => ipcRenderer.invoke("job:start", job),
  onJobOutput: (listener: (message: string) => void) => {
    ipcRenderer.on("job:output", (_event, message) => listener(message));
  }
});