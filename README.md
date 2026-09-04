# LOAD & PLAY
Project Leader: Toluwani D. Adeoti

LOAD & PLAY is an open-source Windows desktop utility for making personal archival images from physical game discs. It detects local optical drives, runs an explicitly selected imaging tool, hashes the finished image, and records the capture in a local library manifest.

**Dump once. Preserve the master. Derive playable formats from it.**

## Status

The current prototype supports an ISO extraction workflow with `dd.exe`.

- Detects Windows optical drives with `Win32_CDROMDrive`.
- Reports whether a drive has inserted media.
- Detects compatible tools available on `PATH`.
- Starts an ISO capture only after an explicit user action.
- Prevents concurrent capture jobs.
- Automatically gathers the readable volume label, filesystem, disc size, and PlayStation game ID/region when available.
- Calculates SHA-256 after a successful extraction.
- Creates a `metadata.json` manifest in the organized platform/title library folder.
- Uses Electron context isolation with renderer-side Node access disabled.

For compatible DVD system profiles, `chdman` can create a CHD play copy from the ISO master. For selected GameCube and Wii profiles, `dolphin-tool` can create an RVZ play copy. CD-based CHD conversion remains planned because preservation-quality CD support requires a BIN/CUE master rather than the current ISO workflow.

## How To Use

### Windows

1. Install Node.js 20 or later and reopen your terminal.
2. From the project root, install dependencies:

   ```powershell
   npm install
   ```

3. Install a Windows-compatible `dd.exe` and ensure it is available on `PATH`.
4. Launch the application:

   ```powershell
   npm start
   ```

5. Insert a disc and select the detected drive. LOAD & PLAY gathers readable local metadata and prefills an untouched title from the disc label.
6. Review the detected system and title. Select a metadata provider, enter its credentials in the app, and choose **Find game metadata** to search.
7. Select `ISO`, choose a destination, and start the capture.

The app creates an ISO preservation master. For a compatible DVD profile, selecting `CHD` also creates a play copy with `chdman`. For a GameCube or Wii profile, selecting `RVZ` creates a play copy with `dolphin-tool`.

## Metadata Providers

LOAD & PLAY always gathers local, readable disc data first. External lookups are optional and only enrich the title after you select a matching result. Credentials entered in the app are used for the current lookup only and are never written to manifests, logs, or project files.

| Provider | Status | Configuration |
| --- | --- | --- |
| ScreenScraper | Available with account and developer credentials | Account username/password and developer ID/password |
| LaunchBox | Available with a configured API endpoint | API URL and API key |
| MobyGames | Available through ScraperAPI | ScraperAPI key |
| SteamGridDB | Available | SteamGridDB API key |

For unattended development, MobyGames and SteamGridDB can also read `SCRAPERAPI_KEY` and `STEAMGRIDDB_API_KEY` from the environment when the app form is left blank.

When a result is selected, its provider, external ID, title, and source URL are saved in `metadata.json` alongside the local disc metadata.

### macOS

macOS is not supported by the current capture implementation. The drive scanner uses Windows `Win32_CDROMDrive` and the capture command expects `dd.exe`, so the application cannot discover or image optical drives on macOS yet.

You may install Node.js 20+ and run `npm install` to work on the interface or shared metadata, but do not use the current build for disc extraction. Native macOS drive discovery and a safe raw-device capture backend are planned work.

### Linux

Linux is not supported by the current capture implementation. The drive scanner uses Windows `Win32_CDROMDrive` and the capture command expects `dd.exe`, so the application cannot discover or image optical drives on Linux yet.

You may install Node.js 20+ and run `npm install` to work on the interface or shared metadata, but do not use the current build for disc extraction. Linux drive discovery and a safe raw-device capture backend are planned work.

## Output

A successful ISO capture produces an image and a manifest in the selected destination.

```text
Library/
   Sony PlayStation 2/
      My Game/
         preservation/
            My Game.iso
         play/
            My Game.chd
         metadata.json
```

`metadata.json` records the sanitized title, selected platform, readable disc metadata, preservation-master path and SHA-256 checksum, source-drive name, completion time, and any optional play copy. Metadata that cannot be read from the disc remains `null`; the app does not invent missing values.

## Format Strategy

LOAD & PLAY treats the first image as a preservation master. Derived formats should be created from that known-good image, never from another lossy or transformed copy.

| Platform or media | Preservation master | Planned play copy |
| --- | --- | --- |
| PlayStation, Saturn, Sega CD, PC Engine CD, Neo Geo CD | BIN/CUE | CHD |
| PlayStation 2 CD | BIN/CUE | CHD |
| PlayStation 2 DVD, PC DVD | ISO | CHD or ISO |
| GameCube, Wii | ISO | RVZ |
| Dreamcast GD-ROM | Specialized dump | CHD |
| Xbox, Xbox 360 | Specialized dump | Platform-specific ISO |

The `systems/` directory contains metadata and recognized file formats for the current console catalog.

## Tooling

| Tool | Current role |
| --- | --- |
| `dd.exe` | Current ISO extraction workflow |
| `chdman.exe` | DVD ISO to CHD conversion; CD support is planned |
| `dolphin-tool.exe` | GameCube/Wii ISO to RVZ conversion |
| `DiscImageCreator.exe` | Detected for future specialized optical workflows |
| Redumper | Planned preservation-grade CD/DVD dumping backend |

Tool detection is not a promise that a particular drive can read a given disc. The application should report unsupported media or hardware rather than create an unverified image.

## Hardware And Legal Limits

Use LOAD & PLAY only to archive media you are legally entitled to preserve. Do not commit game images or other copyrighted game content to this repository.

### Anti-Piracy Notice

LOAD & PLAY is intended only for personal preservation of games and discs you legally own. It must not be used to download, distribute, share, sell, or otherwise facilitate access to unauthorized copies of copyrighted games or disc images. The project does not endorse or support piracy, circumvention of copy protection, or use with media you are not legally entitled to preserve.

Consumer optical drives cannot necessarily read every game-disc format. GameCube and Wii media require specialized workflows, Dreamcast GD-ROMs require compatible dumping hardware, and Xbox/Xbox 360 discs may require specific compatible drives and tools. LOAD & PLAY does not bypass copy protection or claim to create verified images from unsupported hardware.

## Development Commands

```powershell
npm start
npm run typecheck
npm run lint
npm run make
```

`npm start` builds and launches the app. `npm run make` builds a portable Windows package.

## Roadmap

1. Add BIN/CUE masters and CHD conversion with verification.
2. Add ISO to RVZ conversion for compatible GameCube and Wii imports.
3. Add platform detection, disc metadata, and structured library organization.
4. Add specialized dumping backends and emulator discovery.