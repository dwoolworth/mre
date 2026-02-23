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

pub fn export_svg_to_pdf(svg_content: &str, output_path: &Path, landscape: bool) -> Result<(), String> {
    // Rasterize SVG to PNG using resvg (properly renders SVG text with system fonts)
    let mut options = usvg::Options::default();
    options.fontdb_mut().load_system_fonts();

    let tree = usvg::Tree::from_str(svg_content, &options)
        .map_err(|e| format!("Failed to parse SVG: {e}"))?;

    let size = tree.size();
    let scale = 3.0_f32; // 3x for high-quality rasterization
    let width_px = (size.width() * scale) as u32;
    let height_px = (size.height() * scale) as u32;

    let mut pixmap = tiny_skia::Pixmap::new(width_px, height_px)
        .ok_or("Failed to create pixmap")?;
    pixmap.fill(tiny_skia::Color::WHITE);

    let transform = tiny_skia::Transform::from_scale(scale, scale);
    resvg::render(&tree, transform, &mut pixmap.as_mut());

    let png_data = pixmap.encode_png().map_err(|e| format!("Failed to encode PNG: {e}"))?;

    // Write PNG to temp file for typst to reference
    let temp_dir = std::env::temp_dir();
    let png_path = temp_dir.join("mre_diagram.png");
    fs::write(&png_path, &png_data).map_err(|e| format!("Failed to write temp PNG: {e}"))?;

    let (page_width, page_height) = if landscape { ("11in", "8.5in") } else { ("8.5in", "11in") };

    let typst_source = format!(
        r#"#set page(width: {page_width}, height: {page_height}, margin: 0.25in)
#align(center + horizon)[
  #image("mre_diagram.png", width: 100%, height: 100%, fit: "contain")
]"#
    );

    let engine = TypstEngine::builder()
        .main_file(typst_source)
        .with_file_system_resolver(&temp_dir)
        .search_fonts_with(
            TypstKitFontOptions::default()
                .include_system_fonts(true)
                .include_embedded_fonts(true),
        )
        .build();

    let doc: PagedDocument = engine
        .compile()
        .output
        .map_err(|e| format!("Typst compilation error: {e:?}"))?;

    let pdf_bytes = typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default())
        .map_err(|e| format!("PDF generation error: {e:?}"))?;

    fs::write(output_path, pdf_bytes).map_err(|e| format!("Failed to write PDF: {e}"))?;

    // Clean up temp file
    let _ = fs::remove_file(&png_path);

    Ok(())
}

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
