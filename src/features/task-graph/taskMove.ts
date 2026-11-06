/**
 * Moving H1 task sections between their original note and the sibling `_done.md`
 * note, following the same conventions as the `por prep` CLI: active sections live
 * above the first `---` separator, issued ones below it, finished ones in `_done.md`.
 */
import { App, Notice, TFile } from 'obsidian';
import type { TaskCacheItem } from './main';

const H1_PATTERN = /^#\s+(.+)$/;

/** Path of the `_done.md` note accompanying a task's note (same folder, or vault root). */
export function doneNotePath(path: string): string {
    const parts = path.split('/');
    parts[parts.length - 1] = '_done.md';
    return parts.join('/');
}

const isSeparator = (line: string): boolean => {
    const trimmed = line.trim();
    return trimmed === '---' || trimmed === '***';
};

const headerTitle = (line: string | undefined): string | null => {
    const match = line?.trim().match(H1_PATTERN);
    return match ? match[1]! : null;
};

/**
 * Finds the line of a task's H1 header. Prefers the recorded line when it still
 * holds the same title, then falls back to a title scan (the file may have shifted).
 * Returns -1 when the section cannot be located safely.
 */
export function locateTaskHeader(lines: string[], line: number, title: string): number {
    const expected = title.trim();
    if (headerTitle(lines[line])?.trim() === expected) return line;
    return lines.findIndex(candidate => headerTitle(candidate)?.trim() === expected);
}

/** Removes the task's section (header + body) from `lines` and returns it. */
function takeSection(lines: string[], task: TaskCacheItem): { start: number, section: string[] } | null {
    const start = locateTaskHeader(lines, task.line, task.text);
    if (start === -1) return null;
    let end = lines.length - 1;
    for (let i = start + 1; i < lines.length; i++) {
        if (headerTitle(lines[i]) !== null) { end = i - 1; break; }
    }
    // Keep separators and blank padding that structure the note; move only the section.
    while (end > start && (lines[end]!.trim() === '' || isSeparator(lines[end]!))) end--;
    const section = lines.splice(start, end - start + 1);
    // Collapse the blank gap a removal can leave behind.
    if (start === 0) {
        while (lines.length && lines[0]!.trim() === '') lines.shift();
    } else if (start < lines.length && lines[start]!.trim() === '' && lines[start - 1]!.trim() === '') {
        lines.splice(start, 1);
    }
    return { start, section };
}

/** Insertion point in a note: below issued content (its end) or above the first separator. */
function insertIndex(lines: string[], appendAtEnd: boolean): number {
    if (appendAtEnd) return lines.length;
    const separator = lines.findIndex(line => isSeparator(line));
    return separator === -1 ? lines.length : separator;
}

const joinBlocks = (first: string[], second: string[]): string[] =>
    (first.length && second.length) ? [...first, '', ...second] : [...first, ...second];

/**
 * Moves a task's section into another note, separated by one blank line. Sections
 * without an issue link are inserted above the target's first separator (the active
 * area); issued ones are appended at the end, like `por prep` orders them.
 */
export async function moveTaskSection(app: App, task: TaskCacheItem, targetPath: string, appendAtEnd: boolean): Promise<boolean> {
    const source = app.vault.getAbstractFileByPath(task.path);
    if (!(source instanceof TFile)) return false;
    const target = app.vault.getAbstractFileByPath(targetPath);
    if (!(target instanceof TFile)) {
        const folder = targetPath.split('/').slice(0, -1).join('/');
        if (folder && !app.vault.getAbstractFileByPath(folder)) {
            new Notice(`Task graph cannot move the task: folder of "${targetPath}" is missing.`);
            return false;
        }
    }

    const sourceLines = (await app.vault.read(source)).split('\n');
    const taken = takeSection(sourceLines, task);
    if (!taken) {
        new Notice('Task graph could not find the task section in its note.');
        return false;
    }
    const targetLines = target instanceof TFile ? (await app.vault.read(target)).split('\n') : [];

    const index = insertIndex(targetLines, appendAtEnd);
    const before = targetLines.slice(0, index);
    const after = targetLines.slice(index);
    while (before.length && before[before.length - 1]!.trim() === '') before.pop();
    while (after.length && after[0]!.trim() === '') after.shift();
    const nextTarget = joinBlocks(joinBlocks(before, taken.section), after);

    await app.vault.modify(source, sourceLines.join('\n'));
    try {
        if (target instanceof TFile) await app.vault.modify(target, nextTarget.join('\n'));
        else await app.vault.create(targetPath, nextTarget.join('\n'));
    } catch (error) {
        console.error('Task graph task move failed', error);
        sourceLines.splice(taken.start, 0, ...taken.section);
        await app.vault.modify(source, sourceLines.join('\n'));
        new Notice('Task graph could not move the task.');
        return false;
    }
    return true;
}

/**
 * Appends or removes the trailing `!` ready marker of a task's H1 title, as written
 * by `por prep` / picked up by `por watch`. Returns the replacement header line and
 * its index, or null when the header cannot be located.
 */
export function toggleReadyLine(lines: string[], line: number, title: string): { index: number, header: string } | null {
    const index = locateTaskHeader(lines, line, title);
    if (index === -1) return null;
    const current = headerTitle(lines[index]);
    if (current === null) return null;
    const nextTitle = current.endsWith('!')
        ? current.replace(/!\s*$/, '').trimEnd()
        : `${current.trimEnd()}!`;
    return { index, header: `# ${nextTitle}` };
}
