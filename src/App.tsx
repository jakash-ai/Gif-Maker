import React, { useState, useRef, useEffect } from 'react';
import { useFFmpeg } from './hooks/useFFmpeg';
import { fetchFile } from '@ffmpeg/util';
import { Upload, FileVideo, Settings2, Download, RefreshCw, Zap, Info, CheckCircle, ArrowLeft } from 'lucide-react';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeFile, readFile, stat } from '@tauri-apps/plugin-fs';
import { downloadDir, join, dirname, basename } from '@tauri-apps/api/path';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './styles/App.css';

const Youtube = ({ className, size = 24 }: { className?: string; size?: number }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    stroke="currentColor"
    strokeWidth="2"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2A29 29 0 0 0 23 11.75a29 29 0 0 0-.46-5.33z" />
    <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
  </svg>
);


const formatSecondsToHMS = (secs: number): string => {
  if (isNaN(secs) || secs < 0) return '00:00:00.0';
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = Math.floor(secs % 60);
  const tenths = Math.floor((secs % 1) * 10);
  
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${tenths}`;
};

const parseHMSToSeconds = (hms: string): number | null => {
  if (!hms || !hms.trim()) return null;
  const parts = hms.trim().split(':');
  if (parts.length === 1) {
    const val = parseFloat(parts[0]);
    return isNaN(val) ? null : val;
  } else if (parts.length === 2) {
    const mins = parseFloat(parts[0]);
    const secs = parseFloat(parts[1]);
    if (isNaN(mins) || isNaN(secs)) return null;
    return mins * 60 + secs;
  } else if (parts.length === 3) {
    const hrs = parseFloat(parts[0]);
    const mins = parseFloat(parts[1]);
    const secs = parseFloat(parts[2]);
    if (isNaN(hrs) || isNaN(mins) || isNaN(secs)) return null;
    return hrs * 3600 + mins * 60 + secs;
  }
  return null;
};

interface VideoMetadata {
  name: string;
  format: string;
  resolution: string;
  size: string;
}

function App() {
  const { ffmpeg, loaded, progress: ffmpegProgress, cancel: cancelFfmpeg } = useFFmpeg();
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [gifUrl, setGifUrl] = useState<string>('');
  const [gifData, setGifData] = useState<Uint8Array | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // YouTube states
  const [activeTab, setActiveTab] = useState<'local' | 'youtube' | 'batch'>('local');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [localVideoPath, setLocalVideoPath] = useState<string | null>(null);
  const [isDownloadingYt, setIsDownloadingYt] = useState(false);
  const [ytDownloadProgress, setYtDownloadProgress] = useState(0);
  const [ytDownloadLog, setYtDownloadLog] = useState('');
  const [isDownloadingClip, setIsDownloadingClip] = useState(false);
  const [isDownloadingMp4, setIsDownloadingMp4] = useState(false);

  // HMS precision range fields
  const [startTimeHMSInput, setStartTimeHMSInput] = useState('00:00:00.0');
  const [endTimeHMSInput, setEndTimeHMSInput] = useState('00:00:00.0');

  // YouTube available resolutions list
  const [availableYtResolutions, setAvailableYtResolutions] = useState<number[]>([]);
  const [ytResolution, setYtResolution] = useState<number | null>(null);
  const [downloadFullVideo, setDownloadFullVideo] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);

  // Save Settings State
  const [saveMode, setSaveMode] = useState<'downloads' | 'source' | 'custom'>('downloads');
  const [customSavePath, setCustomSavePath] = useState<string>('');
  const [sourceVideoPath, setSourceVideoPath] = useState<string | null>(null);

  // Batch Mode State
  interface BatchFile {
    path: string;
    name: string;
    size: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress?: number;
    error?: string;
  }
  const [batchFiles, setBatchFiles] = useState<BatchFile[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [currentBatchIndex, setCurrentBatchIndex] = useState<number>(-1);
  const [isFfmpegExecuting, setIsFfmpegExecuting] = useState(false);

  // Load save settings from localStorage on mount
  useEffect(() => {
    const savedMode = localStorage.getItem('gif_maker_save_mode');
    const savedPath = localStorage.getItem('gif_maker_custom_save_path');
    if (savedMode) {
      setSaveMode(savedMode as any);
    }
    if (savedPath) {
      setCustomSavePath(savedPath);
    }
  }, []);

  // Save save settings to localStorage when changed
  useEffect(() => {
    localStorage.setItem('gif_maker_save_mode', saveMode);
  }, [saveMode]);

  useEffect(() => {
    localStorage.setItem('gif_maker_custom_save_path', customSavePath);
  }, [customSavePath]);

  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const changeExtensionToGif = (fileName: string): string => {
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot === -1) return `${fileName}.gif`;
    return `${fileName.slice(0, lastDot)}.gif`;
  };

  const getExportPath = async (fileName: string, specificSourcePath?: string | null): Promise<string> => {
    const activeSourcePath = specificSourcePath !== undefined ? specificSourcePath : sourceVideoPath;
    if (saveMode === 'source' && activeSourcePath) {
      const dir = await dirname(activeSourcePath);
      return await join(dir, fileName);
    } else if (saveMode === 'custom' && customSavePath) {
      return await join(customSavePath, fileName);
    } else {
      const dlDir = await downloadDir();
      return await join(dlDir, fileName);
    }
  };

  const handleLocalVideoPath = async (filePath: string) => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);

    const url = convertFileSrc(filePath);
    setVideoFile(null);
    setSourceVideoPath(filePath);
    setLocalVideoPath(null);
    setVideoUrl(url);
    setGifUrl('');
    setGifData(null);
    setStartTime(0);
    setEndTime(0);
    setStartTimeHMSInput(formatSecondsToHMS(0));
    setEndTimeHMSInput(formatSecondsToHMS(0));
    setSaveSuccess(false);

    const name = await basename(filePath);
    let sizeStr = 'Unknown Size';
    try {
      const fileInfo = await stat(filePath);
      sizeStr = formatFileSize(fileInfo.size);
    } catch (err) {
      console.error("Failed to stat file:", err);
    }

    setMetadata({
      name,
      format: name.split('.').pop()?.toUpperCase() || 'Unknown',
      size: sizeStr,
      resolution: 'Detecting...'
    });
  };

  const addPathsToBatch = async (paths: string[]) => {
    const videoExtensions = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.ogg'];
    const videoPaths = paths.filter(p => {
      const lower = p.toLowerCase();
      return videoExtensions.some(ext => lower.endsWith(ext));
    });

    if (videoPaths.length === 0) return;

    const newFiles = await Promise.all(
      videoPaths.map(async (filePath) => {
        const name = await basename(filePath);
        let size = 0;
        try {
          const fileInfo = await stat(filePath);
          size = fileInfo.size;
        } catch (err) {
          console.error("Failed to stat file:", filePath, err);
        }
        return {
          path: filePath,
          name,
          size,
          status: 'pending' as const
        };
      })
    );

    setBatchFiles(prev => {
      const existingPaths = new Set(prev.map(f => f.path));
      const uniqueNewFiles = newFiles.filter(f => !existingPaths.has(f.path));
      return [...prev, ...uniqueNewFiles];
    });
  };

  const handleSelectBatchFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Video',
          extensions: ['mp4', 'mov', 'webm', 'avi', 'mkv', 'ogg']
        }]
      });

      if (selected && Array.isArray(selected)) {
        await addPathsToBatch(selected);
      }
    } catch (err) {
      console.error("Failed to select batch files:", err);
    }
  };

  const cancelBatchRef = useRef(false);

  const runBatchExport = async () => {
    if (batchFiles.length === 0 || !ffmpeg || !loaded) return;

    setIsBatchRunning(true);
    cancelBatchRef.current = false;

    // Reset status of all pending/failed/completed files to pending
    setBatchFiles(prev => prev.map(f => ({ ...f, status: 'pending', error: undefined })));

    for (let i = 0; i < batchFiles.length; i++) {
      if (cancelBatchRef.current) break;

      setCurrentBatchIndex(i);
      
      setBatchFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'processing' } : f));

      const file = batchFiles[i];

      try {
        try { await ffmpeg.deleteFile('input.mp4'); } catch(e) {}
        try { await ffmpeg.deleteFile('output.gif'); } catch(e) {}

        const videoBytes = await readFile(file.path);

        await ffmpeg.writeFile('input.mp4', videoBytes);

        const scaleFilter = `scale=${resolution}:-1:flags=bicubic`;
        let maxColors = 256;
        let ditherMode = 'sierra2_4a';
        let lossyParam = '';

        if (compression === 'high') {
          maxColors = 64;
          ditherMode = 'bayer:bayer_scale=2';
          lossyParam = ':diff_mode=rectangle'; 
        } else if (compression === 'medium') {
          maxColors = 128;
          ditherMode = 'sierra2_4a';
          lossyParam = ':diff_mode=rectangle';
        }

        const palettegenFilter = `palettegen=max_colors=${maxColors}`;
        const paletteuseFilter = `paletteuse=dither=${ditherMode}${lossyParam}`;
        const filter = `mpdecimate,fps=${fps},${scaleFilter},split[s0][s1];[s0]${palettegenFilter}[p];[s1][p]${paletteuseFilter}`;

        const ffmpegArgs = [
          '-i', 'input.mp4',
          '-vf', filter,
          'output.gif'
        ];

        setIsFfmpegExecuting(true);
        await ffmpeg.exec(ffmpegArgs);
        setIsFfmpegExecuting(false);

        if (cancelBatchRef.current) break;

        const gifData = await ffmpeg.readFile('output.gif');
        const gifBytes = new Uint8Array(gifData as Uint8Array);

        const gifName = changeExtensionToGif(file.name);
        const savePath = await getExportPath(gifName, file.path);
        
        await writeFile(savePath, gifBytes);

        setBatchFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'completed' } : f));
      } catch (err: any) {
        setIsFfmpegExecuting(false);
        console.error(`Failed to convert ${file.name}:`, err);
        const errMsg = err?.message || String(err) || 'Conversion failed';
        setBatchFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'failed', error: errMsg } : f));
      }
    }

    setIsBatchRunning(false);
    setCurrentBatchIndex(-1);
  };

  const cancelBatchExport = async () => {
    cancelBatchRef.current = true;
    try {
      await cancelFfmpeg();
    } catch (e) {
      console.error('Failed to cancel FFmpeg in batch:', e);
    }
    setIsBatchRunning(false);
    setCurrentBatchIndex(-1);
  };

  // Tauri Native Drag & Drop listener for v2
  useEffect(() => {
    let unlisten: () => void;
    
    const setupDragDrop = async () => {
      try {
        const win = getCurrentWindow();
        unlisten = await win.onDragDropEvent((event) => {
          console.log("Native Drop Event:", event);
          if (event.payload.type === 'drop') {
            const paths = event.payload.paths;
            if (paths && paths.length > 0) {
              if (activeTabRef.current === 'batch') {
                addPathsToBatch(paths);
              } else {
                handleLocalVideoPath(paths[0]);
              }
            }
            setIsDragging(false);
          } else if (event.payload.type === 'enter') {
            setIsDragging(true);
          } else if (event.payload.type === 'leave') {
            setIsDragging(false);
          }
        });
      } catch (err) {
        console.error("Failed to setup native drag drop:", err);
      }
    };

    setupDragDrop();
    return () => { if (unlisten) unlisten(); };
  }, []);

  // Listen to YouTube download progress events from Rust
  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenLog: (() => void) | undefined;
    
    const setupListeners = async () => {
      try {
        unlistenProgress = await listen<number>('yt-download-progress', (event) => {
          setYtDownloadProgress(event.payload);
        });
        unlistenLog = await listen<string>('yt-download-log', (event) => {
          const logLine = event.payload;
          setYtDownloadLog(logLine);
          
          // Parse ffmpeg progress time if available to show section download percentage
          if (isDownloadingClip && !downloadFullVideo && duration > 0) {
            const timeMatch = logLine.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
            if (timeMatch) {
              const hrs = parseInt(timeMatch[1], 10);
              const mins = parseInt(timeMatch[2], 10);
              const secs = parseInt(timeMatch[3], 10);
              const ms = parseInt(timeMatch[4], 10);
              const totalSecs = hrs * 3600 + mins * 60 + secs + ms / 100;
              const rangeDuration = endTime - startTime;
              if (rangeDuration > 0) {
                const percent = Math.min((totalSecs / rangeDuration) * 100, 99.9);
                setYtDownloadProgress(percent);
              }
            }
          }
        });
      } catch (err) {
        console.error("Failed to setup progress listeners:", err);
      }
    };

    setupListeners();
    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenLog) unlistenLog();
    };
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleVideoFile = (file: File) => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    
    const url = URL.createObjectURL(file);
    setVideoFile(file);
    setLocalVideoPath(null); // Clear YouTube local path
    setVideoUrl(url);
    setGifUrl('');
    setGifData(null);
    setStartTime(0);
    setEndTime(0);
    setStartTimeHMSInput(formatSecondsToHMS(0));
    setEndTimeHMSInput(formatSecondsToHMS(0));
    setSaveSuccess(false);
    
    setMetadata({
      name: file.name,
      format: file.type.split('/')[1]?.toUpperCase() || 'Unknown',
      size: formatFileSize(file.size),
      resolution: 'Detecting...'
    });
  };

  // Standard Web Drag and Drop (Backup)
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('video/') || file.name.match(/\.(mp4|mov|webm|avi|mkv)$/i))) {
      handleVideoFile(file);
    }
  };

  const handleLoadYoutubeVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!youtubeUrl.trim()) return;

    setIsDownloadingYt(true);
    setYtDownloadProgress(0);
    setSaveSuccess(false);

    try {
      // 1. Fetch metadata first to get duration, title, direct stream URL, and filesize
      const meta = await invoke<{ 
        title: string; 
        duration: number; 
        width?: number; 
        height?: number; 
        stream_url: string; 
        filesize?: number;
        available_resolutions: number[];
      }>('get_youtube_metadata', { 
        url: youtubeUrl,
        userAgent: navigator.userAgent
      });
      
      console.log('Youtube Metadata payload:', meta);
      
      setMetadata({
        name: meta.title,
        format: 'MP4 (YouTube)',
        size: meta.filesize ? formatFileSize(meta.filesize) : 'Streaming',
        resolution: meta.width && meta.height ? `${meta.width}x${meta.height}` : 'Detecting...'
      });

      // 2. Load the streaming video file directly
      setVideoUrl(meta.stream_url);
      setLocalVideoPath(null); // Not downloaded yet
      setVideoFile(null); // Clear local file reference
      setGifUrl('');
      setGifData(null);
      setStartTime(0);
      setEndTime(meta.duration || 0);
      setDuration(meta.duration || 0);
      
      setStartTimeHMSInput(formatSecondsToHMS(0));
      setEndTimeHMSInput(formatSecondsToHMS(meta.duration || 0));
      setAvailableYtResolutions(meta.available_resolutions || []);
      
      // Default to best <= 1080p
      const defaultRes = (meta.available_resolutions || []).find(r => r <= 1080) || (meta.available_resolutions || [])[0] || null;
      setYtResolution(defaultRes);

    } catch (err) {
      console.error('YouTube load failed:', err);
      alert(`YouTube load failed: ${err}`);
      setMetadata(null);
    } finally {
      setIsDownloadingYt(false);
    }
  };

  // Settings
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [resolution, setResolution] = useState(480);
  const [fps, setFps] = useState(15);
  const [isPPTOptimized, setIsPPTOptimized] = useState(true);
  const [compression, setCompression] = useState('medium');

  const onLoadedMetadata = () => {
    if (videoRef.current && videoUrl) {
      let d = videoRef.current.duration;
      // If the browser reports Infinity or NaN for stream, fallback to metadata duration
      if (!d || isNaN(d) || !isFinite(d)) {
        d = duration;
      }
      setDuration(d);
      setEndTime(d);
      setStartTimeHMSInput(formatSecondsToHMS(startTime));
      setEndTimeHMSInput(formatSecondsToHMS(d));
      
      setMetadata(prev => prev ? ({
        ...prev,
        resolution: videoRef.current && videoRef.current.videoWidth && videoRef.current.videoHeight
          ? `${videoRef.current.videoWidth}x${videoRef.current.videoHeight}` 
          : prev.resolution
      }) : null);
    }
  };

  const convertToGif = async () => {
    if ((!videoFile && !localVideoPath && !youtubeUrl && !sourceVideoPath) || !ffmpeg || !loaded) return;

    setIsProcessing(true);
    setGifUrl('');
    setGifData(null);
    setSaveSuccess(false);

    try {
      try { await ffmpeg.deleteFile('input.mp4'); } catch(e) {}
      try { await ffmpeg.deleteFile('output.gif'); } catch(e) {}

      let finalVideoBytes: Uint8Array;

      if (sourceVideoPath) {
        finalVideoBytes = await readFile(sourceVideoPath);
      } else if (videoFile) {
        finalVideoBytes = await fetchFile(videoFile);
      } else {
        // We have a YouTube video. Let's download ONLY the selected range!
        setIsDownloadingClip(true);
        setYtDownloadProgress(0);
        
        const cachedPath = await invoke<string>('download_youtube_video', {
          url: youtubeUrl,
          startTime: startTime,
          endTime: endTime,
          resolution: ytResolution,
          userAgent: navigator.userAgent,
          withAudio: false,
          fullVideo: false
        });
        
        setLocalVideoPath(cachedPath);
        
        // Read downloaded clip bytes
        finalVideoBytes = await readFile(cachedPath);
        setIsDownloadingClip(false);
      }

      await ffmpeg.writeFile('input.mp4', finalVideoBytes);

      const scaleFilter = `scale=${resolution}:-1:flags=bicubic`;
      
      let maxColors = 256;
      let ditherMode = 'sierra2_4a';
      let lossyParam = '';

      if (compression === 'high') {
        maxColors = 64;
        ditherMode = 'bayer:bayer_scale=2';
        lossyParam = ':diff_mode=rectangle'; 
      } else if (compression === 'medium') {
        maxColors = 128;
        ditherMode = 'sierra2_4a';
        lossyParam = ':diff_mode=rectangle';
      }

      const palettegenFilter = `palettegen=max_colors=${maxColors}`;
      const paletteuseFilter = `paletteuse=dither=${ditherMode}${lossyParam}`;
      const filter = `mpdecimate,fps=${fps},${scaleFilter},split[s0][s1];[s0]${palettegenFilter}[p];[s1][p]${paletteuseFilter}`;

      let ffmpegArgs = [];
      if (videoFile) {
        ffmpegArgs = [
          '-ss', startTime.toFixed(3),
          '-to', endTime.toFixed(3),
          '-i', 'input.mp4',
          '-vf', filter,
          'output.gif'
        ];
      } else {
        // The downloaded youtube file contains ONLY the selected segment, starting at 0.0s
        ffmpegArgs = [
          '-i', 'input.mp4',
          '-vf', filter,
          'output.gif'
        ];
      }

      setIsFfmpegExecuting(true);
      await ffmpeg.exec(ffmpegArgs);
      setIsFfmpegExecuting(false);

      const data = await ffmpeg.readFile('output.gif');
      const cleanData = new Uint8Array(data as Uint8Array);
      setGifData(cleanData);
      
      const blob = new Blob([cleanData], { type: 'image/gif' });
      const url = URL.createObjectURL(blob);
      setGifUrl(url);

      // Auto-download to configured save directory
      try {
        const baseName = videoFile 
          ? videoFile.name.split('.').slice(0, -1).join('.') 
          : (metadata?.name.replace(/[^a-z0-9_-]/gi, '_') || 'youtube_video');
        const exportPath = await getExportPath(`${baseName}.gif`);
        await writeFile(exportPath, cleanData);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 5000);
      } catch (dlErr) {
        console.error('Auto-save on conversion complete failed:', dlErr);
      }
    } catch (error) {
      console.error('Conversion failed:', error);
      alert('Conversion failed. Check console for details.');
    } finally {
      setIsProcessing(false);
      setIsDownloadingClip(false);
      setIsFfmpegExecuting(false);
    }
  };

  const handleDownload = async () => {
    if (!gifData || (!videoFile && !localVideoPath && !sourceVideoPath)) return;

    try {
      const baseName = videoFile 
        ? videoFile.name.split('.').slice(0, -1).join('.') 
        : sourceVideoPath
          ? metadata?.name.split('.').slice(0, -1).join('.') || 'video'
          : (metadata?.name.replace(/[^a-z0-9_-]/gi, '_') || 'youtube_video');
      
      const filePath = await save({
        filters: [{
          name: 'GIF Image',
          extensions: ['gif']
        }],
        defaultPath: `${baseName}.gif`
      });

      if (filePath) {
        // Use writeFile from @tauri-apps/plugin-fs
        await writeFile(filePath, gifData);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 5000);
      }
    } catch (error) {
      console.error('Save failed:', error);
      alert(`Save failed: ${error}`);
    }
  };

  const handleStartTimeHMSChange = (val: string) => {
    setStartTimeHMSInput(val);
    const parsed = parseHMSToSeconds(val);
    if (parsed !== null && parsed >= 0 && parsed <= endTime) {
      setStartTime(parsed);
    }
  };

  const handleStartTimeHMSBlur = () => {
    setStartTimeHMSInput(formatSecondsToHMS(startTime));
  };

  const handleEndTimeHMSChange = (val: string) => {
    setEndTimeHMSInput(val);
    const parsed = parseHMSToSeconds(val);
    if (parsed !== null && parsed >= startTime && parsed <= duration) {
      setEndTime(parsed);
    }
  };

  const handleEndTimeHMSBlur = () => {
    setEndTimeHMSInput(formatSecondsToHMS(endTime));
  };

  const downloadMp4Clip = async () => {
    if (!videoFile && !localVideoPath && !youtubeUrl && !sourceVideoPath) return;
    
    setIsDownloadingMp4(true);
    setSaveSuccess(false);

    try {
      let finalMp4Bytes: Uint8Array;

      if (sourceVideoPath || videoFile) {
        // Local video file clip cutting using FFmpeg
        if (!ffmpeg || !loaded) {
          alert("FFmpeg is loading, please try again in a moment.");
          setIsDownloadingMp4(false);
          return;
        }

        try { await ffmpeg.deleteFile('input.mp4'); } catch(e) {}
        try { await ffmpeg.deleteFile('output.mp4'); } catch(e) {}

        const localBytes = sourceVideoPath ? await readFile(sourceVideoPath) : await fetchFile(videoFile!);
        await ffmpeg.writeFile('input.mp4', localBytes);

        // Codec copy for super fast lossless cutting
        const ffmpegArgs = [
          '-ss', startTime.toFixed(3),
          '-to', endTime.toFixed(3),
          '-i', 'input.mp4',
          '-c', 'copy',
          'output.mp4'
        ];

        await ffmpeg.exec(ffmpegArgs);
        const data = await ffmpeg.readFile('output.mp4');
        finalMp4Bytes = new Uint8Array(data as Uint8Array);
      } else {
        // YouTube video clip download
        setIsDownloadingClip(true);
        setYtDownloadProgress(0);
        
        const cachedPath = await invoke<string>('download_youtube_video', {
          url: youtubeUrl,
          startTime: startTime,
          endTime: endTime,
          resolution: ytResolution,
          userAgent: navigator.userAgent,
          withAudio: true,
          fullVideo: downloadFullVideo
        });
        
        setLocalVideoPath(cachedPath);
        finalMp4Bytes = await readFile(cachedPath);
        setIsDownloadingClip(false);
      }

      // Now open save dialog
      const defaultFileName = videoFile 
        ? `${videoFile.name.split('.').slice(0, -1).join('.')}_clip.mp4` 
        : downloadFullVideo
          ? `${metadata?.name.replace(/[^a-z0-9_-]/gi, '_') || 'youtube_video'}_${ytResolution || 'best'}p.mp4`
          : `${metadata?.name.replace(/[^a-z0-9_-]/gi, '_') || 'youtube_video'}_clip_${ytResolution || 'best'}p.mp4`;

      const filePath = await save({
        filters: [{
          name: 'Video',
          extensions: ['mp4']
        }],
        defaultPath: defaultFileName
      });

      if (filePath) {
        await writeFile(filePath, finalMp4Bytes);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 5000);
      }
    } catch (err) {
      console.error('Failed to download MP4 clip:', err);
      alert(`Failed to download MP4 clip: ${err}`);
    } finally {
      setIsDownloadingMp4(false);
      setIsDownloadingClip(false);
    }
  };

  const cancelActiveOperations = async () => {
    try {
      await invoke('cancel_active_downloads');
    } catch (e) {
      console.error('Failed to cancel active downloads:', e);
    }
    try {
      await cancelFfmpeg();
    } catch (e) {
      console.error('Failed to cancel FFmpeg:', e);
    }
    setIsProcessing(false);
    setIsDownloadingClip(false);
    setIsDownloadingMp4(false);
    setIsDownloadingYt(false);
    setYtDownloadProgress(0);
    setYtDownloadLog('');
  };

  const resetAllProcesses = async () => {
    await cancelActiveOperations();
    setVideoFile(null);
    setSourceVideoPath(null);
    setLocalVideoPath(null);
    setVideoUrl('');
    setGifUrl('');
    setGifData(null);
    setMetadata(null);
    setSaveSuccess(false);
    setYoutubeUrl('');
    setDownloadFullVideo(false);
  };

  return (
    <div 
      className="window-wrapper"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <div className={`app-container ${isDragging ? 'dragging' : ''}`}>
        <header>
          <h1>GIF Maker</h1>
          <p>Optimized for Presentations & Professional Use</p>
        </header>

        {activeTab === 'batch' ? (
          <main className="main-content">
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <button 
                className="back-btn"
                onClick={() => { setActiveTab('local'); resetAllProcesses(); }}
                disabled={isBatchRunning}
              >
                <ArrowLeft size={16} />
                Back to Single Mode
              </button>
              
              <h2 style={{ fontSize: '1.25rem', background: 'linear-gradient(to right, #38bdf8, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 600 }}>
                Batch GIF Converter
              </h2>
            </div>

            <section className="preview-section">
              <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '400px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Conversion Queue ({batchFiles.length} files)</h3>
                  {batchFiles.length > 0 && !isBatchRunning && (
                    <button 
                      onClick={() => setBatchFiles([])}
                      style={{ 
                        width: 'auto', 
                        padding: '0.35rem 0.75rem', 
                        fontSize: '0.8rem', 
                        background: 'rgba(239, 68, 68, 0.15)', 
                        color: '#f87171', 
                        border: '1px solid rgba(239, 68, 68, 0.3)' 
                      }}
                    >
                      Clear All
                    </button>
                  )}
                </div>

                {batchFiles.length === 0 ? (
                  <div 
                    className={`upload-zone ${isDragging ? 'active' : ''}`}
                    style={{ 
                      flex: 1, 
                      display: 'flex', 
                      flexDirection: 'column', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      borderStyle: 'dashed', 
                      minHeight: '250px',
                      cursor: 'pointer' 
                    }}
                    onClick={handleSelectBatchFiles}
                  >
                    <Upload size={48} />
                    <h3>Choose or Drag multiple video files</h3>
                    <p>MP4, MOV, WebM, AVI, MKV</p>
                  </div>
                ) : (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', maxHeight: '500px', paddingRight: '0.25rem' }}>
                    {batchFiles.map((file, idx) => (
                      <div 
                        key={file.path} 
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'space-between', 
                          padding: '0.75rem 1rem', 
                          background: currentBatchIndex === idx ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255, 255, 255, 0.02)', 
                          borderRadius: '0.5rem', 
                          border: currentBatchIndex === idx ? '1px solid var(--accent-color)' : '1px solid var(--glass-border)',
                          gap: '1rem'
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: '0.9rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.name}>
                            {file.name}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.path}>
                            {file.path}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                            Size: {formatFileSize(file.size)}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                          {file.status === 'pending' && (
                            <span style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)' }}>
                              Pending
                            </span>
                          )}
                          {file.status === 'processing' && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', background: 'rgba(56, 189, 248, 0.15)', color: 'var(--accent-color)', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                              <RefreshCw size={12} className="spin" />
                              {isFfmpegExecuting ? `${Math.round(ffmpegProgress * 100)}%` : 'Preparing...'}
                            </span>
                          )}
                          {file.status === 'completed' && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', background: 'rgba(74, 222, 128, 0.15)', color: '#4ade80', border: '1px solid rgba(74, 222, 128, 0.3)' }}>
                              <CheckCircle size={12} />
                              Done
                            </span>
                          )}
                          {file.status === 'failed' && (
                            <span 
                              style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', cursor: 'help' }}
                              title={file.error}
                            >
                              Failed
                            </span>
                          )}

                          {!isBatchRunning && (
                            <button 
                              onClick={() => setBatchFiles(prev => prev.filter((_, i) => i !== idx))}
                              style={{ 
                                width: 'auto', 
                                padding: '0.35rem', 
                                background: 'transparent', 
                                color: 'var(--text-secondary)', 
                                border: 'none',
                                cursor: 'pointer' 
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.color = '#f87171'}
                              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {batchFiles.length > 0 && !isBatchRunning && (
                  <button 
                    onClick={handleSelectBatchFiles}
                    style={{ 
                      marginTop: '1rem', 
                      width: 'auto', 
                      alignSelf: 'flex-start',
                      background: 'transparent', 
                      border: '1px dashed var(--glass-border)', 
                      color: 'var(--text-primary)' 
                    }}
                  >
                    + Add More Videos
                  </button>
                )}
              </div>
            </section>

            <aside className="controls-section">
              <div className="glass-panel">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
                  <Settings2 size={20} />
                  <h2 style={{ fontSize: '1.25rem' }}>Batch Settings</h2>
                </div>

                <div className="controls-group">
                  <label>GIF Output Width</label>
                  <select 
                    value={resolution} 
                    onChange={(e) => setResolution(parseInt(e.target.value))}
                    disabled={isBatchRunning}
                  >
                    <option value={320}>320px (Mobile)</option>
                    <option value={480}>480px (Standard)</option>
                    <option value={600}>600px (PPT Balanced)</option>
                    <option value={720}>720px (HD)</option>
                  </select>
                </div>

                <div className="controls-group">
                  <label>Compression Level</label>
                  <select 
                    value={compression} 
                    onChange={(e) => setCompression(e.target.value)}
                    disabled={isBatchRunning}
                  >
                    <option value="low">Low (Max Quality)</option>
                    <option value="medium">Medium (Balanced)</option>
                    <option value="high">High (Smallest Size)</option>
                  </select>
                </div>

                <div className="controls-group">
                  <label>Frame Rate: {fps} FPS</label>
                  <input 
                    type="range" 
                    min={5} 
                    max={30} 
                    value={fps} 
                    onChange={(e) => setFps(parseInt(e.target.value))}
                    disabled={isBatchRunning}
                    className="range-slider"
                    style={{ position: 'relative', background: 'var(--glass-bg)', pointerEvents: 'auto' }}
                  />
                </div>

                <div className="controls-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: isBatchRunning ? 'not-allowed' : 'pointer' }} onClick={() => !isBatchRunning && setIsPPTOptimized(!isPPTOptimized)}>
                  <input type="checkbox" checked={isPPTOptimized} readOnly disabled={isBatchRunning} />
                  <label style={{ margin: 0, cursor: isBatchRunning ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Zap size={14} fill={isPPTOptimized ? "currentColor" : "none"} />
                    PPT Optimized Mode
                  </label>
                </div>

                <div className="controls-group" style={{ marginTop: '1.5rem', borderTop: '1px solid var(--glass-border)', paddingTop: '1.5rem' }}>
                  <label style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <Download size={16} /> Save Location
                  </label>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: isBatchRunning ? 'not-allowed' : 'pointer', margin: 0 }}>
                      <input 
                        type="radio" 
                        name="batchSaveMode" 
                        value="downloads" 
                        checked={saveMode === 'downloads'} 
                        disabled={isBatchRunning}
                        onChange={() => setSaveMode('downloads')} 
                      />
                      <span>Downloads Folder</span>
                    </label>
                    
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: isBatchRunning ? 'not-allowed' : 'pointer', margin: 0 }}>
                      <input 
                        type="radio" 
                        name="batchSaveMode" 
                        value="source" 
                        checked={saveMode === 'source'} 
                        disabled={isBatchRunning}
                        onChange={() => setSaveMode('source')} 
                      />
                      <span>Same as Source Video</span>
                    </label>
                    
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: isBatchRunning ? 'not-allowed' : 'pointer', margin: 0 }}>
                      <input 
                        type="radio" 
                        name="batchSaveMode" 
                        value="custom" 
                        checked={saveMode === 'custom'} 
                        disabled={isBatchRunning}
                        onChange={() => setSaveMode('custom')} 
                      />
                      <span>Custom Folder...</span>
                    </label>
                  </div>

                  {saveMode === 'custom' && (
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                      <input 
                        type="text" 
                        readOnly 
                        placeholder="Choose folder..." 
                        value={customSavePath}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          borderRadius: '0.375rem',
                          border: '1px solid var(--glass-border)',
                          background: 'rgba(0, 0, 0, 0.2)',
                          color: 'var(--text-primary)',
                          fontSize: '0.8rem',
                          outline: 'none'
                        }}
                      />
                      <button 
                        onClick={async () => {
                          try {
                            const selected = await open({
                              directory: true,
                              multiple: false
                            });
                            if (selected && typeof selected === 'string') {
                              setCustomSavePath(selected);
                            }
                          } catch (err) {
                            console.error("Failed to select folder:", err);
                          }
                        }}
                        disabled={isBatchRunning}
                        style={{
                          width: 'auto',
                          padding: '0.5rem 1rem',
                          fontSize: '0.8rem',
                          background: 'var(--glass-bg)',
                          border: '1px solid var(--glass-border)',
                          color: 'var(--text-primary)'
                        }}
                      >
                        Browse
                      </button>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {isBatchRunning && (
                    <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                          <span>Overall Progress</span>
                          <span>{currentBatchIndex + 1} / {batchFiles.length}</span>
                        </div>
                        <div style={{ width: '100%', height: '6px', background: 'var(--glass-bg)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div 
                            style={{ 
                              width: `${((currentBatchIndex) / batchFiles.length) * 100}%`, 
                              height: '100%', 
                              background: 'var(--accent-color)',
                              transition: 'width 0.3s ease'
                            }} 
                          />
                        </div>
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%', fontSize: '0.75rem' }}>
                            {isFfmpegExecuting ? `Converting: ${batchFiles[currentBatchIndex]?.name}` : 'Preparing...'}
                          </span>
                          <span>{isFfmpegExecuting ? `${Math.round(ffmpegProgress * 100)}%` : 'Preparing...'}</span>
                        </div>
                        <div style={{ width: '100%', height: '4px', background: 'var(--glass-bg)', borderRadius: '2px', overflow: 'hidden' }}>
                          <div 
                            style={{ 
                              width: `${isFfmpegExecuting ? ffmpegProgress * 100 : 0}%`, 
                              height: '100%', 
                              background: '#4ade80',
                              transition: 'width 0.1s linear'
                            }} 
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    {isBatchRunning ? (
                      <button 
                        onClick={cancelBatchExport}
                        style={{ 
                          flex: 1, 
                          background: 'rgba(239, 68, 68, 0.15)', 
                          color: '#f87171', 
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.5rem'
                        }}
                      >
                        <RefreshCw size={18} className="spin" />
                        Cancel Batch
                      </button>
                    ) : (
                      <button 
                        onClick={runBatchExport} 
                        disabled={batchFiles.length === 0 || !loaded}
                        style={{ 
                          flex: 1,
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          gap: '0.5rem',
                          padding: '0.75rem'
                        }}
                      >
                        <Zap size={18} />
                        Convert Batch ({batchFiles.length})
                      </button>
                    )}
                  </div>
                  
                  {!loaded && <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem', textAlign: 'center' }}>Loading FFmpeg...</p>}
                </div>
              </div>
            </aside>
          </main>
        ) : !videoUrl ? (
          <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div className="tabs-container">
              <button 
                className={`tab-btn ${activeTab === 'local' ? 'active' : ''}`}
                onClick={() => { setActiveTab('local'); resetAllProcesses(); }}
              >
                Local File
              </button>
              <button 
                className={`tab-btn ${activeTab === 'youtube' ? 'active' : ''}`}
                onClick={() => { setActiveTab('youtube'); resetAllProcesses(); }}
              >
                YouTube URL (Experimental)
              </button>
              <button 
                className={`tab-btn ${(activeTab as string) === 'batch' ? 'active' : ''}`}
                onClick={() => { setActiveTab('batch'); resetAllProcesses(); }}
              >
                Batch Convert
              </button>
            </div>

            {activeTab === 'local' ? (
              <div 
                className={`upload-zone ${isDragging ? 'active' : ''}`} 
                style={{ borderStyle: 'dashed', cursor: 'pointer' }}
                onClick={async () => {
                  try {
                    const selected = await open({
                      multiple: false,
                      filters: [{
                        name: 'Video',
                        extensions: ['mp4', 'mov', 'webm', 'avi', 'mkv', 'ogg']
                      }]
                    });
                    if (selected && typeof selected === 'string') {
                      handleLocalVideoPath(selected);
                    }
                  } catch (err) {
                    console.error("Failed to select file:", err);
                  }
                }}
              >
                <Upload size={48} />
                <div>
                  <h3>{isDragging ? 'Drop it here!' : 'Choose or Drag a video file'}</h3>
                  <p>MP4, MOV, or WebM</p>
                </div>
              </div>
            ) : (
              <div className="youtube-form">
                <Youtube className="yt-icon" size={48} />
                <h3>Import from YouTube (Experimental)</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: 'center' }}>Paste a YouTube link to download and load the video</p>
                <form onSubmit={handleLoadYoutubeVideo} className="url-input-container">
                  <input 
                    type="text" 
                    placeholder="https://www.youtube.com/watch?v=..." 
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    className="url-input"
                    disabled={isDownloadingYt}
                  />
                  <button 
                    type="submit" 
                    className="yt-load-btn"
                    disabled={isDownloadingYt || !youtubeUrl.trim()}
                  >
                    {isDownloadingYt ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <RefreshCw size={16} className="spin" />
                        Loading...
                      </span>
                    ) : 'Load Video'}
                  </button>
                </form>

                {isDownloadingYt && (
                  <div className="yt-progress-container">
                    <div className="yt-progress-info">
                      <span>Downloading Video Stream...</span>
                      <span>{Math.round(ytDownloadProgress)}%</span>
                    </div>
                    <div className="yt-progress-bar">
                      <div 
                        className="yt-progress-fill" 
                        style={{ width: `${ytDownloadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <main className="main-content">
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-start', marginBottom: '0.25rem' }}>
              <button 
                className="back-btn"
                onClick={resetAllProcesses}
              >
                <ArrowLeft size={16} />
                Back
              </button>
            </div>
            
            <section className="preview-section">
              <div className="glass-panel">
                <div className="video-preview-container">
                    <video 
                      key={videoUrl}
                      ref={videoRef}
                      src={videoUrl} 
                      controls 
                      onLoadedMetadata={onLoadedMetadata}
                    />
                </div>
                
                {metadata && (
                  <div className="video-info-panel" style={{ marginTop: '1.5rem', padding: '1rem', background: 'var(--glass-bg)', borderRadius: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Info size={16} color="var(--accent-color)" />
                      <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Video Info:</span>
                    </div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      <span style={{ color: 'var(--text-primary)' }}>Name:</span> {metadata.name}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      <span style={{ color: 'var(--text-primary)' }}>Format:</span> {metadata.format}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      <span style={{ color: 'var(--text-primary)' }}>Resolution:</span> {metadata.resolution}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      <span style={{ color: 'var(--text-primary)' }}>Size:</span> {metadata.size}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: '1.5rem' }}>
                  <div className="controls-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontWeight: 600 }}>Timeline Range Selection</label>
                    </div>
                    <div className="range-slider-container">
                      <input 
                        type="range" 
                        min={0} 
                        max={duration || 100} 
                        step={0.1}
                        value={startTime} 
                        onChange={(e) => {
                          const val = Math.min(parseFloat(e.target.value), endTime - 0.1);
                          setStartTime(val);
                          setStartTimeHMSInput(formatSecondsToHMS(val));
                          if (videoRef.current) {
                            videoRef.current.currentTime = val;
                          }
                        }}
                        className="range-slider"
                      />
                      <input 
                        type="range" 
                        min={0} 
                        max={duration || 100} 
                        step={0.1}
                        value={endTime} 
                        onChange={(e) => {
                          const val = Math.max(parseFloat(e.target.value), startTime + 0.1);
                          setEndTime(val);
                          setEndTimeHMSInput(formatSecondsToHMS(val));
                          if (videoRef.current) {
                            videoRef.current.currentTime = val;
                          }
                        }}
                        className="range-slider"
                      />
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                      <div>
                        <label style={{ fontSize: '0.75rem', marginBottom: '0.25rem', display: 'block', color: 'var(--text-secondary)' }}>Start Time (HH:MM:SS.t)</label>
                        <input 
                          type="text"
                          value={startTimeHMSInput}
                          onChange={(e) => handleStartTimeHMSChange(e.target.value)}
                          onBlur={handleStartTimeHMSBlur}
                          style={{ 
                            width: '100%', 
                            padding: '0.5rem', 
                            borderRadius: '0.375rem', 
                            border: '1px solid var(--glass-border)', 
                            background: 'rgba(0, 0, 0, 0.2)', 
                            color: 'var(--text-primary)',
                            fontSize: '0.875rem',
                            outline: 'none'
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.75rem', marginBottom: '0.25rem', display: 'block', color: 'var(--text-secondary)' }}>End Time (HH:MM:SS.t)</label>
                        <input 
                          type="text"
                          value={endTimeHMSInput}
                          onChange={(e) => handleEndTimeHMSChange(e.target.value)}
                          onBlur={handleEndTimeHMSBlur}
                          style={{ 
                            width: '100%', 
                            padding: '0.5rem', 
                            borderRadius: '0.375rem', 
                            border: '1px solid var(--glass-border)', 
                            background: 'rgba(0, 0, 0, 0.2)', 
                            color: 'var(--text-primary)',
                            fontSize: '0.875rem',
                            outline: 'none'
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--accent-color)', fontWeight: 600 }}>
                      Selected Range Duration: {formatSecondsToHMS(Math.max(0, endTime - startTime))} ({(Math.max(0, endTime - startTime)).toFixed(1)}s)
                    </div>
                  </div>
                </div>

                {gifUrl && (
                  <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                    <h3 style={{ marginBottom: '1rem' }}>Result Preview</h3>
                    <img src={gifUrl} alt="Generated GIF" style={{ maxWidth: '100%', borderRadius: '0.5rem' }} />
                    <div style={{ marginTop: '1rem' }}>
                      <button 
                        onClick={handleDownload}
                        style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 auto' }}
                      >
                        <Download size={18} />
                        Download GIF
                      </button>
                      {saveSuccess && (
                        <div style={{ marginTop: '1rem', color: '#4ade80', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                          <CheckCircle size={16} />
                          GIF saved successfully!
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <aside className="controls-section">
              <div className="glass-panel">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
                  <Settings2 size={20} />
                  <h2 style={{ fontSize: '1.25rem' }}>Settings</h2>
                </div>

                 <div className="controls-group">
                  <label>GIF Output Width</label>
                  <select 
                    value={resolution} 
                    onChange={(e) => setResolution(parseInt(e.target.value))}
                  >
                    <option value={320}>320px (Mobile)</option>
                    <option value={480}>480px (Standard)</option>
                    <option value={600}>600px (PPT Balanced)</option>
                    <option value={720}>720px (HD)</option>
                  </select>
                </div>

                {youtubeUrl && availableYtResolutions.length > 0 && (
                  <div className="controls-group">
                    <label>YouTube Video Resolution</label>
                    <select 
                      value={ytResolution || ''} 
                      onChange={(e) => setYtResolution(e.target.value ? parseInt(e.target.value) : null)}
                    >
                      {availableYtResolutions.map(res => (
                        <option key={res} value={res}>{res}p</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="controls-group">
                  <label>Compression Level</label>
                  <select 
                    value={compression} 
                    onChange={(e) => setCompression(e.target.value)}
                  >
                    <option value="low">Low (Max Quality)</option>
                    <option value="medium">Medium (Balanced)</option>
                    <option value="high">High (Smallest Size)</option>
                  </select>
                </div>

                <div className="controls-group">
                  <label>Frame Rate: {fps} FPS</label>
                  <input 
                    type="range" 
                    min={5} 
                    max={30} 
                    value={fps} 
                    onChange={(e) => setFps(parseInt(e.target.value))}
                    className="range-slider"
                    style={{ position: 'relative', background: 'var(--glass-bg)', pointerEvents: 'auto' }}
                  />
                </div>

                <div className="controls-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }} onClick={() => setIsPPTOptimized(!isPPTOptimized)}>
                  <input type="checkbox" checked={isPPTOptimized} readOnly />
                  <label style={{ margin: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Zap size={14} fill={isPPTOptimized ? "currentColor" : "none"} />
                    PPT Optimized Mode
                  </label>
                </div>

                {/* Save Location Settings */}
                <div className="controls-group" style={{ marginTop: '1.5rem', borderTop: '1px solid var(--glass-border)', paddingTop: '1.5rem' }}>
                  <label style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <Download size={16} /> Save Location
                  </label>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', margin: 0 }}>
                      <input 
                        type="radio" 
                        name="saveMode" 
                        value="downloads" 
                        checked={saveMode === 'downloads'} 
                        onChange={() => setSaveMode('downloads')} 
                      />
                      <span>Downloads Folder</span>
                    </label>
                    
                    <label style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem', 
                      cursor: sourceVideoPath ? 'pointer' : 'not-allowed', 
                      margin: 0,
                      opacity: sourceVideoPath ? 1 : 0.5
                    }}>
                      <input 
                        type="radio" 
                        name="saveMode" 
                        value="source" 
                        checked={saveMode === 'source'} 
                        disabled={!sourceVideoPath}
                        onChange={() => setSaveMode('source')} 
                      />
                      <span>Same as Source Video</span>
                    </label>
                    
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', margin: 0 }}>
                      <input 
                        type="radio" 
                        name="saveMode" 
                        value="custom" 
                        checked={saveMode === 'custom'} 
                        onChange={() => setSaveMode('custom')} 
                      />
                      <span>Custom Folder...</span>
                    </label>
                  </div>

                  {saveMode === 'custom' && (
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                      <input 
                        type="text" 
                        readOnly 
                        placeholder="Choose folder..." 
                        value={customSavePath}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          borderRadius: '0.375rem',
                          border: '1px solid var(--glass-border)',
                          background: 'rgba(0, 0, 0, 0.2)',
                          color: 'var(--text-primary)',
                          fontSize: '0.8rem',
                          outline: 'none'
                        }}
                      />
                      <button 
                        onClick={async () => {
                          try {
                            const selected = await open({
                              directory: true,
                              multiple: false
                            });
                            if (selected && typeof selected === 'string') {
                              setCustomSavePath(selected);
                            }
                          } catch (err) {
                            console.error("Failed to select folder:", err);
                          }
                        }}
                        style={{
                          width: 'auto',
                          padding: '0.5rem 1rem',
                          fontSize: '0.8rem',
                          background: 'var(--glass-bg)',
                          border: '1px solid var(--glass-border)',
                          color: 'var(--text-primary)'
                        }}
                      >
                        Browse
                      </button>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {(isProcessing || isDownloadingMp4) && (
                    <div style={{ marginBottom: '0.5rem', display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                        <span style={{ 
                          textOverflow: 'ellipsis', 
                          overflow: 'hidden', 
                          whiteSpace: 'nowrap', 
                          maxWidth: '75%', 
                          fontSize: '0.75rem' 
                        }} title={ytDownloadLog}>
                          {isDownloadingClip 
                            ? (ytDownloadLog || (downloadFullVideo ? 'Downloading full YouTube video...' : 'Downloading and slicing YouTube clip...')) 
                            : isDownloadingMp4 
                              ? 'Saving MP4 Clip...' 
                              : isFfmpegExecuting
                                ? 'Converting GIF...'
                                : 'Preparing File...'}
                        </span>
                        <span>
                          {isDownloadingClip && ytDownloadProgress === 0 
                            ? 'Processing...' 
                            : isDownloadingMp4 
                              ? `${Math.round((isDownloadingClip ? ytDownloadProgress : 50) * 100) / 100}%` 
                              : isFfmpegExecuting
                                ? `${Math.round(ffmpegProgress * 100)}%`
                                : 'Preparing...'}
                        </span>
                      </div>
                      <div style={{ width: '100%', height: '4px', background: 'var(--glass-bg)', borderRadius: '2px', overflow: 'hidden', position: 'relative' }}>
                        {isDownloadingClip && ytDownloadProgress === 0 ? (
                          <div className="indeterminate-progress" />
                        ) : (
                          <div 
                            style={{ 
                              width: `${(isDownloadingClip ? ytDownloadProgress / 100 : isDownloadingMp4 ? 0.5 : ffmpegProgress) * 100}%`, 
                              height: '100%', 
                              background: 'var(--accent-color)',
                              transition: 'width 0.2s ease'
                            }} 
                          />
                        )}
                      </div>
                      
                      <button
                        onClick={cancelActiveOperations}
                        style={{
                          marginTop: '0.75rem',
                          background: 'rgba(239, 68, 68, 0.15)',
                          color: '#f87171',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          padding: '0.5rem',
                          borderRadius: '0.375rem',
                          fontSize: '0.85rem',
                          fontWeight: 500,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.25rem',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                        }}
                      >
                        Cancel Operation
                      </button>
                    </div>
                  )}

                  {youtubeUrl && (
                    <div className="controls-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '1rem' }} onClick={() => setDownloadFullVideo(!downloadFullVideo)}>
                      <input type="checkbox" checked={downloadFullVideo} readOnly style={{ pointerEvents: 'none' }} />
                      <label style={{ margin: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem' }}>
                        <FileVideo size={14} />
                        Download Full Video (With Audio)
                      </label>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button 
                      onClick={convertToGif} 
                      disabled={!loaded || isProcessing || isDownloadingMp4}
                      style={{ 
                        flex: 1,
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        gap: '0.5rem',
                        padding: '0.75rem'
                      }}
                    >
                      {isProcessing && !isDownloadingMp4 ? (
                        <>
                          <RefreshCw size={18} className="spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <FileVideo size={18} />
                          Generate GIF
                        </>
                      )}
                    </button>

                    {youtubeUrl && (
                      <button 
                        onClick={downloadMp4Clip} 
                        disabled={isProcessing || isDownloadingMp4}
                        style={{ 
                          flex: 1,
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          gap: '0.5rem',
                          padding: '0.75rem',
                          background: 'transparent',
                          border: '1px solid var(--accent-color)',
                          color: 'var(--accent-color)'
                        }}
                      >
                        {isDownloadingMp4 ? (
                          <>
                            <RefreshCw size={18} className="spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Download size={18} />
                            {downloadFullVideo ? 'Download Full MP4' : 'Download MP4'}
                          </>
                        )}
                      </button>
                    )}
                  </div>
                  
                  {!loaded && <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem', textAlign: 'center' }}>Loading FFmpeg...</p>}
                  
                  {saveSuccess && (
                    <div style={{ marginTop: '0.5rem', color: '#4ade80', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                      <CheckCircle size={16} />
                      File saved successfully!
                    </div>
                  )}
                </div>

                <button 
                  onClick={resetAllProcesses}
                  style={{ background: 'transparent', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', marginTop: '1rem' }}
                >
                  Reset
                </button>
              </div>
            </aside>
          </main>
        )}
      </div>
      {isDragging && (
        <div className="drag-overlay">
          <Upload size={80} />
          <h2>Drop Video to Import</h2>
        </div>
      )}
    </div>
  );
}

export default App;
