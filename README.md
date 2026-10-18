# NotebookPress

Export Jupyter notebooks from Visual Studio Code to clean, readable PDF documents.

## Features

- Export the active Jupyter notebook to PDF.
- Choose where to save the generated PDF.
- Preserve notebook text, code cells, and supported chart images.
- Render Markdown content, including headings, paragraphs, and lists.
- Format code cells using a readable monospace font.
- Add document metadata and page numbers.
- Open the exported PDF directly from the success notification.

## Requirements

- Visual Studio Code
- A Jupyter notebook opened in VS Code

## Usage

1. Open a Jupyter notebook in Visual Studio Code.
2. Open the Command Palette using `Ctrl+Shift+P`.
3. Run **NotebookPress: Export Notebook to Smart PDF**.
4. Choose the destination and filename.
5. Wait for the export to finish. Select **Open PDF** in the notification to view the result.

## Notes

- PDF output is intended for readable notebook reports.
- Rendering may vary depending on notebook output types and embedded content.
- Save your notebook before exporting to ensure the latest changes are included.

## Support

If an export fails, check the error message shown by NotebookPress and verify that the destination folder is writable.