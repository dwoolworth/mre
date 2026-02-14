use comrak::nodes::{ListType, NodeValue, TableAlignment};
use comrak::{parse_document, Arena, Options};
use std::collections::HashMap;
use std::path::Path;

/// Convert markdown text to Typst markup.
pub fn markdown_to_typst(markdown: &str, base_dir: &Path) -> String {
    let markdown = crate::markdown::preprocess_markdown(markdown);
    let arena = Arena::new();
    let mut options = Options::default();
    options.extension.strikethrough = true;
    options.extension.table = true;
    options.extension.autolink = true;
    options.extension.tasklist = true;
    options.extension.footnotes = true;
    options.parse.smart = true;

    let root = parse_document(&arena, &markdown, &options);

    // First pass: collect footnote definitions
    let mut footnotes: HashMap<String, String> = HashMap::new();
    for node in root.descendants() {
        let val = node.data.borrow();
        if let NodeValue::FootnoteDefinition(ref def) = val.value {
            let name = def.name.clone();
            drop(val);
            let mut body = String::new();
            render_children(node, &mut body, base_dir, &HashMap::new());
            footnotes.insert(name, body.trim().to_string());
        }
    }

    // Second pass: render the document
    let mut out = String::new();
    render_children(root, &mut out, base_dir, &footnotes);
    out
}

fn render_children<'a>(
    node: &'a comrak::arena_tree::Node<'a, std::cell::RefCell<comrak::nodes::Ast>>,
    out: &mut String,
    base_dir: &Path,
    footnotes: &HashMap<String, String>,
) {
    for child in node.children() {
        render_node(child, out, base_dir, footnotes);
    }
}

fn render_node<'a>(
    node: &'a comrak::arena_tree::Node<'a, std::cell::RefCell<comrak::nodes::Ast>>,
    out: &mut String,
    base_dir: &Path,
    footnotes: &HashMap<String, String>,
) {
    let val = node.data.borrow();
    match &val.value {
        NodeValue::Document => {
            drop(val);
            render_children(node, out, base_dir, footnotes);
        }
        NodeValue::Heading(heading) => {
            let level = heading.level as usize;
            drop(val);
            let prefix = "=".repeat(level);
            out.push_str(&prefix);
            out.push(' ');
            render_children(node, out, base_dir, footnotes);
            out.push_str("\n\n");
        }
        NodeValue::Paragraph => {
            drop(val);
            // Check if parent is a list item — don't add extra blank line
            let in_tight_item = is_in_tight_list(node);
            render_children(node, out, base_dir, footnotes);
            if in_tight_item {
                out.push('\n');
            } else {
                out.push_str("\n\n");
            }
        }
        NodeValue::Text(text) => {
            out.push_str(&escape_typst(text));
        }
        NodeValue::Strong => {
            drop(val);
            out.push('*');
            render_children(node, out, base_dir, footnotes);
            out.push('*');
        }
        NodeValue::Emph => {
            drop(val);
            out.push('_');
            render_children(node, out, base_dir, footnotes);
            out.push('_');
        }
        NodeValue::Strikethrough => {
            drop(val);
            out.push_str("#strike[");
            render_children(node, out, base_dir, footnotes);
            out.push(']');
        }
        NodeValue::Code(code) => {
            let literal = &code.literal;
            // Use enough backticks to not conflict with content
            let ticks = if literal.contains('`') { "``" } else { "`" };
            out.push_str(ticks);
            out.push_str(literal);
            out.push_str(ticks);
        }
        NodeValue::CodeBlock(cb) => {
            let lang = cb.info.split_whitespace().next().unwrap_or("");
            out.push_str("```");
            out.push_str(lang);
            out.push('\n');
            out.push_str(&cb.literal);
            if !cb.literal.ends_with('\n') {
                out.push('\n');
            }
            out.push_str("```\n\n");
        }
        NodeValue::Link(link) => {
            let url = link.url.clone();
            drop(val);
            let mut text = String::new();
            render_children(node, &mut text, base_dir, footnotes);
            if text.is_empty() || text == escape_typst(&url) {
                out.push_str(&format!("#link(\"{url}\")"));
            } else {
                out.push_str(&format!("#link(\"{url}\")[{text}]"));
            }
        }
        NodeValue::Image(link) => {
            let url = link.url.clone();
            drop(val);
            if url.starts_with("http://") || url.starts_with("https://") {
                // Remote images: emit alt text placeholder
                let mut alt = String::new();
                render_children(node, &mut alt, base_dir, footnotes);
                if alt.is_empty() {
                    out.push_str("[Image]");
                } else {
                    out.push_str(&format!("[Image: {alt}]"));
                }
            } else {
                // Local image: resolve relative to base_dir
                let resolved = base_dir.join(&url);
                let path_str = resolved.to_string_lossy().replace('\\', "/");
                out.push_str(&format!("#image(\"{path_str}\")"));
            }
        }
        NodeValue::List(_) => {
            drop(val);
            render_children(node, out, base_dir, footnotes);
            // Add blank line after list
            if !out.ends_with("\n\n") {
                out.push('\n');
            }
        }
        NodeValue::Item(list_data) => {
            let is_ordered = list_data.list_type == ListType::Ordered;
            drop(val);

            let marker = if is_ordered { "+ " } else { "- " };
            let mut body = String::new();
            render_children(node, &mut body, base_dir, footnotes);
            let body = body.trim();
            // Indent continuation lines so Typst keeps them in the same list item
            let indented = indent_continuation(body, "  ");
            out.push_str(&format!("{marker}{indented}\n"));
        }
        NodeValue::TaskItem(checked) => {
            let checked_str = if checked.is_some() { "true" } else { "false" };
            drop(val);
            let mut body = String::new();
            render_children(node, &mut body, base_dir, footnotes);
            let body = body.trim();
            let indented = indent_continuation(body, "  ");
            out.push_str(&format!("#task({checked_str})[{indented}]\n"));
        }
        NodeValue::BlockQuote => {
            drop(val);
            let mut body = String::new();
            render_children(node, &mut body, base_dir, footnotes);
            let body = body.trim();
            out.push_str(&format!("#blockquote[{body}]\n\n"));
        }
        NodeValue::Table(table) => {
            let num_cols = table.num_columns;
            let alignments = table.alignments.clone();
            drop(val);

            // Build alignment string
            let align_str: Vec<&str> = alignments
                .iter()
                .map(|a| match a {
                    TableAlignment::Left => "left",
                    TableAlignment::Center => "center",
                    TableAlignment::Right => "right",
                    TableAlignment::None => "auto",
                })
                .collect();

            out.push_str("#table(\n");
            out.push_str(&format!("  columns: {num_cols},\n"));
            out.push_str(&format!(
                "  align: ({}),\n",
                align_str.join(", ")
            ));

            // Render rows
            for row in node.children() {
                let row_val = row.data.borrow();
                let is_header = matches!(row_val.value, NodeValue::TableRow(true));
                drop(row_val);

                if is_header {
                    // All header cells must be inside a single table.header() call
                    out.push_str("  table.header(\n");
                    for cell in row.children() {
                        let mut cell_content = String::new();
                        render_children(cell, &mut cell_content, base_dir, footnotes);
                        let cell_content = cell_content.trim();
                        out.push_str(&format!("    [{cell_content}],\n"));
                    }
                    out.push_str("  ),\n");
                } else {
                    for cell in row.children() {
                        let mut cell_content = String::new();
                        render_children(cell, &mut cell_content, base_dir, footnotes);
                        let cell_content = cell_content.trim();
                        out.push_str(&format!("  [{cell_content}],\n"));
                    }
                }
            }
            out.push_str(")\n\n");
        }
        NodeValue::TableRow(_) | NodeValue::TableCell => {
            // Handled by Table
        }
        NodeValue::ThematicBreak => {
            out.push_str("#hrule()\n\n");
        }
        NodeValue::SoftBreak => {
            out.push(' ');
        }
        NodeValue::LineBreak => {
            out.push_str("\\\n");
        }
        NodeValue::FootnoteDefinition(_) => {
            // Collected in first pass — skip
        }
        NodeValue::FootnoteReference(fnref) => {
            let name = &fnref.name;
            if let Some(content) = footnotes.get(name) {
                out.push_str(&format!("#footnote[{content}]"));
            }
        }
        NodeValue::HtmlBlock(html) => {
            // Try to handle simple <br> tags
            let literal = html.literal.trim();
            if literal == "<br>" || literal == "<br/>" || literal == "<br />" {
                out.push_str("\\\n");
            }
            // Otherwise skip HTML blocks
        }
        NodeValue::HtmlInline(html) => {
            let h = html.trim().to_lowercase();
            if h == "<br>" || h == "<br/>" || h == "<br />" {
                out.push_str("\\\n");
            } else if h == "<sup>" {
                out.push_str("#super[");
            } else if h == "</sup>" {
                out.push(']');
            } else if h == "<sub>" {
                out.push_str("#sub[");
            } else if h == "</sub>" {
                out.push(']');
            }
            // Otherwise skip inline HTML
        }
        // Skip other node types we don't handle
        _ => {
            drop(val);
            render_children(node, out, base_dir, footnotes);
        }
    }
}

fn is_in_tight_list<'a>(
    node: &'a comrak::arena_tree::Node<'a, std::cell::RefCell<comrak::nodes::Ast>>,
) -> bool {
    if let Some(parent) = node.parent() {
        let val = parent.data.borrow();
        if let NodeValue::Item(list_data) = &val.value {
            return list_data.tight;
        }
    }
    false
}

/// Indent all lines after the first by `prefix`, so Typst treats them
/// as continuation content of a list item.
fn indent_continuation(text: &str, prefix: &str) -> String {
    let mut result = String::with_capacity(text.len());
    for (i, line) in text.lines().enumerate() {
        if i > 0 {
            result.push('\n');
            if !line.is_empty() {
                result.push_str(prefix);
            }
        }
        result.push_str(line);
    }
    result
}

/// Escape characters that have special meaning in Typst.
fn escape_typst(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '#' | '*' | '_' | '@' | '$' | '<' | '>' | '\\' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}
