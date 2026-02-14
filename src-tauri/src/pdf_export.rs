use std::fs;
use std::path::Path;
use typst::layout::PagedDocument;
use typst_as_lib::typst_kit_options::TypstKitFontOptions;
use typst_as_lib::TypstEngine;

use crate::typst_convert::markdown_to_typst;

const TYPST_PREAMBLE: &str = r##"
#set page(paper: "a4", margin: 2.5cm, numbering: "1", number-align: center)
#set text(font: ("Helvetica Neue", "Segoe UI", "Noto Sans", "Libertinus Serif", "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji"), size: __FONT_SIZE__pt, lang: "en")
#set par(leading: 0.65em, justify: true)
#set heading(numbering: none)
#set list(indent: 1em)
#set enum(indent: 1em)

#show heading.where(level: 1): it => {
  set text(size: 1.6em, weight: "bold")
  v(0.8em)
  it
  v(0.4em)
}

#show heading.where(level: 2): it => {
  set text(size: 1.3em, weight: "bold")
  v(0.7em)
  it
  v(0.1em)
  line(length: 100%, stroke: 0.5pt + luma(200))
  v(0.3em)
}

#show heading.where(level: 3): it => {
  set text(size: 1.15em, weight: "bold")
  v(0.6em)
  it
  v(0.2em)
}

#show heading.where(level: 4): it => {
  set text(size: 1.05em, weight: "bold")
  v(0.5em)
  it
  v(0.2em)
}

#show raw.where(block: true): block.with(
  fill: luma(245),
  stroke: 0.5pt + luma(210),
  inset: 10pt,
  radius: 4pt,
  width: 100%,
)

#show raw.where(block: false): box.with(
  fill: luma(240),
  inset: (x: 3pt, y: 0pt),
  outset: (y: 3pt),
  radius: 2pt,
)

#show link: set text(fill: rgb("#0969da"))
#show link: underline

#let blockquote(body) = block(
  width: 100%,
  inset: (left: 12pt, y: 4pt, right: 4pt),
  stroke: (left: 3pt + luma(200)),
  body,
)

#let task(checked, body) = {
  let marker = if checked { sym.ballot.check } else { sym.ballot }
  [#marker #body]
}

#let hrule() = {
  v(0.5em)
  line(length: 100%, stroke: 0.5pt + luma(180))
  v(0.5em)
}

"##;

pub fn export_pdf(markdown: &str, source_path: &Path, output_path: &Path, font_size: f32) -> Result<(), String> {
    let base_dir = source_path.parent().unwrap_or(Path::new("/"));

    // Convert markdown to Typst markup
    let typst_body = markdown_to_typst(markdown, base_dir);

    // Prepend preamble with user's font size
    let preamble = TYPST_PREAMBLE.replace("__FONT_SIZE__", &format!("{font_size}"));
    let full_source = format!("{preamble}{typst_body}");

    // Build Typst engine with embedded fonts
    let engine = TypstEngine::builder()
        .main_file(full_source)
        .search_fonts_with(
            TypstKitFontOptions::default()
                .include_system_fonts(true)
                .include_embedded_fonts(true),
        )
        .build();

    // Compile to PagedDocument
    let doc: PagedDocument = engine
        .compile()
        .output
        .map_err(|e| format!("Typst compilation error: {e:?}"))?;

    // Render to PDF bytes
    let pdf_bytes = typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default())
        .map_err(|e| format!("PDF generation error: {e:?}"))?;

    // Write to output path
    fs::write(output_path, pdf_bytes).map_err(|e| format!("Failed to write PDF: {e}"))?;

    Ok(())
}
