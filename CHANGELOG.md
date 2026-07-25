# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0] - 2026-07-25

### Added
- **High-Resolution GIF Support:** Added output width options for 1080px (FHD Width), 1920px (1080p FHD Full), 2048px (2K DCI), 2560px (2K QHD), and 3840px (4K UHD) in both single-video settings and batch settings.
- **Out of Memory Warnings:** Integrated UI warning notifications when choosing resolutions equal to or greater than 1080px to caution about increased conversion times and possible memory limit warnings under browser WASM environment.

### Changed
- **Version Bump:** Bumped version to `1.3.0` across the project metadata configurations (`package.json`, `tauri.conf.json`, and `Cargo.toml`).
