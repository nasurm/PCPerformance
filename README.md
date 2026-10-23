# PC Radar

A Windows-only, local PC and game requirements dashboard. No npm packages or account keys are needed. Node.js 20+ and Windows PowerShell 5.1 are required. The launcher uses Node on PATH or the bundled Codex runtime on this computer.

## Start

Double-click **Start Radar.cmd**. It starts the server in the background and opens http://127.0.0.1:3030. Run it as your regular Windows user; administrator privileges should not be necessary. Reopening the launcher reuses the running server. To stop, run `powershell -NoProfile -ExecutionPolicy Bypass -File .\Stop-Radar.ps1`.

Alternatively run `node server.js` and open the address above. Ctrl+C stops a foreground server. `PORT` can change the port for this manual startup; the double-click launcher uses 3030.

## Features and coverage

- Detect CPU, cores/threads, GPU/driver, NVIDIA dedicated VRAM when available, RAM modules, motherboard/BIOS, Windows, desktop display mode and storage.
- Discover Steam libraries from registry and library manifests, Epic manifests, GOG registry, recognized EA/Ubisoft/Blizzard/Riot uninstall records, and XboxGames configs on fixed drives. Files are read only. Missing/protected records and portable installs may need an extra library root or manual entry.
- Per-game publisher requirements from the public Steam store endpoint, cached locally for seven days with source and retrieval date. An offline cache is clearly identified. Non-Steam titles are matched by exact normalized store names and a small verified ID map; the matched title and source are visible in each report. You can correct a match by app ID.
- Fortnite, Rocket League, Fall Guys and Yolo.ex include dated publisher requirement snapshots with source links. These bundled snapshots are not automatically refreshed. Unsupported games can use manually pasted publisher requirements, labeled user-provided. Missing facts stay unassessed rather than receiving fabricated results.
- Direct Above / Meets / Below with explanations for incomplete evidence results for GPU, CPU and RAM. Choose minimum or recommended requirements (default: recommended). Missing recommended entries fall back to minimum and are marked †.
- Upgrade suggestions appear only for parts below the selected requirement. Meeting any recognized publisher alternative counts as a pass. Explicit VRAM shortages are included in the GPU result.
- Hardware and storage remain visible alongside the game table. Explore additional Steam titles, search/filter, select a GPU on multi-GPU machines, or open the full hardware inventory.

## Honest limits

This is a requirements estimator, not an FPS predictor. CPU and GPU evidence comes from automatically refreshed public PassMark tables. CPU single-thread and multicore results must agree; mixed evidence remains inconclusive. RAM and VRAM compare detected capacities. Storage checks use the actual installation drive. Graphics features, OS compatibility, drivers, and actual game performance are not established by a benchmark score.

PSU, case clearance, cooling and most sensor temperatures cannot be read reliably. Retail upgrade compatibility and budget cannot be established automatically. Suggested components in reports are the publisher’s reference hardware, not verified shopping recommendations.

The app does not launch games, run stress tests, install software or alter drivers. The redesigned interface removes FPS targets and benchmark-entry forms; any previously saved browser records are preserved.

## Privacy and storage

The server binds to loopback, validates Host/Origin, blocks cross-site fetches, uses a per-session token for writes and serves an explicit static-file allowlist. Game titles and numeric app IDs are requested from Steam. Hardware and paths stay local. `data/` contains requirement caches, library settings and the launcher PID; it is ignored by Git. Browser localStorage stores linked Steam IDs, display targets, manual requirements and user-entered measurements.

## Checks

Run `node --test tests/analysis.test.js` for requirement parser/comparison and local HTTP safety checks. Browser flows can be exercised at the local address. If CIM access is blocked by a sandbox, launch the server as your normal user outside that sandbox. The dashboard reports detection failures.


## Automatically retrieved comparisons

The server retrieves PassMark CPU lists (Intel, AMD, other), the CPU single-thread chart, and the GPU list. It parses model names and scores into `data/benchmarks.json`, refreshes after seven days, and retains the last successful snapshot if the service is unavailable. A source-format failure never replaces a valid cache. No PC-specific model scores are embedded in the analysis code. The Method dialog shows coverage and refresh date; each model comparison links its benchmark source.

CPU comparisons require both single-thread and multicore results to agree; mixed results remain inconclusive and do not generate upgrade advice. GPU scores estimate relative performance, not game FPS. A 5% comparison tolerance avoids treating small score differences as meaningful. This cannot measure game-specific cache benefits, graphics features, drivers, thermals, or actual frame rates. Numeric-only CPU and VRAM requirements are checked literally and described as such.

Storage checks use the game's installation drive, Windows drive type, free space, and recorded installation size. Already installed files count toward capacity. Free-space shortages call for clearing space; an SSD requirement on a hard drive calls for moving the game. Publisher requirements remain distinct from benchmark evidence.

## Portable Windows package

Run `portable/Build-Portable.ps1` from PowerShell to download the pinned official Node.js runtime, verify its SHA-256 checksum, compile the Windows launcher, and generate `dist/PC-Radar-Portable-Windows-x64.zip`. The build requires Windows' .NET Framework C# compiler and internet access. The resulting app requires neither a compiler nor a Node installation.

Distribute the ZIP, not the development folder. Extract it and run `PC Radar.exe`. Use Exit in the page to stop the process. The package starts on an available loopback port, reuses a running instance from the same extracted folder, and stores data beside the executable with a per-user fallback. It includes Node's license and no user data or benchmark database.

Portable integration checks: run `node portable/test-portable.js` after packaging. Tests run an isolated copy with browser launch suppressed and Node absent from PATH; they cover Unicode/spaced paths, repeated launch, hardware detection, occupied ports, token protection and shutdown. The launcher is unsigned. A clean Windows 10/11 VM test is still recommended before wider distribution.
