# arety-office

Arety Office is an offline, WPS-style office suite that runs in the browser, by Syed Abrar Ali. A small FastAPI server on the loopback interface serves a tabbed single-page app: Quill edits word-processing documents, x-spreadsheet edits spreadsheets, and presentations and PDFs are shown as rendered previews. Files on disk stay in their native formats (docx, odt, xlsx, pptx, pdf, markdown and more) because every open and save goes through pandoc, LibreOffice and openpyxl on the machine. It solves the problem of having a quick, cloud-free place to create, browse, edit and convert office documents on a Linux laptop without launching a heavy desktop suite for every small change, while keeping a one-click hand-off to a real desktop office application when full fidelity is needed.

## Where it is used

It runs on the owner's laptop as a user service and is opened at `http://localhost:8792`. A desktop file handler can hand documents to it through `/open?path=...`, so double-clicking a document opens it in a browser tab. It is the everyday editor for notes, simple documents and spreadsheets, a file browser for the Documents folder, and a front end for the owner's local document-conversion script (including OCR of scanned PDFs).

## How it works

### Server (`server.py`)

FastAPI + uvicorn bound to `127.0.0.1`. State on disk: `~/.config/officesuite/recent.json` (recent files, max 60) and `~/.cache/officesuite/` (extracted images and rendered slide PDFs).

Security boundary: `safe(path)` resolves every path the client sends and refuses anything outside `ALLOWED_ROOTS` (home, `/media`, `/mnt`, `/tmp`).

File kinds are decided by extension: `DOC` (docx, doc, odt, rtf, md, txt, html, wps, epub), `SHEET` (xlsx, xls, csv, ods, et), `SLIDES` (pptx, ppt, odp, dps), `PDF`.

| Route | What it does |
| --- | --- |
| `GET /`, `/static/*`, `/media/*` | The app, vendored libraries, extracted document images |
| `GET /open?path=` | Redirects to `/#open=<path>` so the page opens the file in a tab |
| `GET /file?path=` | Streams a file inline (used for PDF previews) |
| `GET /api/recent`, `POST /api/recent/remove` | Recent list (entries whose file disappeared are filtered out) |
| `GET /api/browse?path=&all=` | Folder listing (office files only unless `all`), with "places" shortcuts |
| `GET /api/search?q=&path=` | Walks the tree (skipping dot-folders, `node_modules`, `snap`, `AppData`) for office files by name, max 200 |
| `POST /api/new` | Creates an empty document, spreadsheet or presentation with a unique name: pandoc from an empty markdown source for text formats, `openpyxl.Workbook` for sheets, pandoc for pptx; other extensions go through a LibreOffice conversion of the intermediate file |
| `GET /api/open?path=` | Documents → HTML via pandoc (`--extract-media` into a per-file cache folder, URLs rewritten to `/media/...`; doc/wps/rtf are first converted to docx by LibreOffice; txt is wrapped in paragraphs). Spreadsheets → JSON per sheet (cells with text, bold/italic/underline/colour/fill/alignment styles, merges, column widths; xls/ods/et converted to xlsx first; csv read directly). Slides → cached PDF rendered by LibreOffice. PDFs → served as is. |
| `POST /api/save/doc` | Quill HTML → pandoc to txt/docx/odt/gfm/html/epub, or via docx + LibreOffice for doc/rtf/wps |
| `POST /api/save/sheet` | x-spreadsheet JSON → csv writer, or openpyxl workbook (numbers parsed, formulas kept, styles, merges, widths), then LibreOffice for non-xlsx targets |
| `POST /api/convert` | Calls the external `~/bin/convert-doc [--ocr] <file> <fmt>` helper and returns the produced file |
| `POST /api/export-pdf` | LibreOffice headless to PDF next to the original |
| `POST /api/open-external` | Launches the file in the desktop office app (`~/bin/wps-offline` with a writer/sheets/slides/pdf flag) or with `xdg-open`; `app: "folder"` opens the containing folder |
| `POST /api/fs` | rename, delete, mkdir, copy |
| `POST /api/clientlog` | Front-end errors are logged to the server's stderr for `journalctl` |

### Front end (`static/`)

Plain JavaScript, no build step. `app.js` manages a tab bar (home plus one tab per open document, dirty markers, close confirmation), a home view with New/Recent, a Files browser with places, breadcrumbs, search, "all files" toggle, folder creation and per-item actions, and a Convert page with radio-button target formats and an OCR checkbox. Document tabs mount Quill (full toolbar) on the HTML from the server; sheet tabs mount x-spreadsheet in edit mode and re-render on show/resize; slides and PDFs are iframes. Ctrl+S saves, a toolbar offers Save, Save as, Export PDF, Convert to, Open in WPS and Show folder. The last used folders are remembered in `localStorage`. Vendored libraries live in `static/vendor` (quill.js, xspreadsheet.js and their CSS).

## Setup

Requirements:

- Python 3.10+ with `fastapi`, `uvicorn`, `openpyxl`
- `pandoc`
- LibreOffice (`soffice` on PATH)
- optional: `~/bin/convert-doc` (any script taking `[--ocr] <file> <format>` and printing the output path last) for the Convert page, and `~/bin/wps-offline` for "Open in WPS"; without them those two buttons fail gracefully with an error toast

```bash
git clone https://github.com/USER/arety-office.git ~/officesuite
cd ~/officesuite
python -m venv .venv && . .venv/bin/activate
pip install fastapi uvicorn openpyxl
sudo apt install pandoc libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress
```

Configuration: `OFFICE_PORT` (default 8792). Allowed roots, cache and config paths are constants at the top of `server.py`.

## Usage

```bash
python server.py            # http://127.0.0.1:8792
```

Optional user service (`~/.config/systemd/user/officesuite.service`):

```ini
[Service]
WorkingDirectory=%h/officesuite
ExecStart=%h/officesuite/.venv/bin/python server.py
Restart=on-failure
[Install]
WantedBy=default.target
```

Then `systemctl --user enable --now officesuite` and watch logs with `journalctl --user -u officesuite`.

Desktop integration: a `.desktop` file whose `Exec` is `xdg-open "http://127.0.0.1:8792/open?path=%f"` makes the suite a handler for office MIME types.

Typical actions in the UI:

- Home → Document → name `report.docx`, folder `~/Documents` → edit in Quill → Ctrl+S writes a real docx through pandoc.
- Files → open `budget.xlsx` → edit cells and formulas → Save → Convert to… `pdf`.
- Convert → pick `scan.pdf`, tick "OCR first", choose Word → `scan.docx` appears next to the original.
- Any tab → Open in WPS for features the browser editors lack.

## Project structure

```
officesuite/
├── server.py                 # FastAPI app: browse/open/save/convert/fs routes, pandoc/LibreOffice/openpyxl glue
├── static/
│   ├── index.html            # tab bar, home (Start / Files / Convert), modal, toast
│   ├── app.js                # tabs, editors, file browser, convert page, client logging
│   ├── app.css
│   └── vendor/               # quill.js, quill.snow.css, xspreadsheet.js, xspreadsheet.css
└── templates/                # reserved, currently empty
```

## Limitations and notes

- Round-tripping through HTML (Quill) and a cell JSON model (x-spreadsheet) loses features pandoc or openpyxl cannot express: complex docx styles, headers/footers, tracked changes, charts, conditional formatting, number formats. Use "Open in WPS" for documents where that matters.
- Presentations and PDFs are view-only previews; slides are re-rendered to PDF by LibreOffice whenever the source is newer than the cache.
- Formulas in spreadsheets are saved as text and are not recalculated in the browser.
- The server has no authentication and can read, write and delete any file under the allowed roots; it must stay on the loopback interface.
- LibreOffice conversions are slow on first launch and time out after 180 s (600 s for the external converter).
- The Convert page and "Open in WPS" depend on helper scripts outside this repository.
