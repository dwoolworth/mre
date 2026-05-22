use comrak::{markdown_to_html, Options};
use regex::Regex;

/// Escape `>=` at the start of list items so `>` isn't parsed as a blockquote.
/// In markdown, `>` after a list marker starts a nested blockquote, but `>=` is
/// almost always the "greater than or equal to" operator.
pub(crate) fn preprocess_markdown(input: &str) -> String {
    let re = Regex::new(r"(?m)^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)>=").unwrap();
    re.replace_all(input, "${1}\\>=").to_string()
}

pub fn render_markdown(input: &str) -> String {
    let input = preprocess_markdown(input);
    let mut options = Options::default();

    // Enable GFM extensions
    options.extension.strikethrough = true;
    options.extension.table = true;
    options.extension.autolink = true;
    options.extension.tasklist = true;
    options.extension.footnotes = true;
    options.extension.header_ids = Some(String::new());
    options.extension.shortcodes = true;

    // Parse options
    options.parse.smart = true;

    // Render options
    options.render.unsafe_ = true; // Allow raw HTML in markdown
    // Treat single newlines as hard line breaks. CommonMark would merge
    // consecutive non-blank lines into one paragraph, but users editing
    // documents in this app expect WYSIWYG-style line breaks.
    options.render.hardbreaks = true;

    markdown_to_html(&input, &options)
}
