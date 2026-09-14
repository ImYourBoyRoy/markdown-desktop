#[cfg(test)]
#[allow(clippy::module_inception)]
mod github_host_oracle {
    use serde::Deserialize;
    use std::collections::HashSet;
    use std::fs;
    use std::path::PathBuf;

    use crate::markdown::{self, DEFAULT_COMPATIBILITY_TARGET};

    #[derive(Debug, Deserialize)]
    struct OracleFile {
        version: u32,
        fixtures: Vec<OracleFixture>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct OracleFixture {
        id: String,
        file: String,
        profile: String,
        compatibility_target: String,
        file_name: Option<String>,
        expect: OracleExpectation,
    }

    #[derive(Debug, Deserialize, Default)]
    #[serde(rename_all = "camelCase")]
    struct OracleExpectation {
        heading_slugs: Option<Vec<String>>,
        link_count: Option<usize>,
        html_contains: Option<Vec<String>>,
        html_excludes: Option<Vec<String>>,
        issue_codes_include: Option<Vec<String>>,
        issue_codes_exclude: Option<Vec<String>>,
        min_source_bytes: Option<usize>,
    }

    fn fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/github-readme")
    }

    #[test]
    fn github_host_fixture_oracle_matches_render_evidence() {
        let root = fixture_root();
        let oracle: OracleFile = serde_json::from_str(
            &fs::read_to_string(root.join("oracle.json")).expect("oracle.json"),
        )
        .expect("valid oracle json");

        assert_eq!(oracle.version, 1);

        for fixture in oracle.fixtures {
            let source = fs::read_to_string(root.join(&fixture.file)).unwrap_or_else(|error| {
                panic!("{}: {}", fixture.id, error);
            });
            if let Some(min_bytes) = fixture.expect.min_source_bytes {
                assert!(
                    source.len() >= min_bytes,
                    "{} expected at least {} bytes, got {}",
                    fixture.id,
                    min_bytes,
                    source.len()
                );
            }

            let rendered = markdown::render_for_file_with_target(
                &source,
                &fixture.profile,
                fixture.file_name.as_deref(),
                markdown::normalize_compatibility_target(Some(&fixture.compatibility_target)),
            );

            if let Some(slugs) = &fixture.expect.heading_slugs {
                let actual: Vec<_> = rendered
                    .headings
                    .iter()
                    .map(|heading| heading.slug.clone())
                    .collect();
                assert_eq!(actual, *slugs, "{} heading slugs", fixture.id);
            }
            if let Some(count) = fixture.expect.link_count {
                assert_eq!(rendered.links.len(), count, "{} link count", fixture.id);
            }
            for needle in fixture.expect.html_contains.iter().flatten() {
                assert!(
                    rendered.html.contains(needle),
                    "{} html should contain {needle}",
                    fixture.id
                );
            }
            for needle in fixture.expect.html_excludes.iter().flatten() {
                assert!(
                    !rendered.html.contains(needle),
                    "{} html should exclude {needle}",
                    fixture.id
                );
            }

            let codes: HashSet<_> = rendered
                .issues
                .iter()
                .map(|issue| issue.code.clone())
                .collect();
            for code in fixture.expect.issue_codes_include.iter().flatten() {
                assert!(codes.contains(code), "{} missing issue {code}", fixture.id);
            }
            for code in fixture.expect.issue_codes_exclude.iter().flatten() {
                assert!(
                    !codes.contains(code),
                    "{} should not include issue {code}",
                    fixture.id
                );
            }
        }
    }

    #[test]
    fn github_host_oracle_uses_default_compatibility_target_name() {
        assert_eq!(DEFAULT_COMPATIBILITY_TARGET, "githubReadme");
    }
}
