import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import type { DiscMetadata, DiscProbe, GameMetadataLookup, ImageFormat, LibraryItem, LibraryVerificationResult, MetadataCredentials, MetadataProvider, OpticalDrive, PreservationJob, SystemProfile, ToolStatus, VerificationStatus } from "./shared";

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

function emptyDiscMetadata(): DiscMetadata {
  return { title: null, gameId: null, region: null, volumeLabel: null, fileSystem: null, sizeBytes: null, external: null };
}

function playStationMetadata(systemCnf: string): Pick<DiscMetadata, "gameId" | "region"> {
  const match = systemCnf.match(/\b(SLUS|SCUS|SLES|SCES|SLPS|SLPM|SCPS|SCPM)[_.-]?(\d{3})[_.-]?(\d{2})\b/i);
  if (!match) return { gameId: null, region: null };
  const prefix = match[1].toUpperCase();
  const region = /^(SLUS|SCUS)$/.test(prefix) ? "North America" : /^(SLES|SCES)$/.test(prefix) ? "Europe" : "Japan";
  return { gameId: `${prefix}-${match[2]}${match[3]}`, region };
}

async function gatherDiscMetadata(drive: OpticalDrive, systemCnf: string): Promise<DiscMetadata> {
  if (!/^[A-Z]:$/i.test(drive.letter)) return emptyDiscMetadata();
  const driveLetter = drive.letter[0];
  const script = `$volume = Get-Volume -DriveLetter '${driveLetter}' -ErrorAction Stop; [pscustomobject]@{ VolumeLabel = $volume.FileSystemLabel; FileSystem = $volume.FileSystem; Size = [Int64]$volume.Size } | ConvertTo-Json -Compress`;
  const playStation = playStationMetadata(systemCnf);
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true });
    const volume = JSON.parse(stdout) as { VolumeLabel?: string; FileSystem?: string; Size?: number };
    const volumeLabel = volume.VolumeLabel?.trim() || null;
    return { title: volumeLabel, volumeLabel, fileSystem: volume.FileSystem?.trim() || null, sizeBytes: Number.isFinite(volume.Size) ? volume.Size ?? null : null, external: null, ...playStation };
  } catch {
    return { ...emptyDiscMetadata(), ...playStation };
  }
}

async function probeDisc(drive: OpticalDrive): Promise<DiscProbe> {
  if (!drive.mediaLoaded) return { system: null, evidence: "No media reported by the selected drive.", metadata: emptyDiscMetadata() };
  if (!/^[A-Z]:$/i.test(drive.letter)) return { system: null, evidence: "The drive identifier is not valid for probing.", metadata: emptyDiscMetadata() };
  const systemCnfPath = `${drive.letter}\\SYSTEM.CNF`;
  const script = `Get-Content -LiteralPath '${systemCnfPath}' -Raw -ErrorAction Stop`;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true });
    const metadata = await gatherDiscMetadata(drive, stdout);
    if (/BOOT2\s*=|BOOT2\s*:/i.test(stdout)) return { system: await profileFor("PS2"), evidence: "SYSTEM.CNF contains a PlayStation 2 BOOT2 entry.", metadata };
    if (/BOOT\s*=|BOOT\s*:/i.test(stdout)) return { system: await profileFor("PSX"), evidence: "SYSTEM.CNF contains a PlayStation boot entry.", metadata };
    return { system: null, evidence: "SYSTEM.CNF was readable but did not match a supported platform signature.", metadata };
  } catch {
    return { system: null, evidence: "No readable platform signature was found. Select a system manually if known.", metadata: await gatherDiscMetadata(drive, "") };
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

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function isMetadataProvider(value: string): value is MetadataProvider {
  return ["screenscraper", "launchbox", "mobygames", "steamgriddb"].includes(value);
}

function credential(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : undefined;
}

function normalizeCredentials(value: unknown): MetadataCredentials {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    apiKey: credential(source.apiKey),
    username: credential(source.username),
    password: credential(source.password),
    developerId: credential(source.developerId),
    developerPassword: credential(source.developerPassword),
    endpoint: credential(source.endpoint)
  };
}

async function lookupGameMetadata(provider: MetadataProvider, title: string, credentials: MetadataCredentials): Promise<GameMetadataLookup> {
  const query = title.trim().slice(0, 100);
  if (!query) return { provider, configured: true, results: [], message: "Enter a disc title to search." };

  if (provider === "steamgriddb") {
    const apiKey = credentials.apiKey ?? process.env.STEAMGRIDDB_API_KEY;
    if (!apiKey) return { provider, configured: false, results: [], message: "Enter a SteamGridDB API key to search." };
    try {
      const response = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return { provider, configured: true, results: [], message: `SteamGridDB lookup failed (${response.status}).` };
      const body = await response.json() as { data?: Array<{ id: number; name: string }> };
      const results = (body.data ?? []).slice(0, 5).map((game) => ({ provider, id: String(game.id), title: game.name, url: `https://www.steamgriddb.com/game/${game.id}` }));
      return { provider, configured: true, results, message: results.length ? undefined : "No matching games found." };
    } catch {
      return { provider, configured: true, results: [], message: "SteamGridDB could not be reached." };
    }
  }

  if (provider === "screenscraper") {
    const { username, password, developerId, developerPassword } = credentials;
    if (!username || !password || !developerId || !developerPassword) return { provider, configured: false, results: [], message: "Enter ScreenScraper account and developer credentials to search." };
    const endpoint = new URL("https://api.screenscraper.fr/api2/jeuInfos.php");
    endpoint.search = new URLSearchParams({ devid: developerId, devpassword: developerPassword, ssid: username, sspassword: password, softname: "LOAD_AND_PLAY", output: "json", recherche: query }).toString();
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return { provider, configured: true, results: [], message: `ScreenScraper lookup failed (${response.status}).` };
      const body = await response.json() as { response?: { jeu?: { id?: string | number; noms?: Array<{ texte?: string }> } } };
      const game = body.response?.jeu;
      const gameTitle = game?.noms?.find((name) => name.texte?.trim())?.texte?.trim();
      const results = game && gameTitle ? [{ provider, id: String(game.id ?? gameTitle), title: gameTitle, url: null }] : [];
      return { provider, configured: true, results, message: results.length ? undefined : "No matching games found." };
    } catch {
      return { provider, configured: true, results: [], message: "ScreenScraper could not be reached." };
    }
  }

  if (provider === "launchbox") {
    const endpoint = credentials.endpoint ?? process.env.LAUNCHBOX_API_URL;
    const apiKey = credentials.apiKey ?? process.env.LAUNCHBOX_API_KEY;
    if (!endpoint || !apiKey) return { provider, configured: false, results: [], message: "Enter a LaunchBox API URL and API key to search." };
    try {
      const url = new URL(endpoint);
      url.searchParams.set("q", query);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return { provider, configured: true, results: [], message: `LaunchBox lookup failed (${response.status}).` };
      const body = await response.json() as { data?: Array<{ id?: string | number; name?: string; title?: string; url?: string }>; results?: Array<{ id?: string | number; name?: string; title?: string; url?: string }> };
      const entries = body.data ?? body.results ?? [];
      const results = entries.map((game) => ({ provider, id: String(game.id ?? game.name ?? game.title ?? ""), title: game.name ?? game.title ?? "", url: game.url ?? null })).filter((game) => game.id && game.title).slice(0, 5);
      return { provider, configured: true, results, message: results.length ? undefined : "No matching games found." };
    } catch {
      return { provider, configured: true, results: [], message: "LaunchBox could not be reached. Check the API URL." };
    }
  }

  const apiKey = credentials.apiKey ?? process.env.SCRAPERAPI_KEY;
  if (!apiKey) return { provider, configured: false, results: [], message: "Enter a ScraperAPI key to search MobyGames." };

  const targetUrl = `https://www.mobygames.com/search/?q=${encodeURIComponent(query)}`;
  const scraperUrl = new URL("https://api.scraperapi.com/");
  scraperUrl.searchParams.set("api_key", apiKey);
  scraperUrl.searchParams.set("url", targetUrl);

  try {
    const response = await fetch(scraperUrl, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return { provider, configured: true, results: [], message: `MobyGames lookup failed (${response.status}).` };
    const html = await response.text();
    const results = Array.from(html.matchAll(/<a[^>]+href="(\/game\/[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/gi))
      .map((match) => ({ provider, id: match[1], title: decodeHtml(match[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()), url: `https://www.mobygames.com${match[1]}` }))
      .filter((result) => result.title.length > 0)
      .filter((result, index, entries) => entries.findIndex((entry) => entry.url === result.url) === index)
      .slice(0, 5);
    return { provider, configured: true, results, message: results.length ? undefined : "No matching games found." };
  } catch {
    return { provider, configured: true, results: [], message: "MobyGames lookup could not reach ScraperAPI." };
  }
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

interface LibraryRecord {
  title?: string;
  platform?: string;
  completedAt?: string;
  preservation?: { format?: string; imagePath?: string; sha256?: string };
  playCopy?: { imagePath?: string; sha256?: string } | null;
  verification?: { local?: VerificationStatus; verifiedAt?: string; online?: "not-configured" | "pending" };
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

async function findManifests(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return findManifests(entryPath);
    return entry.isFile() && entry.name === "metadata.json" ? [entryPath] : [];
  }));
  return nested.flat();
}

function recordToLibraryItem(manifestPath: string, record: LibraryRecord): LibraryItem | null {
  if (!record.title || !record.platform || !record.preservation?.imagePath) return null;
  return {
    manifestPath,
    title: record.title,
    platform: record.platform,
    capturedAt: record.completedAt ?? null,
    format: record.preservation.format ?? "ISO",
    localStatus: record.verification?.local ?? "unverified",
    onlineStatus: record.verification?.online ?? "not-configured"
  };
}

async function listLibrary(root: string): Promise<LibraryItem[]> {
  try {
    const manifests = await findManifests(root);
    const records = await Promise.all(manifests.map(async (manifestPath) => {
      try {
        return recordToLibraryItem(manifestPath, JSON.parse(await readFile(manifestPath, "utf8")) as LibraryRecord);
      } catch {
        return null;
      }
    }));
    return records.filter((record): record is LibraryItem => record !== null).sort((left, right) => left.title.localeCompare(right.title));
  } catch {
    return [];
  }
}

async function verifyImage(imagePath: string | undefined, expectedHash: string | undefined): Promise<VerificationStatus> {
  if (!imagePath) return "missing";
  if (!expectedHash) return "unverified";
  try {
    return (await sha256(imagePath)).toLowerCase() === expectedHash.toLowerCase() ? "verified" : "mismatch";
  } catch {
    return "missing";
  }
}

async function verifyLibraryItem(root: string, manifestPath: string): Promise<LibraryVerificationResult> {
  const resolvedRoot = path.resolve(root);
  const resolvedManifest = path.resolve(manifestPath);
  if (!resolvedManifest.startsWith(`${resolvedRoot}${path.sep}`) || path.basename(resolvedManifest) !== "metadata.json") throw new Error("The selected record is outside the selected library.");
  const record = JSON.parse(await readFile(resolvedManifest, "utf8")) as LibraryRecord;
  const preservationStatus = await verifyImage(record.preservation?.imagePath, record.preservation?.sha256);
  const playStatus = record.playCopy ? await verifyImage(record.playCopy.imagePath, record.playCopy.sha256) : "verified";
  const status = [preservationStatus, playStatus].includes("mismatch") ? "mismatch" : [preservationStatus, playStatus].includes("missing") ? "missing" : [preservationStatus, playStatus].includes("unverified") ? "unverified" : "verified";
  const verifiedAt = new Date().toISOString();
  record.verification = { local: status, verifiedAt, online: "not-configured" };
  await writeFile(resolvedManifest, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  const message = status === "verified" ? "All recorded images match their SHA-256 checksums." : status === "mismatch" ? "At least one image does not match its recorded SHA-256 checksum." : status === "missing" ? "At least one recorded image could not be found." : "At least one image has no recorded checksum.";
  return { manifestPath: resolvedManifest, status, message, verifiedAt };
}

async function saveLibraryRecord(job: PreservationJob, output: string, playCopy: PlayCopy | null): Promise<void> {
  const paths = capturePathsFor(job);
  const record = {
    schemaVersion: 1,
    title: cleanTitle(job.title),
    platform: job.system?.name ?? "Unknown",
    disc: job.metadata ?? emptyDiscMetadata(),
    preservation: { format: "iso", imagePath: output, sha256: await sha256(output) },
    playCopy,
    verification: { local: "verified", verifiedAt: new Date().toISOString(), online: "not-configured" },
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
  ipcMain.handle("metadata:lookup", (_event, provider: string, title: string, credentials: unknown) => lookupGameMetadata(isMetadataProvider(provider) ? provider : "mobygames", typeof title === "string" ? title : "", normalizeCredentials(credentials)));
  ipcMain.handle("destination:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("library:list", (_event, root: unknown) => typeof root === "string" ? listLibrary(root) : []);
  ipcMain.handle("library:verify", (_event, root: unknown, manifestPath: unknown) => {
    if (typeof root !== "string" || typeof manifestPath !== "string") throw new Error("A library folder and record are required.");
    return verifyLibraryItem(root, manifestPath);
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