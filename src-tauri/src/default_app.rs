//! ./src-tauri/src/default_app.rs
//! Make Markdown Desktop the default handler for supported Markdown types.
//!
//! Contract: the frontend must pass `confirmed: true` only after the user
//! approves an in-app prompt. Windows never writes UserChoice (OS-blocked);
//! it opens Settings so the user confirms there. macOS/Linux apply handlers
//! only after that explicit confirmation.

use serde::Serialize;

#[cfg(windows)]
const PRODUCT_NAME: &str = "Markdown Desktop";
#[cfg(target_os = "macos")]
const BUNDLE_ID: &str = "com.markdownnative.desktop";
const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkdown"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultAppAction {
    /// Human-readable status for the UI.
    pub message: String,
    /// Platform that handled the request.
    pub platform: &'static str,
    /// True when this process changed OS defaults (macOS/Linux after confirm).
    /// Always false on Windows — Settings confirmation is required there.
    pub applied_locally: bool,
}

#[tauri::command]
pub fn request_default_markdown_app(confirmed: bool) -> Result<DefaultAppAction, String> {
    if !confirmed {
        return Err(
            "Confirm that you want Markdown Desktop to become the default Markdown app.".into(),
        );
    }

    #[cfg(windows)]
    {
        windows_request_default()
    }
    #[cfg(target_os = "macos")]
    {
        macos_request_default()
    }
    #[cfg(target_os = "linux")]
    {
        linux_request_default()
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        Err("Default-app setup is not supported on this platform.".into())
    }
}

#[cfg(windows)]
fn windows_request_default() -> Result<DefaultAppAction, String> {
    // Windows 10+ blocks silent defaults and ignores Open With “Always”
    // registration flags. The supported path is Default Apps Settings.
    let uri = if registry_value_exists(r"HKCU\Software\RegisteredApplications", PRODUCT_NAME) {
        windows_registered_app_uri("registeredAppUser", PRODUCT_NAME)
    } else if registry_value_exists(r"HKLM\Software\RegisteredApplications", PRODUCT_NAME) {
        windows_registered_app_uri("registeredAppMachine", PRODUCT_NAME)
    } else {
        // Fall back to the .md picker; Capabilities registration from a
        // current installer enables the richer per-app page above.
        "ms-settings:defaultapps?fileExt=.md".to_string()
    };

    open_windows_uri(&uri)?;
    Ok(DefaultAppAction {
        message: format!(
            "Opened Windows Default Apps. Enable Markdown Desktop for {} — Windows requires that approval in Settings (apps cannot set defaults silently).",
            markdown_extension_list()
        ),
        platform: "windows",
        applied_locally: false,
    })
}

#[cfg(windows)]
fn windows_registered_app_uri(kind: &str, app_name: &str) -> String {
    format!(
        "ms-settings:defaultapps?{kind}={}",
        encode_settings_query_value(app_name)
    )
}

/// Settings parses the registered-app name like a query parameter; escape it
/// the same way Chromium and Microsoft samples do (including `+`).
#[cfg(windows)]
fn encode_settings_query_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn markdown_extension_list() -> String {
    MARKDOWN_EXTENSIONS
        .iter()
        .map(|extension| format!(".{extension}"))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(windows)]
fn registry_value_exists(key: &str, value_name: &str) -> bool {
    std::process::Command::new("reg")
        .args(["query", key, "/v", value_name])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(windows)]
fn open_windows_uri(uri: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // `start` needs an empty window title when the URI contains special chars.
    let status = std::process::Command::new("cmd")
        .args(["/C", "start", "", uri])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|error| format!("Could not open Windows Settings: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "Could not open Windows Settings (exit {}).",
            status.code().unwrap_or(-1)
        ))
    }
}

#[cfg(target_os = "macos")]
fn macos_request_default() -> Result<DefaultAppAction, String> {
    let mut applied = 0usize;
    let mut failures = Vec::new();

    // Markdown-specific UTIs only — never claim public.plain-text.
    for uti in [
        "com.markdownnative.desktop.markdown",
        "net.daringfireball.markdown",
        "public.markdown",
    ] {
        match macos::set_default_role_handler(uti, BUNDLE_ID) {
            Ok(()) => applied += 1,
            Err(error) => failures.push(format!("{uti}: {error}")),
        }
    }

    for extension in MARKDOWN_EXTENSIONS {
        match macos::uti_for_filename_extension(extension) {
            Ok(uti) => match macos::set_default_role_handler(&uti, BUNDLE_ID) {
                Ok(()) => applied += 1,
                Err(error) => failures.push(format!(".{extension} ({uti}): {error}")),
            },
            Err(error) => failures.push(format!(".{extension}: {error}")),
        }
    }

    if applied == 0 {
        return Err(format!(
            "Could not update macOS default handlers. {}",
            failures.join("; ")
        ));
    }

    let warning = if failures.is_empty() {
        String::new()
    } else {
        format!(
            " Some types may still need System Settings ({})",
            failures.join("; ")
        )
    };

    Ok(DefaultAppAction {
        message: format!(
            "Markdown Desktop is now the default for {} on this Mac (you confirmed in the app).{}",
            markdown_extension_list(),
            warning
        ),
        platform: "macos",
        applied_locally: true,
    })
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{CString, c_void};
    use std::ptr;

    type CFIndex = isize;
    type CFStringEncoding = u32;
    type CFAllocatorRef = *const c_void;
    type CFStringRef = *const c_void;
    type CFTypeRef = *const c_void;
    type OSStatus = i32;
    type LSRolesMask = u32;

    const K_CF_STRING_ENCODING_UTF8: CFStringEncoding = 0x0800_0100;
    const K_LS_ROLES_ALL: LSRolesMask = 0xFFFF_FFFF;
    const K_UT_TAG_CLASS_FILENAME_EXTENSION: &str = "public.filename-extension";

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFStringCreateWithCString(
            alloc: CFAllocatorRef,
            c_str: *const i8,
            encoding: CFStringEncoding,
        ) -> CFStringRef;
        fn CFRelease(cf_type: CFTypeRef);
    }

    #[link(name = "CoreServices", kind = "framework")]
    unsafe extern "C" {
        fn LSSetDefaultRoleHandlerForContentType(
            in_content_type: CFStringRef,
            in_role: LSRolesMask,
            in_handler_bundle_id: CFStringRef,
        ) -> OSStatus;
        fn UTTypeCreatePreferredIdentifierForTag(
            in_tag_class: CFStringRef,
            in_tag: CFStringRef,
            in_conforming_to_uti: CFStringRef,
        ) -> CFStringRef;
        fn CFStringGetLength(the_string: CFStringRef) -> CFIndex;
        fn CFStringGetCString(
            the_string: CFStringRef,
            buffer: *mut i8,
            buffer_size: CFIndex,
            encoding: CFStringEncoding,
        ) -> u8;
    }

    struct CfString(CFStringRef);

    impl CfString {
        fn new(value: &str) -> Result<Self, String> {
            let c_string =
                CString::new(value).map_err(|_| "invalid string for CoreFoundation".to_string())?;
            let raw = unsafe {
                CFStringCreateWithCString(ptr::null(), c_string.as_ptr(), K_CF_STRING_ENCODING_UTF8)
            };
            if raw.is_null() {
                return Err("CFStringCreateWithCString failed".into());
            }
            Ok(Self(raw))
        }

        fn as_ptr(&self) -> CFStringRef {
            self.0
        }

        fn to_string(&self) -> Result<String, String> {
            unsafe {
                let length = CFStringGetLength(self.0);
                // UTF-8 worst case: 4 bytes/char + NUL
                let mut buffer = vec![0i8; (length as usize * 4) + 1];
                let ok = CFStringGetCString(
                    self.0,
                    buffer.as_mut_ptr(),
                    buffer.len() as CFIndex,
                    K_CF_STRING_ENCODING_UTF8,
                );
                if ok == 0 {
                    return Err("CFStringGetCString failed".into());
                }
                let c_str = std::ffi::CStr::from_ptr(buffer.as_ptr());
                c_str
                    .to_str()
                    .map(|value| value.to_string())
                    .map_err(|_| "UTI was not valid UTF-8".into())
            }
        }
    }

    impl Drop for CfString {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) }
            }
        }
    }

    pub fn set_default_role_handler(uti: &str, bundle_id: &str) -> Result<(), String> {
        let uti = CfString::new(uti)?;
        let bundle = CfString::new(bundle_id)?;
        let status = unsafe {
            LSSetDefaultRoleHandlerForContentType(uti.as_ptr(), K_LS_ROLES_ALL, bundle.as_ptr())
        };
        if status == 0 {
            Ok(())
        } else {
            Err(format!(
                "LSSetDefaultRoleHandlerForContentType failed ({status})"
            ))
        }
    }

    pub fn uti_for_filename_extension(extension: &str) -> Result<String, String> {
        let tag_class = CfString::new(K_UT_TAG_CLASS_FILENAME_EXTENSION)?;
        let tag = CfString::new(extension)?;
        let uti_ref = unsafe {
            UTTypeCreatePreferredIdentifierForTag(tag_class.as_ptr(), tag.as_ptr(), ptr::null())
        };
        if uti_ref.is_null() {
            return Err("no UTI for extension".into());
        }
        let uti = CfString(uti_ref);
        uti.to_string()
    }
}

#[cfg(target_os = "linux")]
fn linux_request_default() -> Result<DefaultAppAction, String> {
    let desktop_id = resolve_linux_desktop_id().ok_or_else(|| {
        "Could not find a Markdown Desktop desktop entry. Install the .deb, .rpm, or AppImage package, then try again.".to_string()
    })?;

    let mimes = ["text/markdown", "text/x-markdown", "text/x-web-markdown"];
    let mut ok = 0usize;
    let mut errors = Vec::new();
    for mime in mimes {
        match std::process::Command::new("xdg-mime")
            .args(["default", &desktop_id, mime])
            .status()
        {
            Ok(status) if status.success() => ok += 1,
            Ok(status) => errors.push(format!("{mime} exited {}", status.code().unwrap_or(-1))),
            Err(error) => errors.push(format!("{mime}: {error}")),
        }
    }

    if ok == 0 {
        return Err(format!(
            "xdg-mime could not set defaults for {desktop_id}. {}",
            errors.join("; ")
        ));
    }

    Ok(DefaultAppAction {
        message: format!(
            "Markdown Desktop ({desktop_id}) is now the default for Markdown MIME types covering {} (you confirmed in the app).",
            markdown_extension_list()
        ),
        platform: "linux",
        applied_locally: true,
    })
}

#[cfg(target_os = "linux")]
fn resolve_linux_desktop_id() -> Option<String> {
    const CANDIDATES: &[&str] = &[
        "markdown-desktop.desktop",
        "com.markdownnative.desktop.desktop",
        "Markdown Desktop.desktop",
    ];

    for candidate in CANDIDATES {
        if linux_desktop_entry_exists(candidate) {
            return Some((*candidate).to_string());
        }
    }

    // Do not reuse the current default based on a name substring: another
    // Markdown application could legitimately own that desktop ID. A
    // package-installed entry must be present before xdg-mime can register
    // this application as a default.
    None
}

#[cfg(target_os = "linux")]
fn linux_desktop_entry_exists(desktop_id: &str) -> bool {
    let mut dirs = Vec::new();
    if let Ok(data_home) = std::env::var("XDG_DATA_HOME") {
        dirs.push(std::path::PathBuf::from(data_home));
    } else if let Ok(home) = std::env::var("HOME") {
        dirs.push(std::path::PathBuf::from(home).join(".local/share"));
    }
    if let Ok(data_dirs) = std::env::var("XDG_DATA_DIRS") {
        dirs.extend(data_dirs.split(':').map(std::path::PathBuf::from));
    } else {
        dirs.push(std::path::PathBuf::from("/usr/local/share"));
        dirs.push(std::path::PathBuf::from("/usr/share"));
    }

    dirs.into_iter()
        .any(|dir| dir.join("applications").join(desktop_id).is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unconfirmed_requests() {
        let error = request_default_markdown_app(false).expect_err("must require confirmation");
        assert!(error.to_ascii_lowercase().contains("confirm"));
    }

    #[test]
    #[cfg(windows)]
    fn encodes_product_name_for_settings_query() {
        assert_eq!(
            encode_settings_query_value("Markdown Desktop"),
            "Markdown%20Desktop"
        );
        assert_eq!(encode_settings_query_value("App+Name"), "App%2BName");
    }

    #[test]
    fn lists_all_supported_extensions() {
        assert_eq!(markdown_extension_list(), ".md, .markdown, .mdown, .mkdown");
    }

    #[cfg(windows)]
    #[test]
    fn builds_registered_app_uri() {
        assert_eq!(
            windows_registered_app_uri("registeredAppUser", "Markdown Desktop"),
            "ms-settings:defaultapps?registeredAppUser=Markdown%20Desktop"
        );
    }
}
