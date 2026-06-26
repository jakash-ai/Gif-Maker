use std::process::{Command, Stdio, Child};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

struct AppState {
    active_child: Mutex<Option<Child>>,
}

#[derive(serde::Serialize)]
struct YoutubeMetadata {
    title: String,
    duration: f64,
    width: Option<u32>,
    height: Option<u32>,
    stream_url: String,
    filesize: Option<u64>,
    available_resolutions: Vec<u32>,
}

#[tauri::command]
async fn get_youtube_metadata(url: String, user_agent: String) -> Result<YoutubeMetadata, String> {
    let output = Command::new("yt-dlp")
        .args(&[
            "--user-agent", &user_agent,
            "-f", "best[ext=mp4]/best",
            "--print", "title:%(title)s",
            "--print", "duration:%(duration)s",
            "--print", "width:%(width)s",
            "--print", "height:%(height)s",
            "--print", "url:%(url)s",
            "--print", "filesize:%(filesize,filesize_approx)s",
            "--print", "formats_height:%(formats.:.height)s",
            "--no-playlist",
            &url,
        ])
        .output()
        .map_err(|e| format!("Failed to execute yt-dlp: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    
    let mut title = String::new();
    let mut duration = 0.0;
    let mut width = None;
    let mut height = None;
    let mut stream_url = String::new();
    let mut filesize = None;
    let mut available_resolutions = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("title:") {
            title = trimmed["title:".len()..].to_string();
        } else if trimmed.starts_with("duration:") {
            if let Ok(d) = trimmed["duration:".len()..].parse::<f64>() {
                duration = d;
            }
        } else if trimmed.starts_with("width:") {
            width = trimmed["width:".len()..].parse::<u32>().ok();
        } else if trimmed.starts_with("height:") {
            height = trimmed["height:".len()..].parse::<u32>().ok();
        } else if trimmed.starts_with("url:") {
            stream_url = trimmed["url:".len()..].to_string();
        } else if trimmed.starts_with("filesize:") {
            filesize = trimmed["filesize:".len()..].parse::<u64>().ok();
        } else if trimmed.starts_with("formats_height:") {
            let heights_str = &trimmed["formats_height:".len()..];
            if let Ok(heights) = serde_json::from_str::<Vec<Option<u32>>>(heights_str) {
                let mut unique_heights: Vec<u32> = heights.into_iter()
                    .filter_map(|h| h)
                    .filter(|&h| h >= 144)
                    .collect();
                unique_heights.sort_unstable();
                unique_heights.dedup();
                unique_heights.reverse(); // high to low quality
                available_resolutions = unique_heights;
            }
        }
    }

    Ok(YoutubeMetadata {
        title,
        duration,
        width,
        height,
        stream_url,
        filesize,
        available_resolutions,
    })
}

#[tauri::command]
async fn cancel_active_downloads(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut lock = state.active_child.lock().unwrap();
    if let Some(mut child) = lock.take() {
        let _ = child.kill();
    }
    Ok(())
}

fn cleanup_residue(output_path: &std::path::Path) {
    let _ = std::fs::remove_file(output_path);
    if let (Some(parent), Some(file_name)) = (output_path.parent(), output_path.file_name()) {
        if let Some(file_str) = file_name.to_str() {
            let stem = file_str.split('.').next().unwrap_or(file_str);
            if let Ok(entries) = std::fs::read_dir(parent) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if name.starts_with(stem) {
                            let _ = std::fs::remove_file(path);
                        }
                    }
                }
            }
        }
    }
}

fn read_lines_with_cr<R: std::io::Read>(mut reader: R, mut callback: impl FnMut(String)) {
    let mut buf = Vec::new();
    let mut temp = [0u8; 256];
    while let Ok(n) = reader.read(&mut temp) {
        if n == 0 {
            break;
        }
        for i in 0..n {
            let b = temp[i];
            if b == b'\n' || b == b'\r' {
                if !buf.is_empty() {
                    if let Ok(s) = String::from_utf8(buf.clone()) {
                        let trimmed = s.trim().to_string();
                        if !trimmed.is_empty() {
                            callback(trimmed);
                        }
                    }
                    buf.clear();
                }
            } else {
                buf.push(b);
            }
        }
    }
    if !buf.is_empty() {
        if let Ok(s) = String::from_utf8(buf) {
            let trimmed = s.trim().to_string();
            if !trimmed.is_empty() {
                callback(trimmed);
            }
        }
    }
}

#[tauri::command]
async fn download_youtube_video(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    url: String,
    start_time: f64,
    end_time: f64,
    resolution: Option<u32>,
    user_agent: String,
    with_audio: bool,
    full_video: bool,
) -> Result<String, String> {
    // Kill any active download before starting the new one to prevent concurrency and file locking issues
    {
        let mut lock = state.active_child.lock().unwrap();
        if let Some(mut old_child) = lock.take() {
            let _ = old_child.kill();
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }

    let home_dir = app.path().home_dir().map_err(|e| e.to_string())?;
    let mut temp_dir = home_dir.clone();
    temp_dir.push(".gif_maker");
    temp_dir.push("temp");

    let _ = std::fs::create_dir_all(&temp_dir);

    // Clean up any old residue files in temp directory before starting a new download
    if let Ok(entries) = std::fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let _ = std::fs::remove_file(path);
            }
        }
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let output_path = temp_dir.join(format!("yt_{}.mp4", timestamp));
    let output_path_str = output_path.to_string_lossy().to_string();

    let format_selection = if with_audio {
        if let Some(h) = resolution {
            format!("bestvideo[height<={h}][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<={h}]+bestaudio/best[height<={h}]/best", h=h)
        } else {
            "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo+bestaudio/best".to_string()
        }
    } else {
        if let Some(h) = resolution {
            format!("bestvideo[height<={h}][vcodec^=avc1][ext=mp4]/best[height<={h}][vcodec^=avc1][ext=mp4]/bestvideo[height<={h}][ext=mp4]/best[height<={h}][ext=mp4]/bestvideo[height<={h}]/best[height<={h}]/best", h=h)
        } else {
            "bestvideo[vcodec^=avc1][ext=mp4]/best[vcodec^=avc1][ext=mp4]/bestvideo[ext=mp4]/best[ext=mp4]/best".to_string()
        }
    };

    let mut args = vec![
        "--user-agent".to_string(),
        user_agent,
        "-f".to_string(),
        format_selection,
        "--newline".to_string(),
        "--no-playlist".to_string(),
    ];

    if !full_video {
        args.push("--download-sections".to_string());
        args.push(format!("*{:.2}-{:.2}", start_time, end_time));
    }

    args.push(url);
    args.push("-o".to_string());
    args.push(output_path_str.clone());

    let mut child = Command::new("yt-dlp")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start yt-dlp: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    // Store child in active state
    {
        let mut lock = state.active_child.lock().unwrap();
        *lock = Some(child);
    }

    // Read stderr concurrently in a separate thread to avoid deadlocks when the OS pipe buffer fills up
    let stderr_lines = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let stderr_lines_clone = stderr_lines.clone();
    let app_clone = app.clone();
    std::thread::spawn(move || {
        read_lines_with_cr(stderr, move |line_str| {
            app_clone.emit("yt-download-log", line_str.clone()).ok();
            let mut lock = stderr_lines_clone.lock().unwrap();
            lock.push_str(&line_str);
            lock.push('\n');
        });
    });

    // Read stdout in the main thread
    let app_clone2 = app.clone();
    read_lines_with_cr(stdout, move |line_str| {
        if let Some(percent) = parse_progress(&line_str) {
            app_clone2.emit("yt-download-progress", percent).ok();
        }
        app_clone2.emit("yt-download-log", line_str).ok();
    });

    // Retrieve child from state to wait for it and clean up
    let child_opt = {
        let mut lock = state.active_child.lock().unwrap();
        lock.take()
    };

    if let Some(mut child) = child_opt {
        let status = child.wait().map_err(|e| format!("Failed to wait for yt-dlp: {}", e))?;
        if !status.success() {
            let stderr_str = {
                let lock = stderr_lines.lock().unwrap();
                lock.clone()
            };
            cleanup_residue(&output_path);
            return Err(format!("yt-dlp download failed: {}", stderr_str));
        }
    } else {
        cleanup_residue(&output_path);
        return Err("Download cancelled by user".to_string());
    }

    Ok(output_path_str)
}

fn parse_progress(line: &str) -> Option<f64> {
    if !line.contains("[download]") {
        return None;
    }
    
    let percent_idx = line.find('%')?;
    let download_idx = line.find("[download]")?;
    let start_search = download_idx + "[download]".len();
    
    let num_str = line[start_search..percent_idx].trim();
    num_str.parse::<f64>().ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(AppState {
      active_child: Mutex::new(None),
    })
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![
      get_youtube_metadata,
      download_youtube_video,
      cancel_active_downloads
    ])
    .setup(|app| {
      // Clean temp directory on startup
      if let Ok(home_dir) = app.path().home_dir() {
          let mut temp_dir = home_dir.clone();
          temp_dir.push(".gif_maker");
          temp_dir.push("temp");
          if temp_dir.exists() {
              let _ = std::fs::remove_dir_all(&temp_dir);
          }
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
