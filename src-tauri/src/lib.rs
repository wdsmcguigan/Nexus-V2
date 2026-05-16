mod commands;
mod db;
mod gmail;
mod watcher;

use std::sync::Mutex;
use tauri::Manager;

/// Shared application state, held behind a Mutex so commands can mutate it.
pub struct AppState {
    pub db: Mutex<Option<db::VaultDb>>,
    pub vault_path: Mutex<Option<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            db: Mutex::new(None),
            vault_path: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_vault_data,
            commands::apply_mutation,
            commands::get_message_body,
            commands::list_accounts,
            commands::start_gmail_oauth,
            commands::sync_gmail_now,
            commands::start_watcher,
            commands::send_message,
            commands::get_vault_path,
            commands::set_vault_path,
        ])
        .setup(|app| {
            // On startup, auto-load vault if the path was saved previously
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Some(path) = commands::load_saved_vault_path(&app_handle) {
                    if let Err(e) = commands::init_vault(&app_handle, &path).await {
                        log::error!("Failed to auto-load vault: {e}");
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Nexus");
}
