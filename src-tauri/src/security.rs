use anyhow::{Context, Result, anyhow};
use std::net::{IpAddr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use url::Url;

pub fn canonical_existing(path: &str) -> Result<PathBuf> {
    let candidate = PathBuf::from(path);
    let canonical = candidate
        .canonicalize()
        .with_context(|| format!("cannot resolve path: {path}"))?;
    if !canonical.is_file() {
        return Err(anyhow!("path is not a file"));
    }
    Ok(canonical)
}

pub fn canonical_workspace(path: &str) -> Result<PathBuf> {
    let canonical = PathBuf::from(path)
        .canonicalize()
        .with_context(|| format!("cannot resolve workspace: {path}"))?;
    if !canonical.is_dir() {
        return Err(anyhow!("workspace is not a directory"));
    }
    Ok(canonical)
}

pub fn is_markdown(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase())
            .as_deref(),
        Some("md" | "markdown" | "mdown" | "mkdown")
    )
}

pub fn safe_child(root: &Path, relative: &str) -> Result<PathBuf> {
    let canonical_root = root
        .canonicalize()
        .with_context(|| format!("cannot resolve workspace root: {}", root.display()))?;
    let target = root.join(relative.replace('\\', "/"));
    let canonical = target
        .canonicalize()
        .with_context(|| format!("cannot resolve asset: {relative}"))?;
    if !canonical.starts_with(&canonical_root) {
        return Err(anyhow!("asset escapes the authorized workspace"));
    }
    Ok(canonical)
}

pub fn validate_remote_url(raw: &str) -> Result<Url> {
    let parsed = Url::parse(raw).context("invalid remote URL")?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(anyhow!("only HTTP and HTTPS resources are allowed"));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow!("remote URL has no host"))?;
    if host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".localhost")
        || host.ends_with(".local")
    {
        return Err(anyhow!("local network targets are blocked"));
    }
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| anyhow!("URL has no port"))?;
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_ip(ip) {
            return Err(anyhow!("private and loopback targets are blocked"));
        }
    } else if let Ok(addresses) = (host, port).to_socket_addrs()
        && addresses.into_iter().any(|addr| is_private_ip(addr.ip()))
    {
        return Err(anyhow!("remote hostname resolves to a private target"));
    }
    Ok(parsed)
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_broadcast()
                || ip.is_multicast()
                || ip.octets()[0] == 0
                || ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1])
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_multicast()
                || (ip.segments()[0] & 0xffc0) == 0xfe80
                || ip
                    .to_ipv4_mapped()
                    .is_some_and(|mapped| is_private_ip(IpAddr::V4(mapped)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn blocks_unsafe_remote_schemes_and_private_hosts() {
        assert!(validate_remote_url("javascript:alert(1)").is_err());
        assert!(validate_remote_url("http://127.0.0.1/image.png").is_err());
        assert!(validate_remote_url("http://10.0.0.4/image.png").is_err());
        assert!(validate_remote_url("http://[::ffff:127.0.0.1]/image.png").is_err());
        assert!(validate_remote_url("http://[fe80::1]/image.png").is_err());
        assert!(validate_remote_url("http://100.64.0.1/image.png").is_err());
        assert!(validate_remote_url("https://example.com/image.png").is_ok());
    }

    #[test]
    fn safe_child_rejects_traversal_and_external_symlink_targets() {
        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(workspace.path().join("inside.png"), b"ok").unwrap();
        fs::write(outside.path().join("secret.png"), b"secret").unwrap();

        assert!(safe_child(workspace.path(), "../secret.png").is_err());
        assert_eq!(
            safe_child(workspace.path(), "inside.png").unwrap(),
            workspace.path().join("inside.png").canonicalize().unwrap()
        );

        let link = workspace.path().join("outside");
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(outside.path(), &link);
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_dir(outside.path(), &link);
        if linked.is_ok() {
            assert!(safe_child(workspace.path(), "outside/secret.png").is_err());
        }
    }
}
