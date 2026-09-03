# LOAD & PLAY

LOAD & PLAY is a Windows desktop utility for creating personal archival images from optical game discs. It scans locally connected optical drives and starts an image operation only after you explicitly select the drive, format, destination, and capture command.

## Current capabilities

- Detects Windows optical drives with `Win32_CDROMDrive`.
- Shows whether compatible command-line utilities are available on `PATH`.
- Creates an ISO through `dd` when the selected drive and a compatible `dd.exe` are available.
- Rejects concurrent captures and refuses to start from a drive that does not report inserted media.
- Calculates a SHA-256 checksum after a successful ISO extraction and writes a `<title>.iso.loadplay.json` library record next to the image.
- Provides format choices for ISO, CHD, and RVZ. CHD/RVZ conversion is intentionally held until a compatible source-image workflow is configured; the UI reports this instead of making an unsupported conversion claim.
- Runs Electron with context isolation and no renderer-side Node access.

## Setup

1. Install Node.js 20 or later, then reopen the terminal so `node` and `npm` are on `PATH`.
2. Run `npm install` from the project root.
3. Install an imaging utility and add it to `PATH`:
   - `dd.exe` for the current ISO workflow.
   - `chdman.exe` for a planned CHD conversion workflow.
   - `dolphin-tool.exe` for compatible RVZ conversion.
   - `DiscImageCreator.exe` is detected for specialized optical preservation workflows.
4. Run `npm start`.

## Important limits

Use this only with media you are legally entitled to archive. A consumer optical drive cannot necessarily read every disc format, enforce a specific image format, or bypass protection. The application exposes installed local tools and reports unavailable workflows rather than claiming it can preserve unsupported media.

## Commands

- `npm start` builds and launches the app.
- `npm run typecheck` checks TypeScript without generating files.
- `npm run lint` runs the type check.
- `npm run make` builds a portable Windows package.Core idea
             LOAD & PLAY
                  │
          ┌───────▼────────┐
          │ Disc inserted  │
          └───────┬────────┘
                  │
          ┌───────▼────────┐
          │ Identify disc  │
          │ + game system  │
          └───────┬────────┘
                  │
          ┌───────▼────────┐
          │ Preservation   │
          │ dump           │
          └───────┬────────┘
                  │
        ┌─────────▼─────────┐
        │ Verify / Hash     │
        │ CRC32 MD5 SHA-1   │
        └─────────┬─────────┘
                  │
      ┌───────────▼───────────┐
      │ Platform converter    │
      └───────────┬───────────┘
                  │
    ┌─────────────┼─────────────┐
    ▼             ▼             ▼
   ISO           CHD           RVZ
    │             │             │
    └─────────────┼─────────────┘
                  ▼
          Game Library
                  │
                  ▼
              ▶ PLAY

I would make one principle absolutely central:

Dump once. Preserve the master. Derive everything else from it.

For CD systems, tools like redumper can produce preservation-quality BIN/CUE dumps, including low-level CD handling and error repair. Current redumper also supports DVD, HD-DVD, and Blu-ray media, although some platforms require specialized hardware.

Then LOAD & PLAY becomes the conductor rather than trying to reinvent the optical-disc orchestra.

Format strategy

Platform / media |	Preservation master |	LOAD & PLAY copy
-----------------|----------------------|--------------------
PlayStation	| BIN/CUE |	CHD
Sega Saturn	| BIN/CUE |	CHD
Sega CD	| BIN/CUE |	CHD
PC Engine CD	| BIN/CUE |	CHD
Neo Geo CD	| BIN/CUE |	CHD
PlayStation 2 CD	| BIN/CUE |	CHD
PlayStation 2 DVD	| ISO |	CHD or ISO
PC CD-ROM	| BIN/CUE or ISO |	ISO / CHD
PC DVD-ROM	| ISO |	ISO / CHD
GameCube	| ISO |	RVZ
Wii	| ISO |	RVZ
Dreamcast GD-ROM	| specialized dump |	CHD
Xbox/Xbox 360	| specialized dump |	ISO/CHD depending workflow

`chdman` is ideal for the CHD side because it officially supports creating and verifying CD-ROM and DVD-ROM CHDs, as well as extracting them again.

For GameCube and Wii, RVZ is exactly the kind of format LOAD & PLAY should target. Dolphin describes RVZ as lossless and designed to retain the complete disc data while giving strong compression. Dolphin's command-line dolphin-tool can convert ISO → RVZ and verify the resulting image.

For example, internally LOAD & PLAY could execute:
```bash
dolphin-tool convert \
    -i "Super Mario Galaxy.iso" \
    -o "Super Mario Galaxy.rvz" \
    -f rvz \
    -b 131072 \
    -c zstd \
    -l 5
```

Those block size, compression method, and compression-level values are Dolphin's current suggested RVZ settings.

Automatic platform detection

This is the part I'd make particularly fun.

LOAD & PLAY doesn't just see:

`D:\`

It runs a series of detectors.

```
DiscProbe
 ├── MediaDetector
 │    ├── CD
 │    ├── DVD
 │    └── BD
 │
 └── PlatformDetector
      ├── PlayStationDetector
      ├── PlayStation2Detector
      ├── SaturnDetector
      ├── SegaCDDetector
      ├── DreamcastDetector
      ├── GameCubeDetector
      ├── WiiDetector
      ├── XboxDetector
      └── PCDetector
```
For example:
```python
class PlatformDetector:
    name = "Unknown"

    def detect(self, disc) -> bool:
        raise NotImplementedError
```

Then:
```python
class PlayStation2Detector(PlatformDetector):
    name = "PlayStation 2"

    def detect(self, disc) -> bool:
        system_cnf = disc.read_text("SYSTEM.CNF")

        if not system_cnf:
            return False

        return "BOOT2" in system_cnf.upper()
```

GameCube/Wii detection can use their disc-header identifiers. Saturn and Sega CD have recognizable signatures. If nothing matches, it can fall back to:

Platform: PC / Unknown
Media: DVD-ROM
Filesystem: UDF

instead of guessing.

Plugin architecture

This is where LOAD & PLAY could become seriously powerful.
```
loadplay/
├── core/
│   ├── drive.py
│   ├── disc.py
│   ├── detect.py
│   ├── dump.py
│   ├── verify.py
│   └── library.py
│
├── platforms/
│   ├── ps1.py
│   ├── ps2.py
│   ├── gamecube.py
│   ├── wii.py
│   ├── saturn.py
│   ├── dreamcast.py
│   └── pc.py
│
├── dumpers/
│   ├── redumper.py
│   ├── discimagecreator.py
│   └── generic.py
│
├── converters/
│   ├── chd.py
│   ├── rvz.py
│   └── iso.py
│
├── launchers/
│   ├── retroarch.py
│   ├── duckstation.py
│   ├── pcsx2.py
│   ├── dolphin.py
│   └── flycast.py
│
└── cli.py
```
Each platform defines its own recipe:
```python
class PlayStation:
    name = "Sony PlayStation"

    dump_format = "bin_cue"
    play_format = "chd"

    dumper = "redumper"
    converter = "chdman"
```
while GameCube says:
```python
class GameCube:
    name = "Nintendo GameCube"

    dump_format = "iso"
    play_format = "rvz"

    converter = "dolphin-tool"

```
class GameCube:
    name = "Nintendo GameCube"

    dump_format = "iso"
    play_format = "rvz"

    converter = "dolphin-tool"
```python

That means adding another console later doesn't require mangling the core application. You drop another cartridge into the software jukebox.

What using it should feel like

I wouldn't make the user learn any of those tools.

They install LOAD & PLAY and run:

loadplay

Then:

LOAD & PLAY v0.1

Waiting for a game disc...

──────────────────────────────────────

💿 Disc detected

Game:
Sonic Mega Collection

Platform:
Nintendo GameCube

Disc:
1 / 1

Region:
USA

Game ID:
GSOE8P

──────────────────────────────────────

Creating preservation image...

████████████████░░░░  78%

1.08 GB / 1.36 GB

──────────────────────────────────────

✓ ISO created
✓ SHA-1 calculated
✓ Dump verified

Creating RVZ...

████████████████████ 100%

ISO:  1.36 GB
RVZ:  843 MB

✓ Preservation complete

[ PLAY ]   [ OPEN LIBRARY ]   [ EJECT ]

That's the identity of LOAD & PLAY.

Not:

"Here's a GUI for chdman."

But:

Put game in drive. Get preserved game out.

Every dump should also get a manifest

For example:

{
    "loadplay_version": "0.1.0",
    "title": "Sonic Mega Collection",
    "platform": "Nintendo GameCube",
    "region": "USA",
    "game_id": "GSOE8P",

    "media": {
        "type": "DVD",
        "size": 1459978240
    },

    "preservation": {
        "format": "ISO",
        "filename": "Sonic Mega Collection.iso",
        "sha1": "...",
        "md5": "...",
        "verified": true
    },

    "play_copy": {
        "format": "RVZ",
        "filename": "Sonic Mega Collection.rvz",
        "lossless": true
    },

    "drive": {
        "vendor": "LG",
        "model": "..."
    }
}

So a preserved game could live as:

Library/
└── Nintendo GameCube/
    └── Sonic Mega Collection/
        ├── preservation/
        │   └── Sonic Mega Collection.iso
        │
        ├── play/
        │   └── Sonic Mega Collection.rvz
        │
        ├── metadata.json
        └── dump.log
Don't put the game images in GitHub

The GitHub repository should contain LOAD & PLAY itself, not copyrighted game images.

Something like:

LOAD-AND-PLAY/
├── README.md
├── LICENSE
├── pyproject.toml
├── loadplay/
├── tests/
├── docs/
├── schemas/
├── scripts/
└── .github/
    └── workflows/

And .gitignore should aggressively exclude:

*.iso
*.bin
*.cue
*.chd
*.rvz
*.gcm
*.wia
*.gcz
*.wbfs

library/
dumps/
preservation/

That also makes the project's purpose clear: a tool for making and managing backups from discs you possess, not a repository for distributing commercial game dumps.

One important hardware reality

We shouldn't promise:

"Every game disc works in every PC drive."

Some systems are peculiar beasts.

redumper notes that Xbox/Xbox 360 XGD discs require specific Kreon-firmware DVD drives, while CD preservation can also benefit significantly from particular compatible optical drives.

GameCube/Wii dumping also deserves a specialized backend rather than assuming every ordinary PC DVD drive can handle those discs. Dolphin itself currently recommends dumping owned discs using compatible Wii hardware and tools such as CleanRip.

So LOAD & PLAY should report:

Nintendo Wii disc detected.

⚠ This drive cannot create a verified Wii dump.

Supported options:
• Compatible optical drive
• Dump using Wii hardware
• Import an existing ISO

rather than producing a suspiciously cheerful broken file. 😄

Version 0.1 scope

I would deliberately not try to support 30 consoles immediately.

The killer first release would be:

LOAD & PLAY 0.1

✓ Windows
✓ Linux

✓ Detect optical drives
✓ Detect inserted/ejected discs

✓ PC CD/DVD
✓ PlayStation
✓ PlayStation 2

✓ redumper integration
✓ ISO
✓ BIN/CUE
✓ CHD

✓ SHA-1 / MD5 / CRC32
✓ metadata.json
✓ preservation logs

✓ automatic library organization

Then:

0.2
GameCube + Wii
ISO → RVZ
Dolphin launcher
0.3
Saturn
Sega CD
Dreamcast
0.4
Automatic emulator discovery
PLAY button
cover-art metadata
library GUI

And eventually the very satisfying final experience becomes:

                LOAD & PLAY

          INSERT YOUR ORIGINAL DISC
                     ↓
             We identify it.
                     ↓
              We preserve it.
                     ↓
               We verify it.
                     ↓
             We compress it.
                     ↓
                ▶ PLAY

Python is an excellent language for the first version, especially because LOAD & PLAY is primarily an orchestration layer around mature preservation utilities. The difficult low-level optical-disc work can remain in projects such as redumper, DiscImageCreator, chdman, and DolphinTool, while our Python code handles detection, recipes, verification, metadata, automation, and eventually the UI. Redumper is already cross-platform and automates much of its own dumping process, which fits this architecture particularly well.

And I'd make the GitHub description something crisp like:

LOAD & PLAY is an open-source game-disc preservation manager that automatically identifies physical game media, creates verified archival images, converts them to platform-appropriate lossless formats, and prepares them for play.

This has the bones of a genuinely useful preservation project, not just another disc-ripping script. 🎮💿