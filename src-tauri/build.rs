fn main() {
    // Ensure QABUDDY_DB_* vars exist at compile time so env!() in db.rs never fails.
    // In CI these are injected from GitHub Secrets. Locally, fall back to empty string.
    for var in &[
        "QABUDDY_DB_HOST",
        "QABUDDY_DB_PORT",
        "QABUDDY_DB_USER",
        "QABUDDY_DB_PASSWORD",
        "QABUDDY_DB_NAME",
    ] {
        if std::env::var(var).is_err() {
            println!("cargo:rustc-env={}=", var);
        }
    }

    tauri_build::build()
}
