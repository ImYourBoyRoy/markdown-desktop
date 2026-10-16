//! Opaque, document-owned video grants and bounded byte-range reads.
use crate::store::{CommandError, SharedState};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};
use tauri::{
    AppHandle, Manager,
    http::{Request, Response},
};

const CHUNK_BYTES: u64 = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Clone)]
pub(crate) struct MediaGrant {
    pub document_id: String,
    pub path: PathBuf,
    pub root: PathBuf,
    pub mime: String,
}

pub(crate) fn grant(
    state: &SharedState,
    document_id: &str,
    path: &Path,
    root: &Path,
    mime: &str,
) -> Result<String, CommandError> {
    let mut state = state
        .lock()
        .map_err(|_| CommandError::Message("media state unavailable".into()))?;
    let token = if let Some((token, _)) = state
        .media_grants
        .iter()
        .find(|(_, grant)| grant.document_id == document_id && grant.path == path)
    {
        token.clone()
    } else {
        if state.media_grants.len() >= 512 {
            return Err(CommandError::Message(
                "Close unused documents before opening more videos".into(),
            ));
        }
        let token = uuid::Uuid::new_v4().to_string();
        state.media_grants.insert(
            token.clone(),
            MediaGrant {
                document_id: document_id.to_owned(),
                path: path.to_owned(),
                root: root.to_owned(),
                mime: mime.to_owned(),
            },
        );
        token
    };
    #[cfg(any(windows, target_os = "android"))]
    let origin = "http://markdown-media.localhost";
    #[cfg(not(any(windows, target_os = "android")))]
    let origin = "markdown-media://localhost";
    Ok(format!("{origin}/{token}"))
}

pub(crate) fn respond(app: &AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let token = request.uri().path().trim_start_matches('/');
    let grant = app
        .state::<SharedState>()
        .lock()
        .ok()
        .and_then(|state| state.media_grants.get(token).cloned());
    let Some(grant) = grant else {
        return failure(404);
    };
    serve(&grant, &request).unwrap_or_else(|_| failure(404))
}

fn failure(status: u16) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .body(Vec::new())
        .expect("static media response")
}

fn range(value: Option<&str>, length: u64) -> Option<(u64, u64)> {
    if length == 0 {
        return None;
    }
    let (start, end) = if let Some(value) = value {
        let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
        if start.is_empty() {
            let suffix = end.parse::<u64>().ok()?;
            if suffix == 0 {
                return None;
            }
            (length.saturating_sub(suffix), length - 1)
        } else {
            let start = start.parse::<u64>().ok()?;
            let end = if end.is_empty() {
                length - 1
            } else {
                end.parse::<u64>().ok()?.min(length - 1)
            };
            (start, end)
        }
    } else {
        (0, length - 1)
    };
    (start <= end && start < length)
        .then_some((start, end.min(start.saturating_add(CHUNK_BYTES - 1))))
}

fn serve(grant: &MediaGrant, request: &Request<Vec<u8>>) -> std::io::Result<Response<Vec<u8>>> {
    if request.method() != "GET" && request.method() != "HEAD" {
        return Ok(failure(405));
    }
    let canonical = grant.path.canonicalize()?;
    if !canonical.starts_with(grant.root.canonicalize()?) || !grant.mime.starts_with("video/") {
        return Ok(failure(403));
    }
    let mut file = File::open(canonical)?;
    let length = file.metadata()?.len();
    if length > MAX_VIDEO_BYTES {
        return Ok(failure(413));
    }
    let requested_range = request
        .headers()
        .get("range")
        .and_then(|value| value.to_str().ok());
    if request.method() == "HEAD" {
        return Ok(Response::builder()
            .status(200)
            .header("Content-Type", &grant.mime)
            .header("Accept-Ranges", "bytes")
            .header("Content-Length", length)
            .header("Cache-Control", "no-store")
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::new())
            .expect("static media metadata response"));
    }
    // The custom-protocol responder owns a bounded Vec, not a streaming
    // socket. Large video clients must request ranges; never invent an
    // unsolicited 206 response or allocate the entire file for a plain GET.
    if requested_range.is_none() && length > CHUNK_BYTES {
        return Ok(Response::builder()
            .status(416)
            .header("Accept-Ranges", "bytes")
            .header("Content-Range", format!("bytes */{length}"))
            .body(Vec::new())
            .expect("static range-required response"));
    }
    let Some((start, end)) = range(requested_range, length) else {
        return Ok(Response::builder()
            .status(416)
            .header("Content-Range", format!("bytes */{length}"))
            .body(Vec::new())
            .expect("static range response"));
    };
    let partial = requested_range.is_some();
    let mut builder = Response::builder()
        .status(if partial { 206 } else { 200 })
        .header("Content-Type", &grant.mime)
        .header("Accept-Ranges", "bytes")
        .header("Content-Length", end - start + 1)
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", "*");
    if partial {
        builder = builder.header("Content-Range", format!("bytes {start}-{end}/{length}"));
    }
    let mut body = Vec::new();
    if request.method() == "GET" {
        file.seek(SeekFrom::Start(start))?;
        file.take(end - start + 1).read_to_end(&mut body)?;
    }
    Ok(builder.body(body).expect("validated media response"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn range_reads_are_bounded_and_reject_invalid_ranges() {
        assert_eq!(range(Some("bytes=2-4"), 10), Some((2, 4)));
        assert_eq!(range(Some("bytes=-3"), 10), Some((7, 9)));
        assert_eq!(
            range(Some("bytes=0-"), CHUNK_BYTES * 4),
            Some((0, CHUNK_BYTES - 1))
        );
        for invalid in ["bytes=10-", "bytes=4-2", "bytes=0-1,4-5", "bytes=-0"] {
            assert_eq!(range(Some(invalid), 10), None);
        }
    }
    #[test]
    fn media_grants_serve_requested_bytes_and_revalidate_the_root() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.mp4");
        std::fs::write(&path, b"0123456789").unwrap();
        let mut grant = MediaGrant {
            document_id: "doc".into(),
            path,
            root: dir.path().to_owned(),
            mime: "video/mp4".into(),
        };
        let request = Request::builder()
            .header("Range", "bytes=2-4")
            .body(Vec::new())
            .unwrap();
        let response = serve(&grant, &request).unwrap();
        assert_eq!(response.status(), 206);
        assert_eq!(response.headers()["Content-Range"], "bytes 2-4/10");
        assert_eq!(response.body(), b"234");
        let head = Request::builder().method("HEAD").body(Vec::new()).unwrap();
        let response = serve(&grant, &head).unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["Content-Length"], "10");
        assert!(response.body().is_empty());
        grant.root = dir.path().join("unrelated");
        std::fs::create_dir(&grant.root).unwrap();
        assert_eq!(serve(&grant, &request).unwrap().status(), 403);
    }
}
