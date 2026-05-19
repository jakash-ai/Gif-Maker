import React, { useState, useRef } from 'react';
import { useFFmpeg } from './hooks/useFFmpeg';
import { fetchFile } from '@ffmpeg/util';
import { Upload, FileVideo, Settings2, Download, RefreshCw, Zap } from 'lucide-react';
import './styles/App.css';

function App() {
  const { ffmpeg, loaded, progress: ffmpegProgress } = useFFmpeg();
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [gifUrl, setGifUrl] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Settings
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [resolution, setResolution] = useState(480);
  const [fps, setFps] = useState(15);
  const [isPPTOptimized, setIsPPTOptimized] = useState(true);
  const [compression, setCompression] = useState('medium'); // low, medium, high

  const videoRef = useRef<HTMLVideoElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setGifUrl('');
      // Reset times for new video
      setStartTime(0);
      setEndTime(0);
    }
  };

  const onLoadedMetadata = () => {
    if (videoRef.current) {
      const d = videoRef.current.duration;
      setDuration(d);
      setEndTime(d);
    }
  };

  const convertToGif = async () => {
    if (!videoFile || !ffmpeg || !loaded) return;

    setIsProcessing(true);
    setGifUrl('');

    try {
      try { await ffmpeg.deleteFile('input.mp4'); } catch(e) {}
      try { await ffmpeg.deleteFile('output.gif'); } catch(e) {}

      await ffmpeg.writeFile('input.mp4', await fetchFile(videoFile));

      // FFmpeg filter complex for high quality & optimized GIF
      const scaleFilter = `scale=${resolution}:-1:flags=lanczos`;
      
      // Aggressive Optimization settings
      // 1. mpdecimate: Drops frames that are nearly identical to the previous frame
      // 2. max_colors: Lowering colors significantly reduces LZW dictionary size
      // 3. stats_mode=diff: Focuses on pixel changes
      
      let maxColors = 256;
      let ditherMode = 'sierra2_4a';
      let lossyParam = '';

      if (compression === 'high') {
        maxColors = 64; // Aggressive color reduction
        ditherMode = 'bayer:bayer_scale=2'; // Pattern dithering is much more compressible than error diffusion
        lossyParam = ':diff_mode=rectangle'; 
      } else if (compression === 'medium') {
        maxColors = 128;
        ditherMode = 'sierra2_4a';
        lossyParam = ':diff_mode=rectangle';
      }

      const palettegenFilter = `palettegen=max_colors=${maxColors}:stats_mode=diff`;
      // We use mpdecimate to drop duplicate frames which saves massive space in GIFs
      const paletteuseFilter = `paletteuse=dither=${ditherMode}${lossyParam}`;

      // Final Filter: mpdecimate -> fps -> scale -> palette
      const filter = `mpdecimate,fps=${fps},${scaleFilter},split[s0][s1];[s0]${palettegenFilter}[p];[s1][p]${paletteuseFilter}`;

      await ffmpeg.exec([
        '-ss', startTime.toFixed(3),
        '-to', endTime.toFixed(3),
        '-i', 'input.mp4',
        '-vf', filter,
        'output.gif'
      ]);

      const data = await ffmpeg.readFile('output.gif');
      const blob = new Blob([data as any], { type: 'image/gif' });
      const url = URL.createObjectURL(blob);
      setGifUrl(url);
    } catch (error) {
      console.error('Conversion failed:', error);
      alert('Conversion failed. This usually happens if the video is too high resolution or the selection is too long for browser memory.');
    } finally {
      setIsProcessing(false);
    }
  };

  const getOutputFilename = () => {
    if (!videoFile) return 'optimized.gif';
    const baseName = videoFile.name.split('.').slice(0, -1).join('.');
    return `${baseName}.gif`;
  };

  return (
    <div className="app-container">
      <header>
        <h1>Video to GIF Maker</h1>
        <p>Optimized for Presentations & Professional Use</p>
      </header>

      {!videoFile ? (
        <div className="glass-panel" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <label className="upload-zone">
            <input type="file" accept="video/*" onChange={handleFileChange} style={{ display: 'none' }} />
            <Upload size={48} />
            <div>
              <h3>Choose a video file</h3>
              <p>MP4, MOV, or WebM</p>
            </div>
          </label>
        </div>
      ) : (
        <main className="main-content">
          <section className="preview-section">
            <div className="glass-panel">
              <div className="video-preview-container">
                <video 
                  ref={videoRef}
                  src={videoUrl} 
                  controls 
                  onLoadedMetadata={onLoadedMetadata}
                />
              </div>
              
              <div style={{ marginTop: '1.5rem' }}>
                <div className="controls-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <label>Start Time: {startTime.toFixed(1)}s</label>
                    <label>End Time: {endTime.toFixed(1)}s</label>
                  </div>
                  <div className="range-slider-container">
                    <input 
                      type="range" 
                      min={0} 
                      max={duration || 100} 
                      step={0.1}
                      value={startTime} 
                      onChange={(e) => setStartTime(Math.min(parseFloat(e.target.value), endTime - 0.1))}
                      className="range-slider"
                    />
                    <input 
                      type="range" 
                      min={0} 
                      max={duration || 100} 
                      step={0.1}
                      value={endTime} 
                      onChange={(e) => setEndTime(Math.max(parseFloat(e.target.value), startTime + 0.1))}
                      className="range-slider"
                    />
                  </div>
                </div>
              </div>

              {gifUrl && (
                <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                  <h3 style={{ marginBottom: '1rem' }}>Result Preview</h3>
                  <img src={gifUrl} alt="Generated GIF" style={{ maxWidth: '100%', borderRadius: '0.5rem' }} />
                  <div style={{ marginTop: '1rem' }}>
                    <a href={gifUrl} download={getOutputFilename()}>
                      <button style={{ width: 'auto' }}>
                        <Download size={18} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                        Download {getOutputFilename()}
                      </button>
                    </a>
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
                <label>Resolution (Width)</label>
                <select 
                  value={resolution} 
                  onChange={(e) => setResolution(parseInt(e.target.value))}
                >
                  <option value={320}>320p (Mobile)</option>
                  <option value={480}>480p (Standard)</option>
                  <option value={600}>600p (PPT Balanced)</option>
                  <option value={720}>720p (HD)</option>
                </select>
              </div>

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

              <div style={{ marginTop: '2rem' }}>
                {isProcessing && (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                      <span>Converting...</span>
                      <span>{Math.round(ffmpegProgress * 100)}%</span>
                    </div>
                    <div style={{ width: '100%', height: '4px', background: 'var(--glass-bg)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div 
                        style={{ 
                          width: `${ffmpegProgress * 100}%`, 
                          height: '100%', 
                          background: 'var(--accent-color)',
                          transition: 'width 0.2s ease'
                        }} 
                      />
                    </div>
                  </div>
                )}
                <button 
                  onClick={convertToGif} 
                  disabled={!loaded || isProcessing}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                >
                  {isProcessing ? (
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
                {!loaded && <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem', textAlign: 'center' }}>Loading FFmpeg...</p>}
              </div>

              <button 
                onClick={() => { setVideoFile(null); setGifUrl(''); }}
                style={{ background: 'transparent', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', marginTop: '1rem' }}
              >
                Reset
              </button>
            </div>
          </aside>
        </main>
      )}
    </div>
  );
}

export default App;
