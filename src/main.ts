import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import type { DiscProbe, ImageFormat, OpticalDrive, PreservationJob, SystemProfile, ToolStatus } from "./shared";

const execFileAsync = promisify(execFile);
let mainWindow: BrowserWindow | null = null;
let captureInProgress = false;
let systemProfiles: SystemProfile[] | null = null;

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

async function loadSystemProfiles(): Promise<SystemProfile[]> {
  if (systemProfiles) return systemProfiles;
  const directory = path.join(app.getAppPath(), "systems");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json"));
  const profiles = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(directory, file), "utf8")) as SystemProfile));
  systemProfiles = profiles;
  return profiles;
}

async function profileFor(shortName: string): Promise<SystemProfile | null> {
  return (await loadSystemProfiles()).find((profile) => profile.shortName.toLowerCase() === shortName.toLowerCase()) ?? null;
}

async function probeDisc(drive: OpticalDrive): Promise<DiscProbe> {
  if (!drive.mediaLoaded) return { system: null, evidence: "No media reported by the selected drive." };
  if (!/^[A-Z]:$/i.test(drive.letter)) return { system: null, evidence: "The drive identifier is not valid for probing." };
  const systemCnfPath = `${drive.letter}\\SYSTEM.CNF`;
  const script = `Get-Content -LiteralPath '${systemCnfPath}' -Raw -ErrorAction Stop`;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true });
    if (/BOOT2\s*=|BOOT2\s*:/i.test(stdout)) return { system: await profileFor("PS2"), evidence: "SYSTEM.CNF contains a PlayStation 2 BOOT2 entry." };
    if (/BOOT\s*=|BOOT\s*:/i.test(stdout)) return { system: await profileFor("PSX"), evidence: "SYSTEM.CNF contains a PlayStation boot entry." };
    return { system: null, evidence: "SYSTEM.CNF was readable but did not match a supported platform signature." };
  } catch {
    return { system: null, evidence: "No readable platform signature was found. Select a system manually if known." };
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

interface CapturePaths {
  root: string;
  master: string;
  play: string;
  manifest: string;
}

function capturePathsFor(job: PreservationJob): CapturePaths {
  const platform = cleanTitle(job.system?.name ?? "Unknown");
  const title = cleanTitle(job.title);
  const root = path.join(job.destination, platform, title);
  return { root, master: path.join(root, "preservation", `${title}.iso`), play: path.join(root, "play"), manifest: path.join(root, "metadata.json") };
}

function commandFor(job: PreservationJob): ExtractionCommand | null {
  const output = capturePathsFor(job).master;
  return { command: "dd", args: [`if=\\\\.\\${job.drive.letter}:`, `of=${output}`, "bs=4M", "status=progress"], output };
}

interface PlayCopy {
  format: Exclude<ImageFormat, "iso">;
  imagePath: string;
  sha256: string;
}

async function runTool(command: string, args: string[], label: string): Promise<void> {
  mainWindow?.webContents.send("job:output", `${label}...`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    child.stdout.on("data", (chunk) => mainWindow?.webContents.send("job:output", chunk.toString()));
    child.stderr.on("data", (chunk) => mainWindow?.webContents.send("job:output", chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)));
  });
}

async function createPlayCopy(job: PreservationJob, master: string): Promise<PlayCopy | null> {
  if (job.format === "iso") return null;
  const paths = capturePathsFor(job);
  const title = cleanTitle(job.title);
  const allowedFormats = job.system?.fileFormats ?? [];
  if (!allowedFormats.includes(`.${job.format}`)) throw new Error(`${job.format.toUpperCase()} is not supported by the selected system profile.`);
  await mkdir(paths.play, { recursive: true });

  if (job.format === "chd") {
    if (!job.system?.media.some((medium) => /DVD/i.test(medium))) throw new Error("CHD conversion from the current ISO master is limited to DVD-based system profiles. CD systems require a BIN/CUE master workflow.");
    if (!(await locate("chdman.exe")) && !(await locate("chdman"))) throw new Error("Could not find chdman on PATH.");
    const output = path.join(paths.play, `${title}.chd`);
    await runTool("chdman", ["createdvd", "-i", master, "-o", output], "Creating CHD play copy");
    return { format: "chd", imagePath: output, sha256: await sha256(output) };
  }

  if (!job.system || !["gamecube", "wii"].includes(job.system.shortName.toLowerCase())) throw new Error("RVZ conversion is limited to GameCube and Wii system profiles.");
  if (!(await locate("dolphin-tool.exe")) && !(await locate("dolphin-tool"))) throw new Error("Could not find dolphin-tool on PATH.");
  const output = path.join(paths.play, `${title}.rvz`);
  await runTool("dolphin-tool", ["convert", "-i", master, "-o", output, "-f", "rvz", "-b", "131072", "-c", "zstd", "-l", "5"], "Creating RVZ play copy");
  return { format: "rvz", imagePath: output, sha256: await sha256(output) };
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function saveLibraryRecord(job: PreservationJob, output: string, playCopy: PlayCopy | null): Promise<void> {
  const paths = capturePathsFor(job);
  const record = {
    schemaVersion: 1,
    title: cleanTitle(job.title),
    platform: job.system?.name ?? "Unknown",
    preservation: { format: "iso", imagePath: output, sha256: await sha256(output) },
    playCopy,
    sourceDrive: job.drive.name,
    completedAt: new Date().toISOString()
  };
  await mkdir(paths.root, { recursive: true });
  await writeFile(paths.manifest, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  mainWindow?.webContents.send("job:output", `SHA-256: ${record.preservation.sha256}`);
  mainWindow?.webContents.send("job:output", `Library record: ${paths.manifest}`);
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
  ipcMain.handle("systems:list", loadSystemProfiles);
  ipcMain.handle("disc:probe", (_event, drive: OpticalDrive) => probeDisc(drive));
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
    await mkdir(path.dirname(command.output), { recursive: true });
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
        const playCopy = await createPlayCopy(job, command.output);
        await saveLibraryRecord(job, command.output, playCopy);
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