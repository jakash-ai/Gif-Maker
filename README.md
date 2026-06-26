# 🎬 GIF Maker

A modern, high-performance desktop application built using **Tauri v2**, **React**, **TypeScript**, **Vite**, and **FFmpeg** to convert video clips into optimized GIFs. It is specifically designed for creating high-quality, lightweight GIFs for presentations, professional documentation, and web use.

---

## ✨ Features

- **📂 Local Video Importing**: Drag & drop or browse local video files (MP4, MOV, WebM, AVI, MKV).
- **📺 YouTube Slicing (Experimental)**: Load direct streams from YouTube URLs. 
- **✂️ Interactive Timeline Selection**: Dual-range timeline slider with live frame-accurate scrub seeking.
- **⚡ Super Fast Slicing**: Slices YouTube clips in under 2 seconds using native `yt-dlp` chunk downloads.
- **🎛️ Advanced Optimization & Compression**:
  - Customize frames-per-second (FPS) and resolution.
  - Apply custom color palettes and dither modes (e.g. Sierra, Bayer).
  - Select compression tiers (High, Medium, None) to control filesize.
- **🚀 Auto-Save**: Automatically downloads converted GIFs directly to your system's `Downloads` folder once conversion is complete.
- **🎨 Modern Dark Glassmorphism UI**: High-end responsive design with smooth transitions and real-time conversion progress logs.

---

## 🛠️ Technology Stack

- **Frontend**: React (v19), TypeScript, Vite, Vanilla CSS.
- **Backend & Native API Wrapper**: Tauri v2 (Rust).
- **Core Decoders & Processors**:
  - `@ffmpeg/ffmpeg` (WASM) for client-side local video decoding and GIF generation.
  - `yt-dlp` & `ffmpeg` (Native) for backend YouTube stream extraction and audio-video slicing.

---

## ⚙️ System Requirements & Setup

To use the experimental **YouTube Import** feature, make sure the following dependencies are installed and available on your system's `PATH`:

1. **[yt-dlp](https://github.com/yt-dlp/yt-dlp)**: High-performance command-line YouTube downloader.
2. **[FFmpeg](https://ffmpeg.org/)**: Native command-line multimedia framework.

---

## 🚀 Development & Build Commands

First, install the npm dependencies:
```bash
npm install
```

### Run in Development Mode
To launch the Vite frontend server and boot up the Tauri desktop window:
```bash
npm run dev
# or
npx tauri dev
```

### Build Production Installers (Windows 11 / 10)
To compile the release binary and bundle it into standalone setups:
```bash
npx tauri build
```
Once compilation is complete, the installers will be available in:
- **EXE Installer**: `src-tauri/target/release/bundle/nsis/GIF Maker_0.1.1_x64-setup.exe`
- **MSI Installer**: `src-tauri/target/release/bundle/msi/GIF Maker_0.1.1_x64_en-US.msi`

---

## 📂 Project Structure

```text
├── src/                    # React frontend application
│   ├── components/         # UI Elements
│   ├── hooks/              # Custom React hooks (e.g., useFFmpeg)
│   ├── styles/             # Vanilla CSS stylesheets
│   ├── App.tsx             # Main React entrypoint
│   └── main.tsx            # DOM mounting
├── src-tauri/              # Tauri native project configuration
│   ├── src/
│   │   ├── main.rs         # Tauri application main
│   │   └── lib.rs          # Rust command handlers (YouTube fetch/slice metadata)
│   ├── capabilities/       # Windows/desktop permissions configurations
│   ├── icons/              # App & Setup bundle icons (.ico, .icns)
│   └── tauri.conf.json     # Tauri app configuration & build pipeline
└── package.json            # Node dependencies and scripts
```
