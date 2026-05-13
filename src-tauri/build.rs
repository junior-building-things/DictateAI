fn main() {
    // Link macOS frameworks needed for accessibility check
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=ApplicationServices");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
        println!("cargo:rustc-link-lib=dylib=objc");

        build_apple_fm_helper();
    }

    tauri_build::build()
}

/// Compile the Swift helper that talks to Apple's Foundation Models framework.
/// Best-effort: if swiftc isn't installed, the source is missing, or the
/// macOS 26 SDK isn't available, we emit a warning and continue. Callers
/// detect a missing helper via `option_env!("APPLE_FM_HELPER_PATH")` and
/// surface a runtime error if the user actually tries to use Apple FM.
#[cfg(target_os = "macos")]
fn build_apple_fm_helper() {
    use std::path::PathBuf;
    use std::process::Command;

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let source = PathBuf::from(&manifest_dir)
        .join("swift")
        .join("apple_fm_helper.swift");

    if !source.exists() {
        println!("cargo:warning=apple_fm_helper.swift missing; Apple FM rewrite disabled");
        return;
    }

    println!("cargo:rerun-if-changed={}", source.display());

    let out_dir = std::env::var("OUT_DIR").unwrap();
    let bin_path = PathBuf::from(&out_dir).join("apple-fm-helper");

    let result = Command::new("swiftc")
        .args([
            "-O",
            // `@main` requires library-style compilation; the default
            // script mode treats top-level code as an implicit main.
            "-parse-as-library",
            "-target",
            "arm64-apple-macos26.0",
            "-o",
        ])
        .arg(&bin_path)
        .arg(&source)
        .output();

    match result {
        Ok(out) if out.status.success() => {
            println!(
                "cargo:rustc-env=APPLE_FM_HELPER_PATH={}",
                bin_path.display()
            );
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            println!(
                "cargo:warning=swiftc failed to build apple_fm_helper (Apple FM rewrite disabled): {}",
                stderr.trim()
            );
        }
        Err(e) => {
            println!(
                "cargo:warning=swiftc not available, Apple FM rewrite disabled: {}",
                e
            );
        }
    }
}
