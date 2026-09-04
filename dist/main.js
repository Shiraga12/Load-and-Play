"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_util_1 = require("node:util");
const node_path_1 = __importDefault(require("node:path"));
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
let mainWindow = null;
let captureInProgress = false;
let systemProfiles = null;
function cleanTitle(value) {
    return value.replace(/[^a-zA-Z0-9._ -]/g, "").trim().slice(0, 100) || "untitled-disc";
}
async function locate(executable) {
    try {
        await execFileAsync("where.exe", [executable], { windowsHide: true });
        return true;
    }
    catch {
        return false;
    }
}
async function scanDrives() {
    const script = "Get-CimInstance Win32_CDROMDrive | Select-Object DeviceID,Name,MediaLoaded | ConvertTo-Json -Compress";
    try {
        const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true });
        if (!stdout.trim())
            return [];
        const data = JSON.parse(stdout);
        return (Array.isArray(data) ? data : [data]).map((drive) => ({
            id: drive.DeviceID,
            letter: drive.DeviceID.replace("\\\\.\\", ""),
            name: drive.Name,
            mediaLoaded: Boolean(drive.MediaLoaded)
        }));
    }
    catch {
        return [];
    }
}
async function loadSystemProfiles() {
    if (systemProfiles)
        return systemProfiles;
    const directory = node_path_1.default.join(electron_1.app.getAppPath(), "systems");
    const files = (await (0, promises_1.readdir)(directory)).filter((file) => file.endsWith(".json"));
    const profiles = await Promise.all(files.map(async (file) => JSON.parse(await (0, promises_1.readFile)(node_path_1.default.join(directory, file), "utf8"))));
    systemProfiles = profiles;
    return profiles;
}
async function profileFor(shortName) {
    return (await loadSystemProfiles()).find((profile) => profile.shortName.toLowerCase() === shortName.toLowerCase()) ?? null;
}
function emptyDiscMetadata() {
    return { title: null, gameId: null, region: null, volumeLabel: null, fileSystem: null, sizeBytes: null, external: null };
}
function playStationMetadata(systemCnf) {
    const match = systemCnf.match(/\b(SLUS|SCUS|SLES|SCES|SLPS|SLPM|SCPS|SCPM)[_.-]?(\d{3})[_.-]?(\d{2})\b/i);
    if (!match)
        return { gameId: null, region: null };
    const prefix = match[1].toUpperCase();
    const region = /^(SLUS|SCUS)$/.test(prefix) ? "North America" : /^(SLES|SCES)$/.test(prefix) ? "Europe" : "Japan";
    return { gameId: `${prefix}-${match[2]}${match[3]}`, region };
}
async function gatherDiscMetadata(drive, systemCnf) {
    if (!/^[A-Z]:$/i.test(drive.letter))
        return emptyDiscMetadata();
    const driveLetter = drive.letter[0];
    const script = `$volume = Get-Volume -DriveLetter '${driveLetter}' -ErrorAction Stop; [pscustomobject]@{ VolumeLabel = $volume.FileSystemLabel; FileSystem = $volume.FileSystem; Size = [Int64]$volume.Size } | ConvertTo-Json -Compress`;
    const playStation = playStationMetadata(systemCnf);
    try {
        const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true });
        const volume = JSON.parse(stdout);
        const volumeLabel = volume.VolumeLabel?.trim() || null;
        return { title: volumeLabel, volumeLabel, fileSystem: volume.FileSystem?.trim() || null, sizeBytes: Number.isFinite(volume.Size) ? volume.Size ?? null : null, external: null, ...playStation };
    }
    catch {
        return { ...emptyDiscMetadata(), ...playStation };
    }
}
async function probeDisc(drive) {
    if (!drive.mediaLoaded)
        return { system: null, evidence: "No media reported by the selected drive.", metadata: emptyDiscMetadata() };
    if (!/^[A-Z]:$/i.test(drive.letter))
        return { system: null, evidence: "The drive identifier is not valid for probing.", metadata: emptyDiscMetadata() };
    const systemCnfPath = `${drive.letter}\\SYSTEM.CNF`;
    const script = `Get-Content -LiteralPath '${systemCnfPath}' -Raw -ErrorAction Stop`;
    try {
        const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true });
        const metadata = await gatherDiscMetadata(drive, stdout);
        if (/BOOT2\s*=|BOOT2\s*:/i.test(stdout))
            return { system: await profileFor("PS2"), evidence: "SYSTEM.CNF contains a PlayStation 2 BOOT2 entry.", metadata };
        if (/BOOT\s*=|BOOT\s*:/i.test(stdout))
            return { system: await profileFor("PSX"), evidence: "SYSTEM.CNF contains a PlayStation boot entry.", metadata };
        return { system: null, evidence: "SYSTEM.CNF was readable but did not match a supported platform signature.", metadata };
    }
    catch {
        return { system: null, evidence: "No readable platform signature was found. Select a system manually if known.", metadata: await gatherDiscMetadata(drive, "") };
    }
}
async function scanTools() {
    const tools = [
        { name: "dd", purpose: "Creates a raw ISO image" },
        { name: "chdman", purpose: "Packages a disc image as CHD" },
        { name: "dolphin-tool", purpose: "Converts compatible images to RVZ" },
        { name: "DiscImageCreator", purpose: "Specialized optical-drive preservation" }
    ];
    return Promise.all(tools.map(async (tool) => ({ ...tool, available: await locate(`${tool.name}.exe`) || await locate(tool.name) })));
}
function decodeHtml(value) {
    return value.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function isMetadataProvider(value) {
    return ["screenscraper", "launchbox", "mobygames", "steamgriddb"].includes(value);
}
async function lookupGameMetadata(provider, title) {
    const query = title.trim().slice(0, 100);
    if (!query)
        return { provider, configured: true, results: [], message: "Enter a disc title to search." };
    if (provider === "steamgriddb") {
        const apiKey = process.env.STEAMGRIDDB_API_KEY;
        if (!apiKey)
            return { provider, configured: false, results: [], message: "Set STEAMGRIDDB_API_KEY to search SteamGridDB." };
        try {
            const response = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
            if (!response.ok)
                return { provider, configured: true, results: [], message: `SteamGridDB lookup failed (${response.status}).` };
            const body = await response.json();
            const results = (body.data ?? []).slice(0, 5).map((game) => ({ provider, id: String(game.id), title: game.name, url: `https://www.steamgriddb.com/game/${game.id}` }));
            return { provider, configured: true, results, message: results.length ? undefined : "No matching games found." };
        }
        catch {
            return { provider, configured: true, results: [], message: "SteamGridDB could not be reached." };
        }
    }
    if (provider === "screenscraper")
        return { provider, configured: false, results: [], message: "ScreenScraper needs its account and developer credentials configured before lookup can run." };
    if (provider === "launchbox")
        return { provider, configured: false, results: [], message: "LaunchBox needs its API endpoint and credentials configured before lookup can run." };
    const apiKey = process.env.SCRAPERAPI_KEY;
    if (!apiKey)
        return { provider, configured: false, results: [], message: "Set SCRAPERAPI_KEY to search MobyGames." };
    const targetUrl = `https://www.mobygames.com/search/?q=${encodeURIComponent(query)}`;
    const scraperUrl = new URL("https://api.scraperapi.com/");
    scraperUrl.searchParams.set("api_key", apiKey);
    scraperUrl.searchParams.set("url", targetUrl);
    try {
        const response = await fetch(scraperUrl, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(15_000) });
        if (!response.ok)
            return { provider, configured: true, results: [], message: `MobyGames lookup failed (${response.status}).` };
        const html = await response.text();
        const results = Array.from(html.matchAll(/<a[^>]+href="(\/game\/[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/gi))
            .map((match) => ({ provider, id: match[1], title: decodeHtml(match[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()), url: `https://www.mobygames.com${match[1]}` }))
            .filter((result) => result.title.length > 0)
            .filter((result, index, entries) => entries.findIndex((entry) => entry.url === result.url) === index)
            .slice(0, 5);
        return { provider, configured: true, results, message: results.length ? undefined : "No matching games found." };
    }
    catch {
        return { provider, configured: true, results: [], message: "MobyGames lookup could not reach ScraperAPI." };
    }
}
function capturePathsFor(job) {
    const platform = cleanTitle(job.system?.name ?? "Unknown");
    const title = cleanTitle(job.title);
    const root = node_path_1.default.join(job.destination, platform, title);
    return { root, master: node_path_1.default.join(root, "preservation", `${title}.iso`), play: node_path_1.default.join(root, "play"), manifest: node_path_1.default.join(root, "metadata.json") };
}
function commandFor(job) {
    const output = capturePathsFor(job).master;
    return { command: "dd", args: [`if=\\\\.\\${job.drive.letter}:`, `of=${output}`, "bs=4M", "status=progress"], output };
}
async function runTool(command, args, label) {
    mainWindow?.webContents.send("job:output", `${label}...`);
    await new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)(command, args, { windowsHide: true });
        child.stdout.on("data", (chunk) => mainWindow?.webContents.send("job:output", chunk.toString()));
        child.stderr.on("data", (chunk) => mainWindow?.webContents.send("job:output", chunk.toString()));
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)));
    });
}
async function createPlayCopy(job, master) {
    if (job.format === "iso")
        return null;
    const paths = capturePathsFor(job);
    const title = cleanTitle(job.title);
    const allowedFormats = job.system?.fileFormats ?? [];
    if (!allowedFormats.includes(`.${job.format}`))
        throw new Error(`${job.format.toUpperCase()} is not supported by the selected system profile.`);
    await (0, promises_1.mkdir)(paths.play, { recursive: true });
    if (job.format === "chd") {
        if (!job.system?.media.some((medium) => /DVD/i.test(medium)))
            throw new Error("CHD conversion from the current ISO master is limited to DVD-based system profiles. CD systems require a BIN/CUE master workflow.");
        if (!(await locate("chdman.exe")) && !(await locate("chdman")))
            throw new Error("Could not find chdman on PATH.");
        const output = node_path_1.default.join(paths.play, `${title}.chd`);
        await runTool("chdman", ["createdvd", "-i", master, "-o", output], "Creating CHD play copy");
        return { format: "chd", imagePath: output, sha256: await sha256(output) };
    }
    if (!job.system || !["gamecube", "wii"].includes(job.system.shortName.toLowerCase()))
        throw new Error("RVZ conversion is limited to GameCube and Wii system profiles.");
    if (!(await locate("dolphin-tool.exe")) && !(await locate("dolphin-tool")))
        throw new Error("Could not find dolphin-tool on PATH.");
    const output = node_path_1.default.join(paths.play, `${title}.rvz`);
    await runTool("dolphin-tool", ["convert", "-i", master, "-o", output, "-f", "rvz", "-b", "131072", "-c", "zstd", "-l", "5"], "Creating RVZ play copy");
    return { format: "rvz", imagePath: output, sha256: await sha256(output) };
}
async function sha256(filePath) {
    const hash = (0, node_crypto_1.createHash)("sha256");
    for await (const chunk of (0, node_fs_1.createReadStream)(filePath))
        hash.update(chunk);
    return hash.digest("hex");
}
async function saveLibraryRecord(job, output, playCopy) {
    const paths = capturePathsFor(job);
    const record = {
        schemaVersion: 1,
        title: cleanTitle(job.title),
        platform: job.system?.name ?? "Unknown",
        disc: job.metadata ?? emptyDiscMetadata(),
        preservation: { format: "iso", imagePath: output, sha256: await sha256(output) },
        playCopy,
        sourceDrive: job.drive.name,
        completedAt: new Date().toISOString()
    };
    await (0, promises_1.mkdir)(paths.root, { recursive: true });
    await (0, promises_1.writeFile)(paths.manifest, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    mainWindow?.webContents.send("job:output", `SHA-256: ${record.preservation.sha256}`);
    mainWindow?.webContents.send("job:output", `Library record: ${paths.manifest}`);
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1180,
        height: 760,
        minWidth: 860,
        minHeight: 620,
        backgroundColor: "#f3f1e8",
        webPreferences: { preload: node_path_1.default.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    mainWindow.loadFile(node_path_1.default.join(__dirname, "../src/renderer/index.html"));
}
electron_1.app.whenReady().then(() => {
    electron_1.ipcMain.handle("drives:scan", scanDrives);
    electron_1.ipcMain.handle("systems:list", loadSystemProfiles);
    electron_1.ipcMain.handle("disc:probe", (_event, drive) => probeDisc(drive));
    electron_1.ipcMain.handle("tools:scan", scanTools);
    electron_1.ipcMain.handle("metadata:lookup", (_event, provider, title) => lookupGameMetadata(isMetadataProvider(provider) ? provider : "mobygames", typeof title === "string" ? title : ""));
    electron_1.ipcMain.handle("destination:choose", async () => {
        const result = await electron_1.dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
        return result.canceled ? null : result.filePaths[0];
    });
    electron_1.ipcMain.handle("job:start", async (_event, job) => {
        if (captureInProgress)
            return { started: false, message: "A capture is already running." };
        if (!job.drive.mediaLoaded)
            return { started: false, message: "The selected drive does not report inserted media." };
        const command = commandFor(job);
        if (!command)
            return { started: false, message: `${job.format.toUpperCase()} requires a configured compatible imaging workflow. ISO with dd is currently supported.` };
        if (!(await locate(command.command)))
            return { started: false, message: `Could not find ${command.command} on PATH.` };
        await (0, promises_1.mkdir)(node_path_1.default.dirname(command.output), { recursive: true });
        captureInProgress = true;
        const child = (0, node_child_process_1.spawn)(command.command, command.args, { windowsHide: true });
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
            }
            catch (error) {
                mainWindow?.webContents.send("job:output", `Image created, but library finalization failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            finally {
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
    electron_1.app.on("activate", () => { if (electron_1.BrowserWindow.getAllWindows().length === 0)
        createWindow(); });
});
electron_1.app.on("window-all-closed", () => { if (process.platform !== "darwin")
    electron_1.app.quit(); });
