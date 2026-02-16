use git2::{Cred, DiffOptions, Oid, RemoteCallbacks, Repository, Sort, StatusOptions};
use serde::Serialize;
use similar::{ChangeTag, TextDiff};
use std::path::Path;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub file_status: String, // "clean", "modified", "untracked", "staged", "new"
    pub remote_url: Option<String>, // web URL for origin remote (e.g. https://github.com/user/repo)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub oid: String,
    pub message: String,
    pub author: String,
    pub date: i64,
    pub date_relative: String,
}

/// Walk up from `path` and find the git repository root.
pub fn find_repo(path: &Path) -> Option<Repository> {
    Repository::discover(path).ok()
}

/// Get git branch name and file status for the given file path.
pub fn get_file_status(file_path: &Path) -> GitStatus {
    let repo = match find_repo(file_path) {
        Some(r) => r,
        None => {
            return GitStatus {
                is_repo: false,
                branch: None,
                file_status: String::new(),
                remote_url: None,
            }
        }
    };

    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(String::from));

    let workdir = match repo.workdir() {
        Some(w) => w,
        None => {
            return GitStatus {
                is_repo: true,
                branch,
                file_status: "unknown".into(),
                remote_url: None,
            }
        }
    };

    let rel_path = match file_path.strip_prefix(workdir) {
        Ok(p) => p,
        Err(_) => {
            return GitStatus {
                is_repo: true,
                branch,
                file_status: "unknown".into(),
                remote_url: None,
            }
        }
    };

    let mut opts = StatusOptions::new();
    opts.pathspec(rel_path.to_string_lossy().as_ref());
    opts.include_untracked(true);

    let file_status = match repo.statuses(Some(&mut opts)) {
        Ok(statuses) => {
            if statuses.is_empty() {
                "clean".into()
            } else {
                let s = statuses.get(0).unwrap().status();
                if s.is_index_new() {
                    "staged".into()
                } else if s.is_index_modified() || s.is_index_renamed() {
                    "staged".into()
                } else if s.is_wt_modified() {
                    "modified".into()
                } else if s.is_wt_new() {
                    "untracked".into()
                } else if s.is_ignored() {
                    "ignored".into()
                } else {
                    "clean".into()
                }
            }
        }
        Err(_) => "unknown".into(),
    };

    let remote_url = get_remote_web_url(&repo);

    GitStatus {
        is_repo: true,
        branch,
        file_status,
        remote_url,
    }
}

/// Get the commit log for a specific file (only commits that touched it).
pub fn get_file_log(file_path: &Path, limit: usize) -> Result<Vec<CommitInfo>, String> {
    let repo = find_repo(file_path).ok_or("Not a git repository")?;
    let workdir = repo.workdir().ok_or("Bare repository")?;
    let rel_path = file_path
        .strip_prefix(workdir)
        .map_err(|_| "File not inside repository")?;

    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_head().map_err(|e| e.to_string())?;
    revwalk
        .set_sorting(Sort::TIME)
        .map_err(|e| e.to_string())?;

    let mut commits = Vec::new();
    let rel_path_str = rel_path.to_string_lossy().to_string();

    for oid_result in revwalk {
        if commits.len() >= limit {
            break;
        }

        let oid = oid_result.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;

        // Check if this commit touched our file
        if commit_touches_file(&repo, &commit, &rel_path_str) {
            let time = commit.time();
            commits.push(CommitInfo {
                oid: oid.to_string(),
                message: commit
                    .message()
                    .unwrap_or("")
                    .lines()
                    .next()
                    .unwrap_or("")
                    .to_string(),
                author: commit.author().name().unwrap_or("Unknown").to_string(),
                date: time.seconds(),
                date_relative: format_relative_time(time.seconds()),
            });
        }
    }

    Ok(commits)
}

/// Check if a commit modified the given file path.
fn commit_touches_file(repo: &Repository, commit: &git2::Commit, rel_path: &str) -> bool {
    let tree = match commit.tree() {
        Ok(t) => t,
        Err(_) => return false,
    };

    let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());

    let mut diff_opts = DiffOptions::new();
    diff_opts.pathspec(rel_path);

    let diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut diff_opts))
        .ok();

    match diff {
        Some(d) => d.deltas().len() > 0,
        None => false,
    }
}

/// Read the file content at a specific commit.
pub fn get_file_at_commit(file_path: &Path, oid_str: &str) -> Result<String, String> {
    let repo = find_repo(file_path).ok_or("Not a git repository")?;
    let workdir = repo.workdir().ok_or("Bare repository")?;
    let rel_path = file_path
        .strip_prefix(workdir)
        .map_err(|_| "File not inside repository")?;

    let oid = Oid::from_str(oid_str).map_err(|e| format!("Invalid commit ID: {}", e))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("Commit not found: {}", e))?;
    let tree = commit.tree().map_err(|e| e.to_string())?;

    let entry = tree
        .get_path(rel_path)
        .map_err(|_| format!("File not found at commit {}", &oid_str[..7]))?;

    let blob = repo
        .find_blob(entry.id())
        .map_err(|e| format!("Failed to read blob: {}", e))?;

    let content = std::str::from_utf8(blob.content())
        .map_err(|_| "File is not valid UTF-8".to_string())?;

    Ok(content.to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub tag: String, // "equal", "insert", "delete"
    pub content: String,
    pub old_line: Option<usize>,
    pub new_line: Option<usize>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub lines: Vec<DiffLine>,
    pub additions: usize,
    pub deletions: usize,
}

/// Compute a line-level diff between two strings.
pub fn compute_diff(old_text: &str, new_text: &str) -> DiffResult {
    let diff = TextDiff::from_lines(old_text, new_text);
    let mut lines = Vec::new();
    let mut additions = 0usize;
    let mut deletions = 0usize;
    let mut old_line = 1usize;
    let mut new_line = 1usize;

    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Equal => {
                lines.push(DiffLine {
                    tag: "equal".into(),
                    content: change.value().to_string(),
                    old_line: Some(old_line),
                    new_line: Some(new_line),
                });
                old_line += 1;
                new_line += 1;
            }
            ChangeTag::Delete => {
                deletions += 1;
                lines.push(DiffLine {
                    tag: "delete".into(),
                    content: change.value().to_string(),
                    old_line: Some(old_line),
                    new_line: None,
                });
                old_line += 1;
            }
            ChangeTag::Insert => {
                additions += 1;
                lines.push(DiffLine {
                    tag: "insert".into(),
                    content: change.value().to_string(),
                    old_line: None,
                    new_line: Some(new_line),
                });
                new_line += 1;
            }
        }
    }

    DiffResult {
        lines,
        additions,
        deletions,
    }
}

/// Get the file content at a commit, or the working copy if oid is None.
pub fn get_file_content(file_path: &Path, oid_str: Option<&str>) -> Result<String, String> {
    match oid_str {
        Some(oid) => get_file_at_commit(file_path, oid),
        None => std::fs::read_to_string(file_path)
            .map_err(|e| format!("Failed to read working copy: {}", e)),
    }
}

/// Convert the origin remote URL to a web URL.
/// Handles SSH (`git@host:user/repo.git`) and HTTPS (`https://host/user/repo.git`).
fn get_remote_web_url(repo: &Repository) -> Option<String> {
    let remote = repo.find_remote("origin").ok()?;
    let url = remote.url()?;

    if let Some(rest) = url.strip_prefix("git@") {
        // git@github.com:user/repo.git → https://github.com/user/repo
        let (host, path) = rest.split_once(':')?;
        let path = path.strip_suffix(".git").unwrap_or(path);
        Some(format!("https://{}/{}", host, path))
    } else if url.starts_with("https://") || url.starts_with("http://") {
        // https://github.com/user/repo.git → https://github.com/user/repo
        let url = url.strip_suffix(".git").unwrap_or(url);
        Some(url.to_string())
    } else if let Some(rest) = url.strip_prefix("ssh://") {
        // ssh://git@github.com/user/repo.git → https://github.com/user/repo
        let rest = rest.strip_prefix("git@").unwrap_or(rest);
        let rest = rest.strip_suffix(".git").unwrap_or(rest);
        Some(format!("https://{}", rest))
    } else {
        None
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
    pub web_url: Option<String>,
}

/// Get info about the origin remote.
pub fn get_remote_info(file_path: &Path) -> Result<Option<RemoteInfo>, String> {
    let repo = find_repo(file_path).ok_or("Not a git repository")?;
    let remote = match repo.find_remote("origin") {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };
    let url = remote.url().unwrap_or("").to_string();
    let web_url = get_remote_web_url(&repo);
    Ok(Some(RemoteInfo {
        name: "origin".into(),
        url,
        web_url,
    }))
}

/// Stage a file and create a commit.
pub fn commit_file(file_path: &Path, message: &str) -> Result<CommitInfo, String> {
    let repo = find_repo(file_path).ok_or("Not a git repository")?;
    let workdir = repo.workdir().ok_or("Bare repository")?;
    let rel_path = file_path
        .strip_prefix(workdir)
        .map_err(|_| "File not inside repository")?;

    // Stage the file
    let mut index = repo.index().map_err(|e| format!("Failed to get index: {}", e))?;
    index
        .add_path(rel_path)
        .map_err(|e| format!("Failed to stage file: {}", e))?;
    index
        .write()
        .map_err(|e| format!("Failed to write index: {}", e))?;

    let tree_oid = index
        .write_tree()
        .map_err(|e| format!("Failed to write tree: {}", e))?;
    let tree = repo
        .find_tree(tree_oid)
        .map_err(|e| format!("Failed to find tree: {}", e))?;

    let sig = repo
        .signature()
        .map_err(|e| format!("Failed to get signature (check git config user.name/email): {}", e))?;

    let parent = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent.iter().collect();

    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .map_err(|e| format!("Failed to create commit: {}", e))?;

    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("Failed to find new commit: {}", e))?;
    let time = commit.time();

    Ok(CommitInfo {
        oid: oid.to_string(),
        message: message.lines().next().unwrap_or("").to_string(),
        author: sig.name().unwrap_or("Unknown").to_string(),
        date: time.seconds(),
        date_relative: format_relative_time(time.seconds()),
    })
}

/// Push to the origin remote. Requires a GitHub token for HTTPS auth.
/// Converts SSH remotes to HTTPS automatically.
pub fn push_to_remote(file_path: &Path, token: &str) -> Result<(), String> {
    let repo = find_repo(file_path).ok_or("Not a git repository")?;
    let origin = repo
        .find_remote("origin")
        .map_err(|e| format!("No origin remote: {}", e))?;
    let origin_url = origin.url().unwrap_or("").to_string();
    drop(origin);

    let https_url = to_https_url(&origin_url)
        .ok_or("Cannot convert remote URL to HTTPS")?;

    let head = repo.head().map_err(|e| format!("No HEAD: {}", e))?;
    let branch = head
        .shorthand()
        .ok_or("Detached HEAD — cannot push")?
        .to_string();
    let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);

    let mut callbacks = RemoteCallbacks::new();
    let token = token.to_string();
    callbacks.credentials(move |_url, _username, _allowed| {
        Cred::userpass_plaintext("x-access-token", &token)
    });

    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(callbacks);

    // Use a temporary anonymous remote with the HTTPS URL
    let mut remote = repo
        .remote_anonymous(&https_url)
        .map_err(|e| format!("Failed to create HTTPS remote: {}", e))?;

    remote
        .push(&[&refspec], Some(&mut push_opts))
        .map_err(|e| format!("Push failed: {}", e))?;

    Ok(())
}

/// Pull (fetch + fast-forward) from origin. Requires a GitHub token for HTTPS auth.
/// Converts SSH remotes to HTTPS automatically.
pub fn pull_from_remote(file_path: &Path, token: &str) -> Result<String, String> {
    let repo = find_repo(file_path).ok_or("Not a git repository")?;
    let origin = repo
        .find_remote("origin")
        .map_err(|e| format!("No origin remote: {}", e))?;
    let origin_url = origin.url().unwrap_or("").to_string();
    drop(origin);

    let https_url = to_https_url(&origin_url)
        .ok_or("Cannot convert remote URL to HTTPS")?;

    let head_ref = repo.head().map_err(|e| format!("No HEAD: {}", e))?;
    let branch = head_ref
        .shorthand()
        .ok_or("Detached HEAD — cannot pull")?
        .to_string();

    // Fetch via HTTPS
    let mut callbacks = RemoteCallbacks::new();
    let token = token.to_string();
    callbacks.credentials(move |_url, _username, _allowed| {
        Cred::userpass_plaintext("x-access-token", &token)
    });

    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);

    // Fetch into FETCH_HEAD using anonymous HTTPS remote
    let mut remote = repo
        .remote_anonymous(&https_url)
        .map_err(|e| format!("Failed to create HTTPS remote: {}", e))?;

    remote
        .fetch(&[&branch], Some(&mut fetch_opts), None)
        .map_err(|e| format!("Fetch failed: {}", e))?;

    // The anonymous remote writes to FETCH_HEAD
    let fetch_head = repo
        .find_reference("FETCH_HEAD")
        .map_err(|e| format!("Cannot find FETCH_HEAD: {}", e))?;
    let fetch_commit = repo
        .reference_to_annotated_commit(&fetch_head)
        .map_err(|e| format!("Cannot resolve fetch head: {}", e))?;

    let (analysis, _) = repo
        .merge_analysis(&[&fetch_commit])
        .map_err(|e| format!("Merge analysis failed: {}", e))?;

    if analysis.is_up_to_date() {
        return Ok("Already up to date.".into());
    }

    if analysis.is_fast_forward() {
        let target_oid = fetch_commit.id();
        let mut reference = repo
            .find_reference(&format!("refs/heads/{}", branch))
            .map_err(|e| format!("Cannot find local branch: {}", e))?;
        reference
            .set_target(target_oid, "fast-forward pull")
            .map_err(|e| format!("Failed to fast-forward: {}", e))?;
        repo.set_head(&format!("refs/heads/{}", branch))
            .map_err(|e| format!("Failed to set HEAD: {}", e))?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
            .map_err(|e| format!("Failed to checkout: {}", e))?;
        return Ok("Fast-forwarded successfully.".into());
    }

    Err("Cannot fast-forward. Please use a full git client to merge or rebase.".into())
}

/// Convert a remote URL (SSH or HTTPS) to an HTTPS URL for token-based auth.
/// git@github.com:user/repo.git → https://github.com/user/repo.git
fn to_https_url(url: &str) -> Option<String> {
    if url.starts_with("https://") || url.starts_with("http://") {
        Some(url.to_string())
    } else if let Some(rest) = url.strip_prefix("git@") {
        let (host, path) = rest.split_once(':')?;
        Some(format!("https://{}/{}", host, path))
    } else if let Some(rest) = url.strip_prefix("ssh://") {
        let rest = rest.strip_prefix("git@").unwrap_or(rest);
        Some(format!("https://{}", rest))
    } else {
        None
    }
}

/// Format a unix timestamp as a relative time string.
fn format_relative_time(epoch_secs: i64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let diff = now - epoch_secs;
    if diff < 0 {
        return "in the future".into();
    }

    let minutes = diff / 60;
    let hours = minutes / 60;
    let days = hours / 24;
    let weeks = days / 7;
    let months = days / 30;
    let years = days / 365;

    if minutes < 1 {
        "just now".into()
    } else if minutes < 60 {
        format!(
            "{} minute{} ago",
            minutes,
            if minutes == 1 { "" } else { "s" }
        )
    } else if hours < 24 {
        format!("{} hour{} ago", hours, if hours == 1 { "" } else { "s" })
    } else if days < 7 {
        format!("{} day{} ago", days, if days == 1 { "" } else { "s" })
    } else if weeks < 5 {
        format!("{} week{} ago", weeks, if weeks == 1 { "" } else { "s" })
    } else if months < 12 {
        format!(
            "{} month{} ago",
            months,
            if months == 1 { "" } else { "s" }
        )
    } else {
        format!("{} year{} ago", years, if years == 1 { "" } else { "s" })
    }
}
