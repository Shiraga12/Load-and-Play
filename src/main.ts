import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import type { ImageFormat, OpticalDrive, PreservationJob, ToolStatus } from "./shared";

const execFileAsync = promisify(execFile);
let mainWindow: BrowserWindow | null = null;
let captureInProgress = false;

function cleanTitle(value: string): string {
  return value.replace(/[^a-zA-Z0-9._ -]/g, "").trim().slice(0, 100) || "untitled-disc";
}

async function locate(executable: string): Promise<boolean> {
  try {
    await execFileAsync("where.exe", [executable], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function scanDrives(): Promise<OpticalDrive[]> {
  const script = "Get-CimInstance Win32_CDROMDrive | Select-Object DeviceID,Name,MediaLoaded | ConvertTo-Json -Compress";
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true });
    if (!stdout.trim()) return [];
    const data = JSON.parse(stdout) as Array<{ DeviceID: string; Name: string; MediaLoaded: boolean }> | { DeviceID: string; Name: string; MediaLoaded: boolean };
    return (Array.isArray(data) ? data : [data]).map((drive) => ({
      id: drive.DeviceID,
      letter: drive.DeviceID.replace("\\\\.\\", ""),
      name: drive.Name,
      mediaLoaded: Boolean(drive.MediaLoaded)
    }));
  } catch {
    return [];
  }
}

async function scanTools(): Promise<ToolStatus[]> {
  const tools = [
    { name: "dd", purpose: "Creates a raw ISO image" },
    { name: "chdman", purpose: "Packages a disc image as CHD" },
    { name: "dolphin-tool", purpose: "Converts compatible images to RVZ" },
    { name: "DiscImageCreator", purpose: "Specialized optical-drive preservation" }
  ];
  return Promise.all(tools.map(async (tool) => ({ ...tool, available: await locate(`${tool.name}.exe`) || await locate(tool.name) })));
}

interface ExtractionCommand {
  command: string;
  args: string[];
  output: string;
}

function commandFor(job: PreservationJob): ExtractionCommand | null {
  const title = cleanTitle(job.title);
  const output = path.join(job.destination, `${title}.${job.format}`);
  if (job.format === "iso") return { command: "dd", args: [`if=\\\\.\\${job.drive.letter}:`, `of=${output}`, "bs=4M", "status=progress"], output };
  return null;
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function saveLibraryRecord(job: PreservationJob, output: string): Promise<void> {
  const recordPath = `${output}.loadplay.json`;
  const record = {
    schemaVersion: 1,
    title: cleanTitle(job.title),
    format: job.format,
    imagePath: output,
    sha256: await sha256(output),
    sourceDrive: job.drive.name,
    completedAt: new Date().toISOString()
  };
  await mkdir(job.destination, { recursive: true });
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  mainWindow?.webContents.send("job:output", `SHA-256: ${record.sha256}`);
  mainWindow?.webContents.send("job:output", `Library record: ${recordPath}`);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: "#f3f1e8",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.loadFile(path.join(__dirname, "../src/renderer/index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("drives:scan", scanDrives);
  ipcMain.handle("tools:scan", scanTools);
  ipcMain.handle("destination:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("job:start", async (_event, job: PreservationJob) => {
    if (captureInProgress) return { started: false, message: "A capture is already running." };
    if (!job.drive.mediaLoaded) return { started: false, message: "The selected drive does not report inserted media." };
    const command = commandFor(job);
    if (!command) return { started: false, message: `${job.format.toUpperCase()} requires a configured compatible imaging workflow. ISO with dd is currently supported.` };
    if (!(await locate(command.command))) return { started: false, message: `Could not find ${command.command} on PATH.` };
    await mkdir(job.destination, { recursive: true });
    captureInProgress = true;
    const child = spawn(command.command, command.args, { windowsHide: true });
    child.stdout.on("data", (chunk) => mainWindow?.webContents.send("job:output", chunk.toString()));
    child.stderr.on("data", (chunk) => mainWindow?.webContents.send("job:output", chunk.toString()));
    child.on("close", async (code) => {
      if (code !== 0) {
        captureInProgress = false;
        mainWindow?.webContents.send("job:output", `Extraction failed with exit code ${code}.`);
        return;
      }
      mainWindow?.webContents.send("job:output", "Image created. Calculating SHA-256 and saving library record...");
      try {
        await saveLibraryRecord(job, command.output);
        mainWindow?.webContents.send("job:output", "Preservation complete.");
      } catch (error) {
        mainWindow?.webContents.send("job:output", `Image created, but library finalization failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        captureInProgress = false;
      }
    });
    child.on("error", (error) => {
      captureInProgress = false;
      mainWindow?.webContents.send("job:output", `Could not start extraction: ${error.message}`);
    });
    return { started: true, message: `Imaging ${job.drive.letter}: to ${job.destination}` };
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });