---
name: markitdown
description: Convert files (PDF, Word, PowerPoint, Excel, HTML, CSV, JSON, images, audio, ZIP, EPub, YouTube URLs) to Markdown using Microsoft MarkItDown. Use when the user wants to read, extract, or convert a document's content to Markdown — especially PDFs, .docx, .pptx, .xlsx — or explicitly asks to "markitdown" a file.
---

# MarkItDown — convert documents to Markdown

Use the `markitdown` command-line tool (Microsoft MarkItDown) to convert a wide
range of file types into clean Markdown for reading, extraction, or downstream
processing.

## Setup

`markitdown` is installed automatically at session start by the SessionStart
hook in `.claude/settings.json`. If the command is missing, install it:

```bash
pip install 'markitdown[pdf,docx,pptx,xlsx]'
```

Verify it is available:

```bash
markitdown --version
```

To use a custom build (e.g. a fork with local changes), install from source
instead — for this repo's origin fork:

```bash
pip install 'git+https://github.com/kailau032-hub/markitdown.git#subdirectory=packages/markitdown'
```

## Usage

Convert a file and print Markdown to stdout:

```bash
markitdown path/to/file.pdf
```

Write the Markdown to a file (preferred for large documents — don't dump big
output into the terminal):

```bash
markitdown path/to/file.pdf -o output.md
```

Read from stdin:

```bash
cat file.pdf | markitdown > output.md
```

## Supported inputs

PDF, Word (`.docx`), PowerPoint (`.pptx`), Excel (`.xlsx` / `.xls`), HTML, CSV,
JSON, XML, images (EXIF metadata + OCR), audio (EXIF + speech transcription),
ZIP archives (iterates over contents), EPub, YouTube URLs, and more.

## When to use this vs. the `pdf` skill

- Use **markitdown** for fast, whole-document → Markdown conversion across many
  formats, or whenever the user explicitly asks to "markitdown" a file.
- Use the **`pdf` skill** for PDF-specific operations: merging, splitting,
  rotating, filling forms, page-level table extraction, OCR of scanned PDFs, or
  creating PDFs from scratch.

## Notes

- Scanned or image-only PDFs need OCR — install an OCR-capable extra
  (`markitdown-ocr`) or use the `pdf` skill's OCR path.
- The Read tool renders PDF pages as images (via poppler's `pdftoppm`); use
  markitdown instead when you want the document's **text as Markdown** rather
  than a page image.
