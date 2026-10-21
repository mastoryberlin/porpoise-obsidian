import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile, TFolder, TAbstractFile } from 'obsidian';

/**
 * Represents a suggestion item for path autocomplete.
 * The name is the full relative path from vault root (including trailing / for folders).
 * The display is what's shown in the dropdown (just the basename for files, basename/ for folders).
 */
export interface PathSuggestion {
	type: 'file' | 'folder' | 'parent';
	name: string;  // Full relative path from vault root, with trailing / for folders
	display: string; // Just the basename (with / for folders)
}

/**
 * Suggests path completions when user types @ preceded by whitespace.
 * Shows relative paths from vault root, one level at a time.
 */
export class PathAutocompleteSuggest extends EditorSuggest<PathSuggestion> {
	private currentSuggestions: PathSuggestion[] = [];
	private activeIndex: number = -1;
	private isOpen: boolean = false;
	
	constructor(app: App) {
		super(app);
		
		// Set up global key listener for TAB
		// We use capture phase to intercept before other handlers
		document.addEventListener('keydown', this.handleGlobalKeydown.bind(this), true);
	}

	/**
	 * Handle keydown events globally to intercept TAB when suggest is open
	 */
	private handleGlobalKeydown(evt: KeyboardEvent): void {
		// Only handle TAB when our suggest is open
		if (!this.isOpen) {
			return;
		}
		
		// Intercept TAB key
		if (evt.key === 'Tab') {
			evt.preventDefault();
			
			// Select the first suggestion or the active one
			if (this.currentSuggestions.length > 0) {
				// If we have a tracked active index, use it; otherwise use index 0
				const index = this.activeIndex >= 0 && this.activeIndex < this.currentSuggestions.length 
					? this.activeIndex 
					: 0;
				
				this.selectSuggestion(this.currentSuggestions[index] as PathSuggestion, evt);
			}
		}
		
		// Handle / key for folder selection
		// When suggest is open and user presses /, it should select the first folder suggestion
		if (evt.key === '/' && this.isOpen) {
			// Find the first folder suggestion
			const folderSuggestion = this.currentSuggestions.find(s => s.type === 'folder');
			if (folderSuggestion) {
				evt.preventDefault();
				this.selectSuggestion(folderSuggestion as PathSuggestion, evt);
			}
		}
	}

	/**
	 * Override open to track state
	 */
	open(): void {
		super.open();
		this.isOpen = true;
	}

	/**
	 * Override close to track state
	 */
	close(): void {
		super.close();
		this.isOpen = false;
		this.activeIndex = -1;
	}

	/**
	 * Check if we should trigger the suggestion.
	 * Trigger when @ is followed by a path (which may include / characters).
	 * The path starts with @ preceded by whitespace or start of line.
	 */
	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		const lineBeforeCursor = line.substring(0, cursor.ch);
		
		// Find @ preceded by whitespace or start of line
		// The @ must be in the line, and we want to capture everything after it up to cursor
		// This allows paths like @folder/subfolder/ to trigger suggestions
		const atMatch = lineBeforeCursor.match(/(\s|^)@([^\s]*)$/);
		
		if (!atMatch) {
			return null;
		}

		const whitespaceBefore = atMatch[1] || '';
		const afterAt = atMatch[2] || ''; // This is the path after @, may include /
		
		const atIndex = lineBeforeCursor.length - (afterAt.length + 1);
		
		const start: EditorPosition = {
			line: cursor.line,
			ch: atIndex + 1, // Start at the @ position
		};
		
		const end: EditorPosition = {
			line: cursor.line,
			ch: cursor.ch,
		};

		return {
			start: start,
			end: end,
			query: afterAt, // This is the path being built after @
		};
	}

	/**
	 * Navigate to a folder given a path relative to vault root.
	 * The path may contain / separators and .. for parent directory.
	 * Returns the folder if found, null otherwise.
	 */
	private navigateToFolder(path: string): TFolder | null {
		const vault = this.app.vault;
		const root = vault.getRoot();
		
		// Handle empty path - return root
		if (path.length === 0) {
			return root;
		}
		
		// Split path into segments, handling .. and .
		const segments = path.split('/').filter(s => s.length > 0);
		
		let currentFolder: TFolder = root;
		
		for (const segment of segments) {
			if (segment === '..') {
				// Go up one level
				if (currentFolder && !currentFolder.isRoot()) {
					currentFolder = currentFolder.parent as TFolder;
				} else {
					// At root, can't go up
					return null;
				}
			} else if (segment === '.') {
				// Current directory, do nothing
				continue;
			} else {
				// Try to find the folder or file
				const child = currentFolder.children.find(
					(child) => child.name === segment
				);
				
				if (child instanceof TFolder) {
					currentFolder = child;
				} else if (child instanceof TFile) {
					// Can't navigate into a file
					return null;
				} else {
					// Folder doesn't exist
					return null;
				}
			}
		}
		
		return currentFolder;
	}

	/**
	 * Get suggestions based on context.
	 * Returns path suggestions relative to the current path being built.
	 */
	async getSuggestions(context: EditorSuggestContext): Promise<PathSuggestion[]> {
		const { query } = context;
		
		// The query is the path after @, which may include / separators
		// We need to split it into the base path (everything up to last /) and the filter (after last /)
		const lastSlashIndex = query.lastIndexOf('/');
		const basePath = lastSlashIndex >= 0 ? query.substring(0, lastSlashIndex + 1) : '';
		const filterText = lastSlashIndex >= 0 ? query.substring(lastSlashIndex + 1) : query;
		
		// Navigate to the base folder
		const currentFolder = this.navigateToFolder(basePath);
		
		if (!currentFolder) {
			// Base path is invalid (e.g., non-existent folder or file)
			// Try to find if we're at a valid path by going up one level
			const upOneLevel = basePath.endsWith('/') 
				? basePath.slice(0, -1).substring(0, Math.max(0, basePath.slice(0, -1).lastIndexOf('/') + 1))
				: basePath.substring(0, Math.max(0, basePath.lastIndexOf('/') + 1));
			
			const parentFolder = this.navigateToFolder(upOneLevel);
			if (parentFolder) {
				return this.getFilteredSuggestions(parentFolder, filterText);
			}
			return [];
		}
		
		const suggestions = this.getFilteredSuggestions(currentFolder, filterText);
		this.currentSuggestions = suggestions;
		return suggestions;
	}

	/**
	 * Get suggestions from a folder, filtered by the query text.
	 */
	private getFilteredSuggestions(folder: TFolder, filterText: string): PathSuggestion[] {
		const suggestions: PathSuggestion[] = [];
		const currentPath = this.getPathToFolder(folder);
		
		// Add .. to go to parent (unless at root)
		if (!folder.isRoot()) {
			const parentMatch = filterText === '' || '..'.startsWith(filterText);
			if (parentMatch) {
				suggestions.push({ 
					type: 'parent', 
					name: currentPath + '..',
					display: '..'
				});
			}
		}
		
		// Add all children (files and folders)
		for (const child of folder.children) {
			const basename = child.name;
			let fullPath: string;
			let type: 'file' | 'folder' | 'parent';
			let display: string;
			
			if (child instanceof TFolder) {
				fullPath = currentPath + basename + '/';
				display = basename + '/';
				type = 'folder';
			} else if (child instanceof TFile) {
				fullPath = currentPath + basename;
				display = basename;
				type = 'file';
			} else {
				continue;
			}
			
			// Filter by query text (match against basename)
			const matches = filterText === '' || 
				basename.startsWith(filterText);
			
			if (matches) {
				suggestions.push({ 
					type: type,
					name: fullPath,
					display: display
				});
			}
		}
		
		return suggestions;
	}

	/**
	 * Get the relative path from vault root to a folder.
	 * Returns path with trailing /.
	 */
	private getPathToFolder(folder: TFolder): string {
		if (folder.isRoot()) {
			return '';
		}
		
		const pathParts: string[] = [];
		let current: TFolder | null = folder;
		
		while (current && !current.isRoot()) {
			pathParts.unshift(current.name + '/');
			current = current.parent as TFolder | null;
		}
		
		return pathParts.join('');
	}

	/**
	 * Render a suggestion item in the dropdown.
	 */
	renderSuggestion(suggestion: PathSuggestion, el: HTMLElement): void {
		el.setText(suggestion.display);
		
		// Style based on type
		el.addClass('porpoise-path-suggestion');
		if (suggestion.type === 'folder') {
			el.addClass('porpoise-path-folder');
		} else if (suggestion.type === 'parent') {
			el.addClass('porpoise-path-parent');
		} else {
			el.addClass('porpoise-path-file');
		}
	}

	/**
	 * Handle selection of a suggestion.
	 * This is called when user clicks, presses ENTER, or TAB.
	 */
	selectSuggestion(suggestion: PathSuggestion, evt: MouseEvent | KeyboardEvent): void {
		// Don't do anything on Escape
		if (evt instanceof KeyboardEvent && evt.key === 'Escape') {
			return;
		}

		const cursor = this.context?.start;
		const editor = this.context?.editor;
		const end = this.context?.end;
		
		if (!cursor || !editor || !end) {
			return;
		}

		const line = editor.getLine(cursor.line);
		const textBeforeAt = line.substring(0, cursor.ch);
		
		// Find the @ and extract what's after it (the current query)
		const atMatch = textBeforeAt.match(/(\s|^)@([^\s]*)$/);
		if (!atMatch) {
			return;
		}

		const whitespaceBefore = atMatch[1] || '';
		const currentQuery = atMatch[2] || '';
		
		// Calculate the start position (before the whitespace before @)
		const replaceStartCh = cursor.ch - (currentQuery.length + 1 + whitespaceBefore.length);
		
		// Build the new text to insert: @ + suggestion.name
		// suggestion.name already contains the full path from vault root
		const newText = `@${suggestion.name}`;
		
		// Replace from before the @ to the end of the current query
		editor.replaceRange(
			newText,
			{ line: cursor.line, ch: replaceStartCh + whitespaceBefore.length },
			{ line: end.line, ch: end.ch },
			'path-autocomplete'
		);
		
		// For folders, reopen the suggest to show subdirectories
		if (suggestion.type === 'folder') {
			// Position cursor at the end of the inserted text
			const newCursorPos = {
				line: cursor.line,
				ch: replaceStartCh + whitespaceBefore.length + newText.length,
			};
			
			// Move cursor and the suggest will automatically reopen
			// because the cursor is now after a path ending with /
			setTimeout(() => {
				editor.setCursor(newCursorPos);
			}, 10);
		}
	}
}
