import { contextBridge, ipcRenderer } from "electron";
import type { MetadataCredentials, MetadataProvider, OpticalDrive, PreservationJob } from "./shared";

contextBridge.exposeInMainWorld("loadPlay", {
  scanDrives: () => ipcRenderer.invoke("drives:scan"),
  listSystems: () => ipcRenderer.invoke("systems:list"),
  probeDisc: (drive: OpticalDrive) => ipcRenderer.invoke("disc:probe", drive),
  scanTools: () => ipcRenderer.invoke("tools:scan"),
  lookupMetadata: (provider: MetadataProvider, title: string, credentials: MetadataCredentials) => ipcRenderer.invoke("metadata:lookup", provider, title, credentials),
  chooseDestination: () => ipcRenderer.invoke("destination:choose"),
  listLibrary: (root: string) => ipcRenderer.invoke("library:list", root),
  verifyLibraryItem: (root: string, manifestPath: string) => ipcRenderer.invoke("library:verify", root, manifestPath),
  startJob: (job: PreservationJob) => ipcRenderer.invoke("job:start", job),
  onJobOutput: (listener: (message: string) => void) => {
    ipcRenderer.on("job:output", (_event, message) => listener(message));
  }
});