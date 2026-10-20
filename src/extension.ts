import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import PDFDocument from 'pdfkit';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';

hljs.registerLanguage('python', python);
const { marked } = require('marked') as typeof import('marked');

type NotebookOutput = {
	data?: Record<string, unknown>;
	text?: string | string[];
	output_type?: string;
};

type NotebookCell = {
	cell_type?: string;
	source?: string | string[];
	outputs?: NotebookOutput[];
	execution_count?: number | null;
};

type Notebook = {
	cells?: NotebookCell[];
	metadata?: Record<string, unknown>;
};

function asText(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}

	if (Array.isArray(value)) {
		return value.filter(
			(part): part is string => typeof part === 'string'
		).join('');
	}

	return '';
}

function cleanMarkdown(source: string): string {
	return source
		.replace(/```[\w-]*\n?/g, '')
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1')
		.replace(/\*\*(.*?)\*\*/gs, '$1')
		.replace(/__(.*?)__/gs, '$1')
		.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/^>\s?/gm, '')
		.replace(/^\s*[-*+]\s+/gm, '  \u2022 ')
		.replace(/^\s*\d+\.\s+/gm, '  \u2022 ');

}

type MarkdownToken = {
	type: string;
	text?: string;
	tokens?: MarkdownToken[];
	depth?: number;
	ordered?: boolean;
	items?: MarkdownToken[];
	href?: string;
};

function markdownPlainText(tokens: MarkdownToken[]): string {
        return tokens.map((token) => {
                if (token.type === 'space') {
                        return '\n\n';
                }

                if (token.type === 'list') {
                        return (token.items ?? [])
                                .map((item, index) => {
                                        const content = markdownPlainText(
                                                item.tokens ?? []
                                        ).trim();

                                        const prefix = token.ordered
                                                ? `${index + 1}. `
                                                : '\u2022 ';

                                        return `${prefix}${content}`;
                                })
                                .join('\n');
                }

                if (token.type === 'heading' || token.type === 'paragraph' ||
                    token.type === 'strong' || token.type === 'em' ||
                    token.type === 'del' || token.type === 'link') {
                        return markdownPlainText(token.tokens ?? []);
                }

                if (token.type === 'codespan' || token.type === 'text' ||
                    token.type === 'escape' || token.type === 'html' ||
                    token.type === 'code') {
                        return token.text ?? '';
                }

                if (token.type === 'br') {
                        return '\n';
                }

                if (token.type === 'image') {
                        return `[Image: ${token.text ?? 'image'}]`;
                }

                if (token.tokens) {
                        return markdownPlainText(token.tokens);
                }

                return token.text ?? '';
        }).join('');
}

function imageBuffer(value: unknown): Buffer | undefined {

	const encoded = asText(value).replace(/\s/g, '');

	if (!encoded) {
		return undefined;
	}

	try {
		return Buffer.from(encoded, 'base64');
	} catch {
		return undefined;
	}
}

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand(
		'notebookpress.exportPdf',
		async (uri?: vscode.Uri) => {
			try {
				const notebookEditor = vscode.window.activeNotebookEditor;
				const editor = vscode.window.activeTextEditor;

				const candidateUri =
					uri?.scheme === 'file' &&
						uri.fsPath.toLowerCase().endsWith('.ipynb')
						? uri
						: notebookEditor?.notebook.uri.scheme === 'file' &&
							notebookEditor.notebook.uri.fsPath.toLowerCase().endsWith('.ipynb')
							? notebookEditor.notebook.uri
							: editor?.document.uri.scheme === 'file' &&
								editor.document.uri.fsPath.toLowerCase().endsWith('.ipynb')
								? editor.document.uri
								: undefined;

				if (!candidateUri) {
					vscode.window.showErrorMessage(
						'NotebookPress: Please open a Jupyter notebook first.'
					);
					return;
				}

				const notebookPath = candidateUri.fsPath;

				const raw = await fs.readFile(notebookPath, 'utf8');
				const notebook = JSON.parse(raw) as Notebook;

				if (!Array.isArray(notebook.cells)) {
					throw new Error(
						'This file does not contain a valid notebook cell list.'
					);
				}

				const saveUri = await vscode.window.showSaveDialog({
					saveLabel: 'Export PDF',
					filters: { 'PDF document': ['pdf'] },
					defaultUri: vscode.Uri.file(
						path.join(
							path.dirname(notebookPath),
							`${path.basename(notebookPath, path.extname(notebookPath))}.pdf`
						)
					)
				});

				if (!saveUri) {
					return;
				}

				if (saveUri.fsPath.toLowerCase() === notebookPath.toLowerCase()) {
					throw new Error('The PDF path cannot overwrite the notebook.');
				}

				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: 'NotebookPress: Generating PDF',
						cancellable: false
					},
					async () => {
						await fs.mkdir(path.dirname(saveUri.fsPath), {
							recursive: true
						});

						await new Promise<void>((resolve, reject) => {
							const doc = new PDFDocument({
								size: 'A4',
								margins: {
									top: 52,
									bottom: 52,
									left: 48,
									right: 48
								},
								bufferPages: true,
								info: {
									Title: path.basename(notebookPath!),
									Author: 'NotebookPress',
									Subject: 'Jupyter Notebook export'
								}
							});

							const stream = require('node:fs').createWriteStream(
								saveUri.fsPath
							);

							let settled = false;

							const fail = (error: Error) => {
								if (!settled) {
									settled = true;
									reject(error);
								}
							};

							stream.on('error', fail);
							doc.on('error', fail);

							stream.on('finish', () => {
								if (!settled) {
									settled = true;
									resolve();
								}
							});

							doc.pipe(stream);

							const pageWidth =
								doc.page.width -
								doc.page.margins.left -
								doc.page.margins.right;

							const ensureSpace = (height: number) => {
								if (
									doc.y + height >
									doc.page.height - doc.page.margins.bottom
								) {
									doc.addPage();
								}
							};

							const writeParagraph = (
								text: string,
								size = 10,
								color = '#222222'
							) => {
								if (!text.trim()) {
									doc.moveDown(0.4);
									return;
								}

								doc.font('Helvetica')
									.fontSize(size)
									.fillColor(color);

								const height = doc.heightOfString(text, {
									width: pageWidth,
									lineGap: 2
								});

								const maxY = doc.page.height - doc.page.margins.bottom;
								const remainingSpace = maxY - doc.y;

								// Move to a new page if the paragraph cannot fit in the
								// remaining space and there is already content on the page.
								if (remainingSpace < size * 1.6 && doc.y > doc.page.margins.top) {
									doc.addPage();
								}

								doc.text(text, doc.page.margins.left, doc.y, {
                                                                        width: pageWidth,
                                                                        lineGap: 2,
                                                                        align: 'left'
                                                                });

								doc.moveDown(0.4);
							};

							const writeCode = (source: string, backgroundColor: string) => {
        const lines = source.replace(/\r\n/g, '\n').split('\n');
        const lineHeight = 11;
        const padding = 7;
        const textWidth = pageWidth - padding * 2;
        const getMaxY = () => doc.page.height - doc.page.margins.bottom;

        const colors: Record<string, string> = {
                keyword: '#C586C0',
                string: '#A31515',
                comment: '#008000',
                number: '#098658',
                title: '#795E26',
                built_in: '#267F99',
                literal: '#0000FF',
                type: '#267F99',
                meta: '#AF00DB',
                operator: '#666666',
                function: '#795E26',
                params: '#001080',
                attr: '#267F99',
                variable: '#001080',
                subst: '#A31515',
                punctuation: '#404040',
                default: '#20242A'
        };

        const decodeHtml = (value: string): string => value
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#x27;/g, "'")
                .replace(/&#39;/g, "'");

        const highlightLine = (line: string): Array<{ text: string; color: string }> => {
                try {
                        const html = hljs.highlight(line || ' ', {
                                language: 'python',
                                ignoreIllegals: true
                        }).value;
                        const segments: Array<{ text: string; color: string }> = [];
                        const stack: string[] = [];
                        const pattern = /<\/?span\b[^>]*>|[^<]+|</g;
                        let match: RegExpExecArray | null;

                        while ((match = pattern.exec(html)) !== null) {
                                const part = match[0];
                                if (part.startsWith('</span')) {
                                        stack.pop();
                                } else if (part.startsWith('<span')) {
                                        const classMatch = part.match(/class="([^"]+)"/);
                                        stack.push(classMatch ? classMatch[1] : '');
                                } else {
                                        const value = decodeHtml(part);
                                        if (value) {
                                                const classes = (stack[stack.length - 1] || '').split(/\s+/);
                                                const token = classes.find(name => name.startsWith('hljs-'))?.slice(5) || 'default';
                                                const color = colors[token] || (
                                                        token.startsWith('title') ? colors.title :
                                                        token.startsWith('type') ? colors.type :
                                                        colors.default
                                                );
                                                segments.push({ text: value, color });
                                        }
                                }
                        }
                        return segments.length ? segments : [{ text: line || ' ', color: colors.default }];
                } catch {
                        return [{ text: line || ' ', color: colors.default }];
                }
        };

        const writeLine = (line: string) => {
                const text = line || ' ';
                doc.font('Courier-Bold').fontSize(8);
                const wrapped = doc.heightOfString(text, {
                        width: textWidth,
                        lineGap: 1
                });
                const required = Math.max(lineHeight, wrapped);
                const blockHeight = required + 4;

                if (doc.y + blockHeight + padding > getMaxY()) {
                        doc.addPage();
                }

                const startY = doc.y;
                doc.save();
                doc.roundedRect(
                        doc.page.margins.left,
                        startY - 2,
                        pageWidth,
                        blockHeight,
                        2
                ).fill(backgroundColor);
                doc.restore();

                let x = doc.page.margins.left + padding;
                const y = startY;

                for (const segment of highlightLine(text)) {
                        doc.font('Courier-Bold').fontSize(8).fillColor(segment.color);
                        doc.text(segment.text, x, y, { lineBreak: false });
                        x += doc.widthOfString(segment.text);
                }

                doc.y = startY + required + 2;
        };

        for (const line of lines) {
                writeLine(line);
        }

        doc.fillColor('#20242A');
        doc.moveDown(0.7);
};
							const writeImage = (buffer: Buffer) => {
								try {
									const maxHeight = 300;
									let imageWidth = 0;
									let imageHeight = 0;

									// Read PNG dimensions directly from its header.
									if (
										buffer.length >= 24 &&
										buffer.toString('ascii', 1, 4) === 'PNG'
									) {
										imageWidth = buffer.readUInt32BE(16);
										imageHeight = buffer.readUInt32BE(20);
									}

									// Read JPEG dimensions by scanning its marker segments.
									if (
										imageWidth === 0 &&
										buffer.length >= 4 &&
										buffer[0] === 0xFF &&
										buffer[1] === 0xD8
									) {
										let offset = 2;

										while (offset + 4 < buffer.length) {
											if (buffer[offset] !== 0xFF) {
												offset++;
												continue;
											}

											const marker = buffer[offset + 1];
											offset += 2;

											if (
												marker === 0xD8 ||
												marker === 0xD9 ||
												marker === 0x01 ||
												(marker >= 0xD0 && marker <= 0xD7)
											) {
												continue;
											}

											if (offset + 2 > buffer.length) {
												break;
											}

											const segmentLength = buffer.readUInt16BE(offset);

											if (segmentLength < 2 || offset + segmentLength > buffer.length) {
												break;
											}

											const isStartOfFrame =
												(marker >= 0xC0 && marker <= 0xC3) ||
												(marker >= 0xC5 && marker <= 0xC7) ||
												(marker >= 0xC9 && marker <= 0xCB) ||
												(marker >= 0xCD && marker <= 0xCF);

											if (isStartOfFrame && segmentLength >= 7) {
												imageHeight = buffer.readUInt16BE(offset + 3);
												imageWidth = buffer.readUInt16BE(offset + 5);
												break;
											}

											offset += segmentLength;
										}
									}

									const bottomLimit = doc.page.height - doc.page.margins.bottom;
									const availableWidth = pageWidth;
									const validDimensions = imageWidth > 0 && imageHeight > 0;

									const scale = validDimensions
										? Math.min(availableWidth / imageWidth, maxHeight / imageHeight)
										: 1;

									const renderedWidth = validDimensions
										? imageWidth * scale
										: availableWidth;

									const renderedHeight = validDimensions
										? imageHeight * scale
										: maxHeight;

									if (doc.y + renderedHeight + 20 > bottomLimit) {
										doc.addPage();
									}

									const imageY = doc.y + 8;
									const imageX = doc.page.margins.left;

									doc.image(buffer, imageX, imageY, {
										fit: [availableWidth, maxHeight],
										align: 'center',
										valign: 'center'
									});

									doc.y = imageY + renderedHeight + 12;
								} catch (error) {
									console.error('NotebookPress image rendering error:', error);
									writeParagraph('[Image could not be rendered in this PDF.]', 9, '#777777');
								}
							};

							try {
								// Document title at the top of the first content page
								const documentTitle = path
									.basename(notebookPath!, path.extname(notebookPath!))
									.replace(/[_-]+/g, ' ')
									.trim();

								doc.font('Helvetica-Bold')
									.fontSize(20)
									.fillColor('#17365D')
									.text(documentTitle || 'Practical Report', {
										width: pageWidth,
										align: 'center',
										lineGap: 3
									});

								doc.moveDown(0.3);

								doc.save();
								doc.moveTo(doc.page.margins.left, doc.y)
									.lineTo(doc.page.margins.left + pageWidth, doc.y)
									.lineWidth(1)
									.strokeColor('#D5DEE9')
									.stroke();
								doc.restore();

								doc.moveDown(0.7);

								for (const [index, cell] of notebook.cells!.entries()) {
									const source = asText(cell.source);


									if (cell.cell_type === 'markdown') {
        const tokens = marked.lexer(source) as MarkdownToken[];

        const headingSizes: Record<number, number> = {
                1: 20, 2: 17, 3: 15, 4: 13, 5: 12, 6: 11
        };

        const renderBlocks = (blocks: MarkdownToken[]) => {
                for (const token of blocks) {
                        if (token.type === 'heading') {
                                const level = token.depth ?? 1;
                                const size = headingSizes[level] ?? 12;
                                const text = markdownPlainText(token.tokens ?? []).trim();

                                if (!text) continue;

                                ensureSpace(size * 2 + 20);
                                doc.moveDown(level <= 2 ? 0.35 : 0.2);
                                doc.font('Helvetica-Bold')
                                        .fontSize(size)
                                        .fillColor(level <= 2 ? '#17365D' : '#304B6B')
                                        .text(text, doc.page.margins.left, doc.y, {
                                                width: pageWidth,
                                                lineGap: 2,
                                                align: 'left'
                                        });

                                if (level <= 2) {
                                        const dividerY = doc.y + 3;
                                        doc.save();
                                        doc.moveTo(doc.page.margins.left, dividerY)
                                                .lineTo(doc.page.margins.left + pageWidth, dividerY)
                                                .lineWidth(level === 1 ? 1 : 0.6)
                                                .strokeColor('#D5DEE9')
                                                .stroke();
                                        doc.restore();
                                        doc.y = dividerY + 5;
                                }
                                doc.moveDown(0.25);
                        } else if (token.type === 'paragraph') {
                                const text = markdownPlainText(token.tokens ?? []).trim();
                                if (text) writeParagraph(text);
                        } else if (token.type === 'list') {
                                for (const [i, item] of (token.items ?? []).entries()) {
                                        const content = markdownPlainText(item.tokens ?? []).trim();
                                        if (!content) continue;
                                        const prefix = token.ordered ? `${i + 1}. ` : '\u2022 ';
                                        writeParagraph(prefix + content);
                                }
                                doc.moveDown(0.25);
                        } else if (token.type === 'code') {
                                writeCode(token.text ?? '', '#F3F5F7');
                        } else if (token.type === 'blockquote') {
                                const text = markdownPlainText(token.tokens ?? []).trim();
                                if (text) writeParagraph(text, 10, '#52657A');
                        } else if (token.type === 'hr') {
                                doc.moveDown(0.3);
                                const y = doc.y;
                                doc.save();
                                doc.moveTo(doc.page.margins.left, y)
                                        .lineTo(doc.page.margins.left + pageWidth, y)
                                        .lineWidth(0.6)
                                        .strokeColor('#D5DEE9')
                                        .stroke();
                                doc.restore();
                                doc.moveDown(0.5);
                        } else if (token.type === 'space') {
                                doc.moveDown(0.25);
                        } else {
                                const text = markdownPlainText([token]).trim();
                                if (text) writeParagraph(text);
                        }
                }
        };

        renderBlocks(tokens);
} else if (cell.cell_type === 'code') {


                                    // Professional Jupyter-style code cell header
                                    ensureSpace(30);

                                    const headerY = doc.y;
                                    const headerHeight = 22;
                                    const executionLabel =
                                        cell.execution_count == null
                                            ? 'In [ ]'
                                            : `In [${cell.execution_count}]`;

                                    doc.save();
                                    doc.roundedRect(
                                        doc.page.margins.left,
                                        headerY,
                                        pageWidth,
                                        headerHeight,
                                        4
                                    ).fill('#E8EEF8');
                                    doc.restore();

                                    doc.font('Helvetica-Bold')
                                        .fontSize(9)
                                        .fillColor('#284B78')
                                        .text(
                                            executionLabel,
                                            doc.page.margins.left + 9,
                                            headerY + 6,
                                            {
                                                width: pageWidth - 18,
                                                lineBreak: false
                                            }
                                        );

                                    doc.y = headerY + headerHeight + 5;
                                    writeCode(source, '#F5F8FD');

										for (const output of cell.outputs ?? []) {
											const data = output.data ?? {};
											const png = imageBuffer(data['image/png']);
											const jpeg = imageBuffer(data['image/jpeg']);

											if (png || jpeg) {
												writeImage((png || jpeg)!);
											} else {
												const textOutput =
													asText(data['text/plain']) ||
													asText(output.text);

												if (textOutput) {
													writeParagraph(
														'Output:',
														9,
														'#52657A'
													);
													writeCode(textOutput, '#EFF7F2');
												} else if (
													data['image/svg+xml'] ||
													data['text/html']
												) {
													writeParagraph(
														'[Rich output omitted: this format is not yet supported.]',
														9,
														'#777777'
													);
												}
											}
										}
									}

									if (index < notebook.cells!.length - 1) {
										doc.moveDown(0.45);
									}
								}

								const range = doc.bufferedPageRange();

								for (
									let pageIndex = range.start;
									pageIndex < range.start + range.count;
									pageIndex++
								) {
									doc.switchToPage(pageIndex);

									const footerY = doc.page.height - 30;

									doc.save();

									// Footer ko normal content pagination se alag rakho.
									doc.page.margins.bottom = 0;

									doc.font('Helvetica')
										.fontSize(8)
										.fillColor('#777777')
										.text(
											'Generated by NotebookPress',
											doc.page.margins.left,
											footerY,
											{
												width: pageWidth / 2,
												lineBreak: false
											}
										);

									doc.text(
										`${pageIndex + 1}`,
										doc.page.margins.left + pageWidth / 2,
										footerY,
										{
											width: pageWidth / 2,
											align: 'right',
											lineBreak: false
										}
									);

									doc.restore();
								}

								doc.end();
							} catch (error) {
								doc.destroy();
								fail(
									error instanceof Error
										? error
										: new Error(String(error))
								);
							}
						});
					}
				);

				const open = await vscode.window.showInformationMessage(
					`PDF exported: ${path.basename(saveUri.fsPath)}`,
					'Open PDF'
				);

				if (open === 'Open PDF') {
					await vscode.env.openExternal(saveUri);
				}
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);

				vscode.window.showErrorMessage(
					`NotebookPress export failed: ${message}`
				);
			}
		}
	);

	context.subscriptions.push(disposable);
}

export function deactivate() { }
