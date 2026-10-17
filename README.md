# NotebookPress

Export Jupyter notebooks from Visual Studio Code to clean, readable PDF documents.

## Features

- Export the active Jupyter notebook to PDF.
- Save the generated PDF to a location of your choice.
- Preserve notebook text, code cells, and supported chart images.
- Format code cells with a readable monospace font.
- Add document metadata and page numbers.
- Open the exported PDF directly from the success notification.

## Requirements

- Visual Studio Code
- A Jupyter notebook opened in VS Code

## Usage

1. Open a Jupyter notebook in Visual Studio Code.
2. Open the Command Palette with `Ctrl+Shift+P`.
3. Run **NotebookPress: Export Notebook to Smart PDF**.
4. Choose the destination and filename.
5. Wait for the export to finish. Use **Open PDF** in the notification if desired.

## Notes

- PDF output is intended for readable notebook reports.
- Rendering may vary depending on notebook output types and embedded content.
- Save your notebook before exporting to ensure the latest changes are included.

## Support

If export fails, check the error message shown by NotebookPress and verify that the destination folder is writable.
