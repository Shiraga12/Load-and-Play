# LOAD & PLAY

LOAD & PLAY is an open-source Windows desktop utility for making personal archival images from physical game discs. It detects local optical drives, runs an explicitly selected imaging tool, hashes the finished image, and records the capture in a local library manifest.

**Dump once. Preserve the master. Derive playable formats from it.**

## Status

The current prototype supports an ISO extraction workflow with `dd.exe`.

- Detects Windows optical drives with `Win32_CDROMDrive`.
- Reports whether a drive has inserted media.
- Detects compatible tools available on `PATH`.
- Starts an ISO capture only after an explicit user action.
- Prevents concurrent capture jobs.
- Calculates SHA-256 after a successful extraction.
- Creates a `<title>.iso.loadplay.json` sidecar manifest next to the image.
- Uses Electron context isolation with renderer-side Node access disabled.

For compatible DVD system profiles, `chdman` can create a CHD play copy from the ISO master. For selected GameCube and Wii profiles, `dolphin-tool` can create an RVZ play copy. CD-based CHD conversion remains planned because preservation-quality CD support requires a BIN/CUE master rather than the current ISO workflow.

## Quick Start

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

5. Insert a disc, select the detected drive, enter a title, select `ISO`, choose a destination, and start the capture.

## Output

A successful ISO capture produces an image and a manifest in the selected destination.

```text
Library/
  My Game.iso
  My Game.iso.loadplay.json
```

The manifest records the sanitized title, output format and path, SHA-256 checksum, source-drive name, and completion time.

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