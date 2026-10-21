import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile, TFolder, TAbstractFile } from 'obsidian';

/**
 * Represents a suggestion item for path autocomplete.
 * The name is the full relative path from vault root (including trailing / for folders).
 * The display is what's shown in the dropdown (just the basename for files, basename/ for folders).
 */
export interface PathSuggestion {
	type: 'file' | 'folder' | 'parent';
	name: string;
	display: string;
	element?: HTMLElement;
}

/**
 * Suggests path completions when user types @ preceded by whitespace.
 * Shows relative paths from vault root, one level at a time.
 */
export class PathAutocompleteSuggest extends EditorSuggest<PathSuggestion> {
	private currentSuggestions: PathSuggestion[] = [];
	private isOpen: boolean = false;
	
	constructor(app: App) {
		super(app);
		
		// Set up key listener for TAB and / on the app container
		// This should work better than document-level listener
		this.app.workspace.containerEl.addEventListener('keydown', this.handleKeydown.bind(this));
	}

	/**
	 * Handle keydown events to intercept TAB and / when suggest is open
	 */
	private handleKeydown(evt: KeyboardEvent): void {
		// Only handle TAB and / when our suggest is open
		if (!this.isOpen) {
			return;
		}
		
		// Intercept TAB key - find the active suggestion from DOM
		if (evt.key === 'Tab') {
			evt.preventDefault();
			const activeSuggestion = this.getActiveSuggestionFromDOM();
			if (activeSuggestion) {
				this.selectSuggestion(activeSuggestion, evt);
			}
		}
		
		// Handle / key - select active folder suggestion
		if (evt.key === '/') {
			const activeSuggestion = this.getActiveSuggestionFromDOM();
			// If active suggestion is a folder, use it; otherwise find first folder
			let folderSuggestion = activeSuggestion?.type === 'folder' ? activeSuggestion : null;
			if (!folderSuggestion) {
				folderSuggestion = this.currentSuggestions.find(s => s.type === 'folder') || null;
			}
			if (folderSuggestion) {
				evt.preventDefault();
				this.selectSuggestion(folderSuggestion, evt);
			}
		}
	}

	/**
	 * Get the currently active/hovered suggestion from the DOM
	 * The framework likely adds an active class to the active suggestion element
	 */
	private getActiveSuggestionFromDOM(): PathSuggestion | null {
		// Try to find the active suggestion by looking for DOM elements with active class
		// Obsidian's suggest popup might use .is-active or .active or similar
		const activeEl = document.querySelector('.suggest-popover .is-active, .suggest-popover .active');
		if (activeEl) {
			// Find which suggestion this element corresponds to
			for (const suggestion of this.currentSuggestions) {
				if (suggestion.element === activeEl) {
					return suggestion;
				}
			}
		}
		
		// If no active class found, try to find hovered element
		const hoveredEl = document.querySelector('.suggest-popover .porpoise-path-suggestion:hover');
		if (hoveredEl) {
			for (const suggestion of this.currentSuggestions) {
				if (suggestion.element === hoveredEl) {
					return suggestion;
				}
			}
		}
		
		// If we can't find active, return the first suggestion as fallback
		if (this.currentSuggestions.length > 0) {
			return this.currentSuggestions[0]!;
		}
		
		return null;
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
		this.currentSuggestions = [];
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
		
		const currentFolder = this.navigateToFolder(basePath);
		if (!currentFolder) {
			const upOneLevel = basePath.endsWith('/')
				? basePath.slice(0, -1).substring(0, Math.max(0, basePath.slice(0, -1).lastIndexOf('/') + 1))
				: basePath.substring(0, Math.max(0, basePath.lastIndexOf('/') + 1));
			const parentFolder = this.navigateToFolder(upOneLevel);
			if (parentFolder) return this.getFilteredSuggestions(parentFolder, filterText);
			return [];
		}
		
		const suggestions = this.getFilteredSuggestions(currentFolder, filterText);
		this.currentSuggestions = suggestions;
		return suggestions;
	}

	private getFilteredSuggestions(folder: TFolder, filterText: string): PathSuggestion[] {
		const suggestions: PathSuggestion[] = [];
		const currentPath = this.getPathToFolder(folder);
		
		if (!folder.isRoot()) {
			if (filterText === '' || '..'.startsWith(filterText)) {
				suggestions.push({ type: 'parent', name: currentPath + '..', display: '..' });
			}
		}
		
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
		suggestion.element = el;
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
		}
	}
}
