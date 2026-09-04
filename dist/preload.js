"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("loadPlay", {
    scanDrives: () => electron_1.ipcRenderer.invoke("drives:scan"),
    listSystems: () => electron_1.ipcRenderer.invoke("systems:list"),
    probeDisc: (drive) => electron_1.ipcRenderer.invoke("disc:probe", drive),
    scanTools: () => electron_1.ipcRenderer.invoke("tools:scan"),
    lookupMetadata: (provider, title) => electron_1.ipcRenderer.invoke("metadata:lookup", provider, title),
    chooseDestination: () => electron_1.ipcRenderer.invoke("destination:choose"),
    startJob: (job) => electron_1.ipcRenderer.invoke("job:start", job),
    onJobOutput: (listener) => {
        electron_1.ipcRenderer.on("job:output", (_event, message) => listener(message));
    }
});
