import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile, TFolder } from 'obsidian';
import { MarkdownView } from 'obsidian';

/**
 * Represents a suggestion item for path autocomplete.
 * The name is the full relative path from vault root (including trailing / for folders).
 * The display is what's shown in the dropdown (just the basename for files, basename/ for folders).
 */
export interface PathSuggestion {
	type: 'file' | 'folder' | 'parent';
	name: string;
	display: string;
}

/**
 * Suggests path completions when user types @ preceded by whitespace.
 * Shows relative paths from vault root, one level at a time.
 */
export class PathAutocompleteSuggest extends EditorSuggest<PathSuggestion> {
	constructor(app: App) {
		super(app);
		
		// Set up key listener for Ctrl+Backspace, TAB, and /
		// Use capture phase to intercept before other handlers
		document.addEventListener('keydown', this.handleKeydown.bind(this), { capture: true });
	}

	/**
	 * Handle keydown events for Ctrl+Backspace, TAB, and /
	 */
	private handleKeydown(evt: KeyboardEvent): void {
		// Handle Ctrl+Backspace first - it should work regardless of suggest state
		// This needs to work even when the suggest popup is NOT open
		if (evt.ctrlKey && evt.key === 'Backspace') {
			const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeLeaf) {
				const editor = activeLeaf.editor;
				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);
				const textBeforeCursor = line.substring(0, cursor.ch);
				const atMatch = textBeforeCursor.match(/(\s|^)@([^\s]*)$/);
				
				if (atMatch) {
					evt.preventDefault();
					evt.stopImmediatePropagation();
					
					const whitespaceBefore = atMatch[1] || '';
					const currentPath = atMatch[2] || '';
					
					// Only handle if we have a path with at least one segment
					if (currentPath.length > 0) {
						const lastSlashIndex = currentPath.lastIndexOf('/');
						const replaceStartCh = cursor.ch - (currentPath.length + 1 + whitespaceBefore.length);
						
						if (lastSlashIndex >= 0) {
							// Remove everything from the last / onwards (including the /)
							const newPath = currentPath.substring(0, lastSlashIndex);
							
							editor.replaceRange(
								`@${newPath}`,
								{ line: cursor.line, ch: replaceStartCh + whitespaceBefore.length },
								{ line: cursor.line, ch: cursor.ch },
								'path-autocomplete-ctrl-backspace'
							);
							
							const newCursorPos = {
								line: cursor.line,
								ch: replaceStartCh + whitespaceBefore.length + 1 + newPath.length,
							};
							setTimeout(() => { editor.setCursor(newCursorPos); }, 10);
						} else {
							// No / in path - remove everything but @
							editor.replaceRange(
								`@`,
								{ line: cursor.line, ch: replaceStartCh + whitespaceBefore.length },
								{ line: cursor.line, ch: cursor.ch },
								'path-autocomplete-ctrl-backspace'
							);
							
							const newCursorPos = {
								line: cursor.line,
								ch: replaceStartCh + whitespaceBefore.length + 1,
							};
							setTimeout(() => { editor.setCursor(newCursorPos); }, 10);
						}
					}
				}
			}
			return;
		}
		
		// Handle TAB and / when suggest popup is open
		const editor = this.context?.editor;
		const suggestCursor = this.context?.start;
		
		if (!editor || !suggestCursor) {
			// If no context, check if TAB or / should still trigger suggest
			if (evt.key === 'Tab' || evt.key === '/') {
				// Try to find an open suggest popup and trigger ENTER
				const suggestPopup = document.querySelector('.suggest-popover');
				if (suggestPopup) {
					evt.preventDefault();
					evt.stopImmediatePropagation();
					
					const enterEvt = new KeyboardEvent('keydown', {
						key: 'Enter',
						code: 'Enter',
						charCode: 13,
						keyCode: 13,
						bubbles: true,
						cancelable: true
					});
					suggestPopup.dispatchEvent(enterEvt);
				}
			}
			return;
		}
		
		const line = editor.getLine(suggestCursor.line);
		const textBeforeCursor = line.substring(0, suggestCursor.ch);
		
		// Check if we're in a path context: text before cursor contains @
		const atMatch = textBeforeCursor.match(/(\s|^)@([^\s]*)$/);
		
		// Handle TAB and / keys by simulating ENTER (when suggest is open)
		if ((evt.key === 'Tab' || evt.key === '/') && atMatch) {
			evt.preventDefault();
			evt.stopImmediatePropagation();
			
			// Create and dispatch an ENTER event
			const enterEvt = new KeyboardEvent('keydown', {
				key: 'Enter',
				code: 'Enter',
				charCode: 13,
				keyCode: 13,
				bubbles: true,
				cancelable: true
			});
			
			// Try to find the suggest popup and dispatch there
			const suggestPopup = document.querySelector('.suggest-popover');
			if (suggestPopup) {
				suggestPopup.dispatchEvent(enterEvt);
			}
			
			// Also try document
			document.dispatchEvent(enterEvt);
		}
	}

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		const lineBeforeCursor = line.substring(0, cursor.ch);
		const atMatch = lineBeforeCursor.match(/(\s|^)@([^\s]*)$/);
		if (!atMatch) return null;

		const whitespaceBefore = atMatch[1] || '';
		const afterAt = atMatch[2] || '';
		const atIndex = lineBeforeCursor.length - (afterAt.length + 1);
		
		return {
			start: { line: cursor.line, ch: atIndex + 1 },
			end: { line: cursor.line, ch: cursor.ch },
			query: afterAt,
		};
	}

	private navigateToFolder(path: string): TFolder | null {
		const vault = this.app.vault;
		const root = vault.getRoot();
		if (path.length === 0) return root;
		
		const segments = path.split('/').filter(s => s.length > 0);
		let currentFolder: TFolder = root;
		
		for (const segment of segments) {
			if (segment === '..') {
				if (currentFolder && !currentFolder.isRoot()) {
					currentFolder = currentFolder.parent as TFolder;
				} else {
					return null;
				}
			} else if (segment === '.') {
				continue;
			} else {
				const child = currentFolder.children.find(c => c.name === segment);
				if (child instanceof TFolder) {
					currentFolder = child;
				} else if (child instanceof TFile) {
					return null;
				} else {
					return null;
				}
			}
		}
		return currentFolder;
	}

	async getSuggestions(context: EditorSuggestContext): Promise<PathSuggestion[]> {
		const { query } = context;
		const lastSlashIndex = query.lastIndexOf('/');
		const basePath = lastSlashIndex >= 0 ? query.substring(0, lastSlashIndex + 1) : '';
		const filterText = lastSlashIndex >= 0 ? query.substring(lastSlashIndex + 1) : query;
		
		// Special case: if query ends with a file path (no trailing /), we need to navigate to its parent
		// to show .. and allow navigation up
		const currentFolder = this.navigateToFolderWithFileFallback(basePath, filterText);
		if (!currentFolder) {
			const upOneLevel = basePath.endsWith('/')
				? basePath.slice(0, -1).substring(0, Math.max(0, basePath.slice(0, -1).lastIndexOf('/') + 1))
				: basePath.substring(0, Math.max(0, basePath.lastIndexOf('/') + 1));
			const parentFolder = this.navigateToFolder(upOneLevel);
			if (parentFolder) return this.getFilteredSuggestions(parentFolder, filterText);
			return [];
		}
		
		return this.getFilteredSuggestions(currentFolder, filterText);
	}

	/**
	 * Navigate to folder, but if the path points to a file, navigate to its parent folder
	 * This allows showing .. even after selecting a file
	 */
	private navigateToFolderWithFileFallback(path: string, filterText: string): TFolder | null {
		const vault = this.app.vault;
		const root = vault.getRoot();
		if (path.length === 0) return root;
		
		const segments = path.split('/').filter(s => s.length > 0);
		let currentFolder: TFolder = root;
		
		for (let i = 0; i < segments.length; i++) {
			const segment = segments[i];
			
			if (segment === '..') {
				if (currentFolder && !currentFolder.isRoot()) {
					currentFolder = currentFolder.parent as TFolder;
				} else {
					return null;
				}
			} else if (segment === '.') {
				continue;
			} else {
				const child = currentFolder.children.find(c => c.name === segment);
				if (child instanceof TFolder) {
					currentFolder = child;
				} else if (child instanceof TFile) {
					// If this is the last segment and it's a file, navigate to its parent
					// and treat the file as a filter
					if (i === segments.length - 1) {
						// This is the last segment and it's a file
						// Stay in currentFolder (parent of the file)
						// The filterText will be the file name
						return currentFolder;
					} else {
						// File in the middle of path - invalid
						return null;
					}
				} else {
					return null;
				}
			}
		}
		
		return currentFolder;
	}

	private getFilteredSuggestions(folder: TFolder, filterText: string): PathSuggestion[] {
		const suggestions: PathSuggestion[] = [];
		const currentPath = this.getPathToFolder(folder);
		
		// Always add .. if not at root (even for files)
		if (!folder.isRoot()) {
			if (filterText === '' || '..'.startsWith(filterText)) {
				suggestions.push({ type: 'parent', name: '..', display: '..' });
			}
		}
		
		// Add all children (files and folders)
		for (const child of folder.children) {
			const basename = child.name;
			if (child instanceof TFolder) {
				const fullPath = currentPath + basename + '/';
				if (filterText === '' || basename.startsWith(filterText)) {
					suggestions.push({ type: 'folder', name: fullPath, display: basename + '/' });
				}
			} else if (child instanceof TFile) {
				const fullPath = currentPath + basename;
				if (filterText === '' || basename.startsWith(filterText)) {
					suggestions.push({ type: 'file', name: fullPath, display: basename });
				}
			}
		}
		
		return suggestions;
	}

	private getPathToFolder(folder: TFolder): string {
		if (folder.isRoot()) return '';
		const pathParts: string[] = [];
		let current: TFolder | null = folder;
		while (current && !current.isRoot()) {
			pathParts.unshift(current.name + '/');
			current = current.parent as TFolder | null;
		}
		return pathParts.join('');
	}

	renderSuggestion(suggestion: PathSuggestion, el: HTMLElement): void {
		el.setText(suggestion.display);
		el.addClass('porpoise-path-suggestion');
		
		if (suggestion.type === 'folder') {
			el.addClass('porpoise-path-folder');
		} else if (suggestion.type === 'parent') {
			el.addClass('porpoise-path-parent');
		} else {
			el.addClass('porpoise-path-file');
		}
	}

	selectSuggestion(suggestion: PathSuggestion, evt: MouseEvent | KeyboardEvent): void {
		if (evt instanceof KeyboardEvent && evt.key === 'Escape') return;

		const cursor = this.context?.start;
		const editor = this.context?.editor;
		const end = this.context?.end;
		if (!cursor || !editor || !end) return;

		const line = editor.getLine(cursor.line);
		const textBeforeAt = line.substring(0, cursor.ch);
		const atMatch = textBeforeAt.match(/(\s|^)@([^\s]*)$/);
		if (!atMatch) return;

		const whitespaceBefore = atMatch[1] || '';
		const currentQuery = atMatch[2] || '';
		const replaceStartCh = cursor.ch - (currentQuery.length + 1 + whitespaceBefore.length);
		
		// Special handling for .. (parent directory)
		if (suggestion.type === 'parent') {
			const lastSlashIndex = currentQuery.lastIndexOf('/');
			
			if (lastSlashIndex >= 0) {
				const newPath = currentQuery.substring(0, lastSlashIndex);
				
				editor.replaceRange(
					`@${newPath}`,
					{ line: cursor.line, ch: replaceStartCh + whitespaceBefore.length },
					{ line: end.line, ch: end.ch },
					'path-autocomplete'
				);
				
				const newCursorPos = {
					line: cursor.line,
					ch: replaceStartCh + whitespaceBefore.length + 1 + newPath.length,
				};
				setTimeout(() => { editor.setCursor(newCursorPos); }, 10);
			} else {
				// No / in currentQuery - remove everything but @
				editor.replaceRange(
					`@`,
					{ line: cursor.line, ch: replaceStartCh + whitespaceBefore.length },
					{ line: end.line, ch: end.ch },
					'path-autocomplete'
				);
				
				const newCursorPos = {
					line: cursor.line,
					ch: replaceStartCh + whitespaceBefore.length + 1,
				};
				setTimeout(() => { editor.setCursor(newCursorPos); }, 10);
			}
		} else {
			const newText = `@${suggestion.name}`;
			
			editor.replaceRange(
				newText,
				{ line: cursor.line, ch: replaceStartCh + whitespaceBefore.length },
				{ line: end.line, ch: end.ch },
				'path-autocomplete'
			);
			
			if (suggestion.type === 'folder') {
				const newCursorPos = {
					line: cursor.line,
					ch: replaceStartCh + whitespaceBefore.length + newText.length,
				};
				setTimeout(() => { editor.setCursor(newCursorPos); }, 10);
			} else if (suggestion.type === 'file') {
				// For files, also keep the suggest open or reopen it to show ..
				// Move cursor to end of path
				const newCursorPos = {
					line: cursor.line,
					ch: replaceStartCh + whitespaceBefore.length + newText.length,
				};
				setTimeout(() => { editor.setCursor(newCursorPos); }, 10);
			}
		}
	}
}
