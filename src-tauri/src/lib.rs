mod commands;
pub mod crypto;
mod db;
mod gmail;
mod relay;
mod watcher;

use std::sync::{Arc, Mutex};

/// Shared application state, held behind a Mutex so commands can mutate it.
pub struct AppState {
    pub db: Mutex<Option<db::VaultDb>>,
    pub vault_path: Mutex<Option<String>>,
    pub relay: Arc<Mutex<relay::RelayState>>,
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
            relay: Arc::new(Mutex::new(relay::RelayState::default())),
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_vault_data,
            commands::apply_mutation,
            commands::get_message_body,
            commands::list_accounts,
            commands::disconnect_account,
            commands::start_gmail_oauth,
            commands::sync_gmail_now,
            commands::start_watcher,
            commands::send_message,
            commands::save_file_to_downloads,
            commands::download_attachment,
            commands::get_vault_path,
            commands::set_vault_path,
            commands::reset_vault,
            // EP-5 relay commands
            commands::get_relay_status,
            commands::set_relay_url,
            commands::get_vault_key_hex,
            commands::start_enrollment_session,
            commands::complete_enrollment,
            commands::start_relay_hosting,
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
