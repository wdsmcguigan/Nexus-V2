mod commands;
pub mod crypto;
mod db;
mod gmail;
pub mod providers;
mod relay;
pub mod smtp;
mod watcher;

use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tokio::sync::Mutex as AsyncMutex;

/// Shared application state, held behind a Mutex so commands can mutate it.
pub struct AppState {
    pub db: Mutex<Option<db::VaultDb>>,
    pub vault_path: Mutex<Option<String>>,
    /// "traditional" | "local-first" — persisted to {vault_path}/.nexus-mode
    pub client_mode: Mutex<String>,
    pub relay: Arc<Mutex<relay::RelayState>>,
    pub token_refresh_lock: AsyncMutex<()>,
    /// Whether desktop notifications are enabled (controlled by frontend preference).
    pub notifications_enabled: Mutex<bool>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            db: Mutex::new(None),
            vault_path: Mutex::new(None),
            client_mode: Mutex::new("traditional".to_string()),
            relay: Arc::new(Mutex::new(relay::RelayState::default())),
            token_refresh_lock: AsyncMutex::new(()),
            notifications_enabled: Mutex::new(true),
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_vault_data,
            commands::get_messages_for_label,
            commands::get_message_source,
            commands::apply_mutation,
            commands::get_message_body,
            commands::list_accounts,
            commands::disconnect_account,
            commands::start_gmail_oauth,
            commands::sync_gmail_now,
            commands::refresh_account_photos,
            commands::start_watcher,
            commands::send_message,
            commands::save_file_to_downloads,
            commands::download_attachment,
            commands::repair_message_bodies,
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
            // EP-6 multi-provider commands
            commands::discover_imap_settings,
            commands::test_imap_connection,
            commands::add_imap_account,
            commands::sync_account_now,
            commands::start_outlook_oauth,
            // EP-7 commands
            commands::search_messages,
            commands::get_rules,
            commands::save_rule,
            commands::delete_rule,
            commands::get_templates,
            commands::save_template,
            commands::delete_template,
            commands::send_unsubscribe,
            commands::get_client_mode,
            commands::set_client_mode,
            commands::set_notification_pref,
            // EP7 account preferences + signature
            commands::get_account_preferences,
            commands::save_account_preferences,
            commands::get_signature_html,
            commands::save_signature_html,
            // EP7 stage 4 vacation responder
            commands::get_vacation_responder,
            commands::save_vacation_responder,
            commands::delete_vacation_responder,
        ])
        .setup(|app| {
            // On startup, auto-load vault if the path was saved previously.
            // Emitting vault:hydrate-needed after init_vault ensures the frontend
            // re-hydrates even if it called get_vault_path before init_vault finished.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Some(path) = commands::load_saved_vault_path(&app_handle) {
                    match commands::init_vault(&app_handle, &path).await {
                        Ok(()) => { let _ = app_handle.emit("vault:hydrate-needed", ()); }
                        Err(e) => log::error!("Failed to auto-load vault: {e}"),
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Nexus");
}
