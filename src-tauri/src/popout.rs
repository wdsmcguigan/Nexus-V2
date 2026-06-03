//! Multi-window support: spawning de-docked panels into separate OS windows,
//! per-window geometry queries, and monitor enumeration for multi-monitor
//! restore.
//!
//! Window creation happens here (in Rust) rather than via the JS
//! `WebviewWindow` constructor so the backend owns the window registry and
//! geometry application. Pop-out windows are labelled `popout-{kind}-{uuid}`;
//! the capability set in `capabilities/default.json` grants the `popout-*`
//! glob the same permissions as the main window so pop-outs can invoke
//! commands and listen to events.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{
    Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewUrl, WebviewWindowBuilder,
};

/// Pending payloads handed to a pop-out window at creation time, keyed by the
/// window label. The pop-out pulls (and removes) its payload via
/// `take_popout_payload` once its React root mounts. Lives in `AppState`.
#[derive(Default)]
pub struct PopoutPayloads(pub Mutex<HashMap<String, String>>);

/// Saved window geometry (physical pixels) plus the monitor it lived on, used
/// to restore detached windows across launches.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(rename = "monitorName")]
    pub monitor_name: Option<String>,
    #[serde(rename = "scaleFactor")]
    pub scale_factor: f64,
}

#[derive(Serialize, Clone, Debug)]
pub struct MonitorInfo {
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(rename = "scaleFactor")]
    pub scale_factor: f64,
}

fn default_size(kind: &str) -> (f64, f64) {
    match kind {
        "composer" => (720.0, 640.0),
        "viewer" => (760.0, 820.0),
        _ => (900.0, 760.0),
    }
}

/// True when (x, y) falls inside any monitor's bounds — used to detect a
/// window that would otherwise be spawned off-screen (e.g. after undocking).
fn point_on_some_monitor(x: i32, y: i32, monitors: &[MonitorInfo]) -> bool {
    monitors.iter().any(|m| {
        x >= m.x && x < m.x + m.width as i32 && y >= m.y && y < m.y + m.height as i32
    })
}

fn collect_monitors(win: &tauri::WebviewWindow) -> Vec<MonitorInfo> {
    win.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|m| {
            let pos = m.position();
            let size = m.size();
            MonitorInfo {
                name: m.name().cloned(),
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                scale_factor: m.scale_factor(),
            }
        })
        .collect()
}

/// Spawn a pop-out OS window hosting a single panel of `kind`
/// (`"composer"` | `"viewer"` | `"panel"`). `target_id` and `payload` are
/// stashed for the new window to pull on mount. Returns the new window label.
#[tauri::command]
pub async fn open_popout_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
    kind: String,
    target_id: Option<String>,
    payload: Option<String>,
    geometry: Option<WindowGeometry>,
) -> std::result::Result<String, String> {
    let label = format!("popout-{}-{}", kind, uuid::Uuid::new_v4().simple());

    // Stash payload + target so the pop-out can pull it after mount. We encode
    // both into one JSON envelope to keep a single round-trip.
    if payload.is_some() || target_id.is_some() {
        let envelope = serde_json::json!({ "kind": kind, "targetId": target_id, "payload": payload })
            .to_string();
        state
            .popout_payloads
            .0
            .lock()
            .map_err(|_| "payload lock poisoned".to_string())?
            .insert(label.clone(), envelope);
    }

    let (def_w, def_h) = default_size(&kind);
    let win = WebviewWindowBuilder::new(&app, label.as_str(), WebviewUrl::App("index.html".into()))
        .title("Nexus")
        .inner_size(def_w, def_h)
        .min_inner_size(360.0, 300.0)
        .build()
        .map_err(|e| e.to_string())?;

    // Apply saved geometry (physical px), clamping onto a visible monitor if
    // the saved position is now off-screen (monitor disconnected/undocked).
    if let Some(g) = geometry {
        let monitors = collect_monitors(&win);
        let (mut x, mut y) = (g.x, g.y);
        if !monitors.is_empty() && !point_on_some_monitor(x, y, &monitors) {
            let primary = win
                .primary_monitor()
                .ok()
                .flatten()
                .map(|m| (m.position().x, m.position().y))
                .unwrap_or((monitors[0].x, monitors[0].y));
            x = primary.0 + 40;
            y = primary.1 + 40;
        }
        let _ = win.set_size(Size::Physical(PhysicalSize { width: g.width, height: g.height }));
        let _ = win.set_position(Position::Physical(PhysicalPosition { x, y }));
    }

    Ok(label)
}

/// Pull (and remove) the JSON envelope stashed for `label` at creation time.
#[tauri::command]
pub async fn take_popout_payload(
    state: tauri::State<'_, crate::AppState>,
    label: String,
) -> std::result::Result<Option<String>, String> {
    Ok(state
        .popout_payloads
        .0
        .lock()
        .map_err(|_| "payload lock poisoned".to_string())?
        .remove(&label))
}

/// Close a pop-out window by label (used by ⌘W inside a pop-out and by the
/// main window when restoring/replacing detached windows).
#[tauri::command]
pub async fn close_popout_window(
    app: tauri::AppHandle,
    label: String,
) -> std::result::Result<(), String> {
    if let Some(win) = app.get_webview_window(&label) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Enumerate connected monitors (physical bounds + scale factor).
#[tauri::command]
pub async fn list_monitors(
    app: tauri::AppHandle,
) -> std::result::Result<Vec<MonitorInfo>, String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    Ok(collect_monitors(&win))
}

/// Read a window's current geometry (physical px) and the monitor it sits on.
#[tauri::command]
pub async fn get_window_geometry(
    app: tauri::AppHandle,
    label: String,
) -> std::result::Result<Option<WindowGeometry>, String> {
    let win = match app.get_webview_window(&label) {
        Some(w) => w,
        None => return Ok(None),
    };
    let pos = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let scale_factor = win.scale_factor().map_err(|e| e.to_string())?;
    let monitor_name = win
        .current_monitor()
        .ok()
        .flatten()
        .and_then(|m| m.name().cloned());
    Ok(Some(WindowGeometry {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        monitor_name,
        scale_factor,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon(name: &str, x: i32, y: i32, w: u32, h: u32) -> MonitorInfo {
        MonitorInfo { name: Some(name.into()), x, y, width: w, height: h, scale_factor: 1.0 }
    }

    #[test]
    fn point_inside_primary_monitor_is_visible() {
        let monitors = vec![mon("primary", 0, 0, 1920, 1080)];
        assert!(point_on_some_monitor(100, 100, &monitors));
    }

    #[test]
    fn point_on_second_monitor_is_visible() {
        let monitors = vec![mon("primary", 0, 0, 1920, 1080), mon("secondary", 1920, 0, 2560, 1440)];
        assert!(point_on_some_monitor(2000, 200, &monitors));
    }

    #[test]
    fn point_on_disconnected_monitor_is_offscreen() {
        // Window was saved on a monitor at x=1920 that is no longer present.
        let monitors = vec![mon("primary", 0, 0, 1920, 1080)];
        assert!(!point_on_some_monitor(2400, 300, &monitors));
    }

    #[test]
    fn negative_offscreen_point_detected() {
        let monitors = vec![mon("primary", 0, 0, 1920, 1080)];
        assert!(!point_on_some_monitor(-50, 100, &monitors));
    }
}
