# LOAD & PLAY Project Checklist

- [x] Verify that the copilot-instructions.md file in the .github directory is created.
- [x] Clarify Project Requirements - Windows-focused Electron + TypeScript desktop app for personal game-disc preservation, with ISO/CHD/RVZ options and tool discovery.
- [x] Scaffold the Project - Manual Electron + TypeScript scaffold added because Node.js is not installed in the current environment.
- [x] Customize the Project - Added drive scan, utility scan, capture workflow, and preservation UI.
- [x] Install Required Extensions - No extensions specified or required.
- [x] Compile the Project - `npm run build` completed successfully.
- [x] Create and Run Task - Standard package scripts provide build, launch, lint, and package tasks.
- [x] Launch the Project - Electron launched through the `Launch LOAD & PLAY` background task.
- [x] Ensure Documentation is Complete - README documents setup, supported paths, and operational limits.

## Project Notes

- The app invokes imaging tools only after an explicit user action.
- Availability of specific disc and format workflows depends on installed tools and the connected drive.
- Electron security defaults: `contextIsolation: true`, `nodeIntegration: false`.
