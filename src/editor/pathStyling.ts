/**
 * CodeMirror 6 plugin for styling @path references with monospace font
 */

import { StateField, RangeSetBuilder, Extension, EditorState, Transaction } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';

/**
 * Decoration for path references starting with @
 */
const pathRefDecoration = Decoration.mark({
	class: 'porpoise-path-ref',
});

/**
 * Regex to match @path patterns
 * Matches @ followed by path characters (letters, numbers, -, _, ., /)
 * Does NOT match @ with spaces or special punctuation
 */
const pathRefRegex = /(@[a-zA-Z0-9_\-\.\/]+)/g;

/**
 * Create decorations for all @path references in the document
 */
function createPathDecorations(state: EditorState): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const text = state.doc.toString();
	
	let match;
	pathRefRegex.lastIndex = 0; // Reset regex state
	
	while ((match = pathRefRegex.exec(text)) !== null) {
		const from = match.index;
		const to = from + match[0].length;
		
		// Get the line that contains this match
		const line = state.doc.lineAt(from);
		const lineFrom = line.from;
		
		// Add decoration for this path reference
		builder.add(
			from + lineFrom,
			to + lineFrom,
			pathRefDecoration
		);
	}
	
	return builder.finish();
}

/**
 * State field for path decorations
 */
const pathDecorations: StateField<DecorationSet> = StateField.define<DecorationSet>({
	create(state: EditorState): DecorationSet {
		return createPathDecorations(state);
	},
	update(decorations: DecorationSet, tr: Transaction): DecorationSet {
		// If the transaction changes the document, recompute decorations
		if (tr.docChanged) {
			return createPathDecorations(tr.startState);
		}
		return decorations.map(tr.changes);
	},
	provide: (f: StateField<DecorationSet>): Extension => EditorView.decorations.from(f),
});

/**
 * Theme extension for styling path references
 */
const pathTheme = EditorView.baseTheme({
	'.porpoise-path-ref': {
		fontFamily: 'var(--font-monospace, monospace)',
		fontVariantLigatures: 'none',
	},
});

/**
 * Main plugin extension for path styling
 */
export const pathStylingPlugin: Extension = [
	pathTheme,
	pathDecorations,
];
