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

/// Compile the Swift helper that talks to Apple's Foundation Models framework
/// and place it at a stable path under `src-tauri/binaries/` so Tauri's
/// bundler can include it in `Contents/Resources/`. Without this, the helper
/// would only exist at a `target/.../build/.../out/` path that doesn't survive
/// distribution, and the released DMG would never be able to find it.
///
/// Best-effort: if swiftc isn't installed or the macOS 26 SDK isn't available,
/// we drop in a tiny shell-script stub that just exits with the helper's
/// "model unavailable" code (3). The bundle build still succeeds and runtime
/// degrades gracefully — `apple_fm_availability` returns "unavailable" and
/// users see a clear status in the Models page.
#[cfg(target_os = "macos")]
fn build_apple_fm_helper() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::process::Command;

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let source = PathBuf::from(&manifest_dir)
        .join("swift")
        .join("apple_fm_helper.swift");
    let bundle_dir = PathBuf::from(&manifest_dir).join("binaries");
    let bundle_path = bundle_dir.join("apple-fm-helper");

    // Re-run the build (and re-sign the helper) when the signing identity
    // changes — otherwise switching from ad-hoc dev builds to a notarized
    // release would leave a stale unsigned helper from a prior cargo cache.
    println!("cargo:rerun-if-env-changed=APPLE_SIGNING_IDENTITY");

    // Ensure the directory exists so the Tauri bundler always finds the
    // resource entry it expects, even if compilation fails below.
    let _ = fs::create_dir_all(&bundle_dir);

    if !source.exists() {
        println!("cargo:warning=apple_fm_helper.swift missing; bundling stub");
        write_stub(&bundle_path);
        sign_apple_fm_helper(&bundle_path);
        return;
    }

    println!("cargo:rerun-if-changed={}", source.display());

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
        .arg(&bundle_path)
        .arg(&source)
        .output();

    match result {
        Ok(out) if out.status.success() => {
            // Path is baked into the Rust binary for dev-mode lookups —
            // `cargo run` and `tauri dev` resolve via this env var. Production
            // builds also have it but additionally fall back to the bundled
            // resource path via `current_exe`.
            println!(
                "cargo:rustc-env=APPLE_FM_HELPER_PATH={}",
                bundle_path.display()
            );
            let _ = fs::set_permissions(&bundle_path, fs::Permissions::from_mode(0o755));
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            println!(
                "cargo:warning=swiftc failed to build apple_fm_helper; bundling stub: {}",
                stderr.trim()
            );
            write_stub(&bundle_path);
        }
        Err(e) => {
            println!(
                "cargo:warning=swiftc not available; bundling stub: {}",
                e
            );
            write_stub(&bundle_path);
        }
    }

    // Always (re-)sign the helper at the end of this function, regardless
    // of which branch above produced it. Notarization rejects any embedded
    // Mach-O without a Developer ID signature + hardened runtime + secure
    // timestamp. No-op when `APPLE_SIGNING_IDENTITY` isn't set (dev builds).
    sign_apple_fm_helper(&bundle_path);
}

/// Sign the apple-fm-helper executable with the configured Developer ID
/// identity, hardened runtime, and a secure timestamp — the three boxes
/// Apple's notary service checks for every Mach-O inside the bundle.
/// No-op when `APPLE_SIGNING_IDENTITY` isn't set (development builds).
#[cfg(target_os = "macos")]
fn sign_apple_fm_helper(path: &std::path::Path) {
    use std::process::Command;

    let Ok(identity) = std::env::var("APPLE_SIGNING_IDENTITY") else {
        return;
    };
    if identity.trim().is_empty() || identity.trim() == "-" {
        return;
    }

    let result = Command::new("codesign")
        .args([
            "--force",
            "--options",
            "runtime", // hardened runtime
            "--timestamp", // secure timestamp from Apple's TSA
            "--sign",
            &identity,
        ])
        .arg(path)
        .output();

    match result {
        Ok(out) if out.status.success() => {
            println!(
                "cargo:warning=Signed apple-fm-helper with identity \"{}\"",
                identity
            );
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            println!(
                "cargo:warning=codesign of apple-fm-helper failed (notarization will reject): {}",
                stderr.trim()
            );
        }
        Err(e) => {
            println!("cargo:warning=codesign not available: {}", e);
        }
    }
}

#[cfg(target_os = "macos")]
fn write_stub(path: &std::path::Path) {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    let stub = "#!/bin/sh\n\
        echo 'apple-fm-helper: not built (requires macOS 26 SDK + swiftc at build time)' 1>&2\n\
        exit 3\n";
    let _ = fs::write(path, stub);
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o755));
}
