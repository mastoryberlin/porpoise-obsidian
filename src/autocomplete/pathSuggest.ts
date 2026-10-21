import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile, TFolder, TAbstractFile } from 'obsidian';

/**
 * Represents a suggestion item for path autocomplete.
 * Can be a file, folder, or parent directory reference.
 */
export interface PathSuggestion {
	type: 'file' | 'folder' | 'parent';
	name: string;  // For folders, includes trailing '/'
	display: string; // Display name without trailing '/' for folders
}

/**
 * Suggests path completions when user types @ preceded by whitespace.
 * Shows relative paths from vault root, one level at a time.
 */
export class PathAutocompleteSuggest extends EditorSuggest<PathSuggestion> {
	constructor(app: App) {
		super(app);
	}

	/**
	 * Check if we should trigger the suggestion.
	 * Trigger when @ is typed and is preceded by whitespace (or at start of line).
	 * Also continue suggestion when typing after @.
	 */
	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		const lineBeforeCursor = line.substring(0, cursor.ch);
		
		// Find @ preceded by whitespace or start of line
		// The @ must be in the current line before cursor
		const atMatch = lineBeforeCursor.match(/(\s|^)@([^\s]*)$/);
		
		if (!atMatch) {
			return null;
		}

		const whitespaceBefore = atMatch[1] || '';
		const afterAt = atMatch[2] || ''; // This is the query part
		
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
			query: afterAt, // This is what the user typed after @
		};
	}

	/**
	 * Navigate to a folder path from the vault root.
	 * The path is relative to vault root and may contain .. segments.
	 * Returns the folder if found, null otherwise.
	 */
	private navigateToFolder(basePath: string): TFolder | null {
		const vault = this.app.vault;
		const root = vault.getRoot();
		
		// Handle empty path - return root
		if (basePath.length === 0) {
			return root;
		}
		
		// Split path into segments, handling .. and .
		const segments = basePath.split('/').filter(s => s.length > 0);
		
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
				// Try to find the folder
				const child = currentFolder.children.find(
					(child) => child instanceof TFolder && child.name === segment
				) as TFolder | undefined;
				
				if (child) {
					currentFolder = child;
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
		
		// Parse the path before the current query segment
		// If query contains /, we need to navigate to the parent folder
		const lastSlashIndex = query.lastIndexOf('/');
		const basePath = lastSlashIndex >= 0 ? query.substring(0, lastSlashIndex + 1) : '';
		const filterText = lastSlashIndex >= 0 ? query.substring(lastSlashIndex + 1) : query;
		
		// Navigate to the current folder
		const currentFolder = this.navigateToFolder(basePath);
		
		if (!currentFolder) {
			// If the base path is invalid, check if we can offer ..
			if (basePath.endsWith('../') || basePath === '..' || basePath === '../') {
				// We're trying to go up from root, offer parent if possible
				const segments = basePath.split('/').filter(s => s.length > 0);
				const parentSegments = segments.slice(0, -1);
				const parentPath = parentSegments.join('/');
				const parentFolder = this.navigateToFolder(parentPath);
				
				if (parentFolder) {
					return this.getFilteredSuggestions(parentFolder, filterText);
				}
			}
			return [];
		}
		
		return this.getFilteredSuggestions(currentFolder, filterText);
	}

	/**
	 * Get suggestions from a folder, filtered by the query text.
	 */
	private getFilteredSuggestions(folder: TFolder, filterText: string): PathSuggestion[] {
		const suggestions: PathSuggestion[] = [];
		
		// Add .. to go to parent (unless at root)
		if (!folder.isRoot()) {
			const parentMatch = filterText === '' || '..'.startsWith(filterText);
			if (parentMatch) {
				suggestions.push({ 
					type: 'parent', 
					name: '..',
					display: '..'
				});
			}
		}
		
		// Add all children (files and folders)
		for (const child of folder.children) {
			let displayName: string;
			let suggestionName: string;
			let type: 'file' | 'folder' | 'parent';
			
			if (child instanceof TFolder) {
				displayName = child.name;
				suggestionName = child.name + '/';
				type = 'folder';
			} else if (child instanceof TFile) {
				displayName = child.name;
				suggestionName = child.name;
				type = 'file';
			} else {
				continue;
			}
			
			// Filter by query text
			const matches = filterText === '' || 
				displayName.startsWith(filterText) || 
				suggestionName.startsWith(filterText);
			
			if (matches) {
				suggestions.push({ 
					type: type,
					name: suggestionName,
					display: displayName
				});
			}
		}
		
		return suggestions;
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
	 * This is called when user clicks, presses TAB/ENTER, or presses . (for folders).
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
		
		// Calculate the start position (before the @)
		const replaceStartCh = cursor.ch - (currentQuery.length + 1 + whitespaceBefore.length);
		
		// Build the new path
		let newPath: string;
		
		// Handle the case where currentQuery has path segments
		const lastSlashIndex = currentQuery.lastIndexOf('/');
		const basePath = lastSlashIndex >= 0 ? currentQuery.substring(0, lastSlashIndex + 1) : '';
		
		if (basePath.length === 0) {
			// No path segments yet, just append the suggestion
			newPath = suggestion.name;
		} else {
			// We have a base path, need to handle it properly
			// Remove any partial text after the last /
			const cleanBase = currentQuery.substring(0, lastSlashIndex + 1);
			
			// Check if suggestion already includes what was typed
			const suggestionBase = suggestion.type === 'folder' 
				? suggestion.name.slice(0, -1) 
				: suggestion.name;
			
			const partialMatch = currentQuery.substring(lastSlashIndex + 1);
			
			// If the suggestion matches what was typed, just use the suggestion
			if (suggestionBase === partialMatch || suggestion.name === partialMatch) {
				newPath = cleanBase + suggestion.name;
			} else {
				newPath = cleanBase + suggestion.name;
			}
		}

		// Replace the text from @ onwards
		editor.replaceRange(
			`@${newPath}`,
			{ line: cursor.line, ch: replaceStartCh + whitespaceBefore.length },
			{ line: end.line, ch: end.ch },
			'path-autocomplete'
		);
		
		// Check if we should reopen the suggest for chaining
		const isFolder = suggestion.type === 'folder';
		
		// For folders, reopen the suggest to show subdirectories
		if (isFolder) {
			// Close the current suggest
			this.close();
			
			// Position cursor at the end of the inserted text
			const newCursorPos = {
				line: cursor.line,
				ch: replaceStartCh + whitespaceBefore.length + 1 + newPath.length,
			};
			
			// Move cursor and reopen suggest
			setTimeout(() => {
				editor.setCursor(newCursorPos);
				// The onTrigger should fire again because we have @.../ pattern
				// But we need to trigger it manually since we're after the /
				// So we'll call open() to reopen the suggest
				this.open();
			}, 10);
		}
	}
}
