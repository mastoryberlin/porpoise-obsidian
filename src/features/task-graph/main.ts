/**
 * Task Graph Plugin - Modified for Porpoise
 * Uses H1 headers as tasks instead of markdown task lists
 */

import { Plugin, WorkspaceLeaf, TFile, debounce, Notice } from 'obsidian';
import type { Edge, Viewport } from 'reactflow';
import { TaskGraphView, VIEW_TYPE_TASK_GRAPH } from './TaskGraphView';
import { TaskGraphSettingTab } from './settings';
import { archiveBoard, restoreBoard, deleteArchivedBoard } from './boardArchive';
import { SaveQueue } from './saveQueue';
import { taskListsEqual } from './taskCacheEquality';
import { readTaskSnapshot, writeTaskSnapshot, snapshotMatches, TaskSnapshotEntry } from './taskSnapshot';
import type { GraphGroup } from './groups';
import { remapGraphReferences } from './groups';

export interface TextNodeData { id: string; text: string; x: number; y: number; }

export interface TaskCacheItem {
    id: string;
    text: string;
    notes: string;
    status: string;
    file: string;
    path: string;
    line: number;
    endLine: number;
    rawText: string;
    source: 'h1' | 'checklist' | 'tasknotes';
    rawStatus: string;
    statusCategory: 'backlog' | 'in_progress' | 'finished';
    parentLine?: number;
    notesStartLine?: number;
    notesEndLine?: number;
}

export interface GraphBoard {
    archived?: boolean;
    id: string;
    name: string;
    filters: {
        tags: string[];
        excludeTags: string[];
        folders: string[];
        status: string[];
        tagMode?: 'AND' | 'OR';
        conditions?: any[];
    };
    data: {
        layout: Record<string, { x: number; y: number }>;
        edges: Edge[];
        nodeStatus: Record<string, string>;
        textNodes: TextNodeData[];
        viewport?: Viewport;
        collapsedNodes?: Record<string, boolean>;
        taskPaths?: string[];
        generatedBlockIds?: string[];
        groups?: GraphGroup[];
    };
}

interface TaskGraphSettings {
    boards: GraphBoard[];
    lastActiveBoardId: string;
    autoFitAfterLayout: boolean;
    autoSyncHierarchy: boolean;
}

const DEFAULT_BOARD: GraphBoard = {
    id: 'default',
    name: 'Main board',
    filters: { tags: [], excludeTags: [], folders: ["prep/"], status: [' ', '/'], tagMode: 'OR' },
    data: { layout: {}, edges: [], nodeStatus: {}, textNodes: [] },
};

const DEFAULT_SETTINGS: TaskGraphSettings = {
    boards: [DEFAULT_BOARD],
    lastActiveBoardId: 'default',
    autoFitAfterLayout: true,
    autoSyncHierarchy: false,
};

/**
 * Parse H1 headers from content
 */
function parseH1Tasks(content: string, file: TFile): TaskCacheItem[] {
    const lines = content.split('\n');
    const tasks: TaskCacheItem[] = [];
    let currentNotes: string[] = [];
    let lastSeparatorLine = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const trimmedLine = line.trim();

        // Check for separator line
        if (trimmedLine === '---' || trimmedLine === '***') {
            lastSeparatorLine = i;
            continue;
        }

        // Check for H1 header
        const h1Match = trimmedLine.match(/^#\s+(.+)$/);
        if (h1Match) {
            const headerText = h1Match[1]!;

            // Determine status: ! suffix or below separator = in-progress
            let status = ' ';
            let statusCategory: 'backlog' | 'in_progress' | 'finished' = 'backlog';
            let isInProgressFromSeparator = false;

            if (headerText.endsWith('!')) {
                status = '/';
                statusCategory = 'in_progress';
            } else if (i > 0 && lastSeparatorLine === i - 1) {
                status = '/';
                statusCategory = 'in_progress';
                isInProgressFromSeparator = true;
            }

            // Create stable ID
            const cleanHeaderText = headerText.replace(/!$/, '').trim();
            const textHash = cleanHeaderText
                .substring(0, 50)
                .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '');
            const stableId = `${file.path}::#${textHash}`;

            const task: TaskCacheItem = {
                id: stableId,
                text: headerText, // Full header text including tags
                notes: currentNotes.join('\n').trim(),
                status,
                file: file.basename,
                path: file.path,
                line: i,
                endLine: i,
                rawText: trimmedLine,
                source: 'h1',
                rawStatus: status,
                statusCategory,
            };

            tasks.push(task);
            currentNotes = [];
        } else {
            if (tasks.length > 0) {
                currentNotes.push(line);
            }
        }
    }

    // Set endLine
    for (let i = 0; i < tasks.length; i++) {
        if (i < tasks.length - 1) {
            tasks[i]!.endLine = tasks[i + 1]!.line - 1;
        } else {
            tasks[i]!.endLine = lines.length - 1;
        }
    }

    return tasks;
}

export default class TaskGraphPlugin extends Plugin {
    settings!: TaskGraphSettings;
    viewRefresh?: () => void;

    taskCache: Map<string, TaskCacheItem[]> = new Map();
    isCacheInitialized: boolean = false;
    private settingsWriter = new SaveQueue(() => this.saveData(this.settings));
    private taskSnapshots = new Map<string, TaskSnapshotEntry>();
    private snapshotSignature = 'h1';
    private snapshotLoaded = false;
    private snapshotLoad: Promise<void> | undefined;
    private snapshotTimer: number | undefined;
    private snapshotDirty = false;
    private cacheRun = 0;
    private fileUpdates = new Map<string, number>();
    private snapshotWriter = new SaveQueue(async () => {
        await this.app.vault.adapter.write(this.snapshotPath(), writeTaskSnapshot(this.taskSnapshots, this.snapshotSignature));
    });

    private snapshotPath(): string {
        return `${this.manifest.dir || `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/task-cache.json`;
    }

    private ribbonIconElement: HTMLElement | null = null;

    private scheduleSnapshot(): void {
        this.snapshotDirty = true;
        if (!this.snapshotLoaded || this.snapshotTimer !== undefined) return;
        this.snapshotTimer = window.setTimeout(() => {
            this.snapshotTimer = undefined;
            this.snapshotDirty = false;
            void this.snapshotWriter.request().catch(error => console.error('Task graph cache write failed', error));
        }, 2000);
    }

    debouncedRefresh = debounce(() => {
        if (this.viewRefresh) this.viewRefresh();
    }, 500, true);

    persistTaskPathIndexes = debounce(() => {
        void this.saveSettings();
    }, 1000);

    async onload() {
        await this.loadSettings();
        await this.loadSnapshot();

        this.addSettingTab(new TaskGraphSettingTab(this.app, this));
        this.ribbonIconElement = this.addRibbonIcon('network', 'Open task graph', () => { void this.activateView(); });

        // Commands with porpoise: prefix
        this.addCommand({
            id: 'porpoise:open-task-graph',
            name: 'Open task graph',
            callback: () => { void this.activateView(); }
        });

        this.addCommand({
            id: 'porpoise:layout-task-graph',
            name: 'Auto-layout task graph (smart arrange)',
            callback: () => {
                const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_GRAPH);
                if (leaves.length > 0) {
                    const firstLeaf = leaves[0];
                    if (firstLeaf) {
                        const view = firstLeaf.view as TaskGraphView;
                        if (view.triggerLayout) {
                            view.triggerLayout();
                        } else {
                            new Notice("Layout engine is still loading...");
                        }
                    }
                } else {
                    new Notice("Task graph is not open.");
                }
            }
        });

        this.addCommand({
            id: 'porpoise:rebuild-task-index',
            name: 'Rebuild task document index',
            callback: () => { void this.initializeCache(true); }
        });

        this.registerEvent(this.app.metadataCache.on('changed', (file) => {
            void this.updateFileCache(file);
        }));

        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            this.taskSnapshots.delete(oldPath);
            this.fileUpdates.set(oldPath, (this.fileUpdates.get(oldPath) || 0) + 1);
            this.scheduleSnapshot();
            if (file instanceof TFile) void this.updateFileCache(file);
            if (this.taskCache.has(oldPath)) {
                const tasks = this.taskCache.get(oldPath);
                this.taskCache.delete(oldPath);
                const remap = (id: string) => id === oldPath ? file.path : id.startsWith(`${oldPath}::`) ? file.path + id.slice(oldPath.length) : id;
                if (tasks) this.taskCache.set(file.path, tasks.map(task => ({
                    ...task,
                    id: remap(task.id),
                    path: file.path,
                    file: file instanceof TFile ? file.basename : task.file
                })));
                for (const board of this.settings.boards) {
                    board.data = remapGraphReferences(board.data, remap);
                    if (board.data.taskPaths?.includes(oldPath)) {
                        board.data.taskPaths = board.data.taskPaths.map(path => path === oldPath ? file.path : path);
                    }
                }
                this.persistTaskPathIndexes();
                this.debouncedRefresh();
            }
        }));

        this.registerEvent(this.app.vault.on('delete', (file) => {
            this.taskSnapshots.delete(file.path);
            this.fileUpdates.set(file.path, (this.fileUpdates.get(file.path) || 0) + 1);
            this.scheduleSnapshot();
            if (this.taskCache.has(file.path)) {
                this.taskCache.delete(file.path);
                for (const board of this.settings.boards) {
                    if (board.data.taskPaths) board.data.taskPaths = board.data.taskPaths.filter(path => path !== file.path);
                }
                this.persistTaskPathIndexes();
                this.debouncedRefresh();
            }
        }));

        this.app.workspace.onLayoutReady(() => {
            void this.initializeCache();
        });
    }

    private async loadSnapshot(): Promise<void> {
        if (this.snapshotLoaded) return;
        if (!this.snapshotLoad) {
            this.snapshotLoad = (async () => {
                try {
                    const raw = await this.app.vault.adapter.read(this.snapshotPath());
                    const restored = readTaskSnapshot(raw, this.snapshotSignature);
                    for (const [path, entry] of this.taskSnapshots) restored.set(path, entry);
                    this.taskSnapshots = restored;
                } catch { /* A missing cache is normal on first startup. */ }
                this.snapshotLoaded = true;
            })();
        }
        await this.snapshotLoad;
    }

    async initializeCache(forceFullScan = false) {
        const run = ++this.cacheRun;
        await this.loadSnapshot();
        if (run !== this.cacheRun) return;

        const files = this.app.vault.getMarkdownFiles();
        const paths = new Set(files.map(file => file.path));

        for (const path of this.taskSnapshots.keys()) if (!paths.has(path)) this.taskSnapshots.delete(path);
        for (const path of this.taskCache.keys()) if (!paths.has(path)) this.taskCache.delete(path);

        const pending: TFile[] = [];
        for (const file of files) {
            const entry = this.taskSnapshots.get(file.path);
            if (snapshotMatches(entry, file.stat)) {
                if (entry!.tasks.length) this.taskCache.set(file.path, entry!.tasks as TaskCacheItem[]);
                else this.taskCache.delete(file.path);
            } else {
                pending.push(file);
            }
        }

        let nextIndex = 0;
        const worker = async () => {
            while (run === this.cacheRun && nextIndex < pending.length) {
                const file = pending[nextIndex++];
                if (file) await this.updateFileCache(file, false);
            }
        };

        await Promise.all(Array.from({ length: Math.min(8, pending.length) }, () => worker()));
        if (run !== this.cacheRun) return;

        const taskPaths = [...this.taskCache.keys()];
        if (this.settings.boards.some(board => JSON.stringify(board.data.taskPaths) !== JSON.stringify(taskPaths))) {
            for (const board of this.settings.boards) board.data.taskPaths = [...taskPaths];
            await this.saveSettings();
        }

        this.isCacheInitialized = true;
        this.scheduleSnapshot();
        this.debouncedRefresh();
    }

    async updateFileCache(file: import('obsidian').TAbstractFile, triggerRefresh = true) {
        if (!(file instanceof TFile) || file.extension !== 'md') return;

        const entry = this.taskSnapshots.get(file.path);
        if (this.snapshotSignature && snapshotMatches(entry, file.stat)) {
            this.storeFileTasks(file.path, entry!.tasks as TaskCacheItem[], triggerRefresh);
            return;
        }

        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache) return;

        const revision = (this.fileUpdates.get(file.path) || 0) + 1;
        this.fileUpdates.set(file.path, revision);
        const stat = { mtime: file.stat.mtime, size: file.stat.size };

        const commit = (tasks: TaskCacheItem[]) => {
            if (this.fileUpdates.get(file.path) !== revision || file.stat.mtime !== stat.mtime
                || file.stat.size !== stat.size || this.app.vault.getAbstractFileByPath(file.path) !== file) return;
            const previous = this.taskSnapshots.get(file.path);
            if (!snapshotMatches(previous, stat) || !taskListsEqual(previous?.tasks, tasks)) {
                this.taskSnapshots.set(file.path, { ...stat, tasks });
                this.scheduleSnapshot();
            }
            this.storeFileTasks(file.path, tasks, triggerRefresh);
        };

        // Use H1 parsing only
        const content = await this.app.vault.cachedRead(file);
        const tasks = parseH1Tasks(content, file);
        commit(tasks);
    }

    private storeFileTasks(path: string, tasks: TaskCacheItem[], triggerRefresh: boolean) {
        const previous = this.taskCache.get(path);
        if ((!previous || previous.length === 0) && tasks.length === 0) {
            if (triggerRefresh && this.isCacheInitialized) this.trackTaskPath(path, false);
            return;
        }
        if (taskListsEqual(previous, tasks)) return;
        if (tasks.length) this.taskCache.set(path, tasks);
        else this.taskCache.delete(path);
        if (triggerRefresh && this.isCacheInitialized) this.trackTaskPath(path, tasks.length > 0);
        if (triggerRefresh && this.isCacheInitialized) this.debouncedRefresh();
    }

    private trackTaskPath(path: string, hasTasks: boolean) {
        let changed = false;
        for (const board of this.settings.boards) {
            if (!board.data.taskPaths) continue;
            const paths = board.data.taskPaths;
            const index = paths.indexOf(path);
            if (hasTasks && index === -1) {
                paths.push(path);
                changed = true;
            } else if (!hasTasks && index !== -1) {
                paths.splice(index, 1);
                changed = true;
            }
        }
        if (changed) this.persistTaskPathIndexes();
    }

    onunload() {
        this.cacheRun++;
        if (this.snapshotTimer !== undefined) window.clearTimeout(this.snapshotTimer);
        if (this.snapshotLoaded && this.snapshotDirty) {
            void this.snapshotWriter.request().catch(error => console.error('Task graph cache write failed', error));
        }
        // Close all task graph views
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_GRAPH);
        for (const leaf of leaves) {
            leaf.detach();
        }
        // Remove ribbon icon
        if (this.ribbonIconElement) {
            this.ribbonIconElement.remove();
            this.ribbonIconElement = null;
        }
    }


    async getPrepFolder(): Promise<string> {
        try {
            const configFile = this.app.vault.getAbstractFileByPath('porpoise-config.json');
            if (configFile instanceof TFile) {
                const content = await this.app.vault.read(configFile);
                const config = JSON.parse(content);
                if (config?.folders?.prepFiles) {
                    return config.folders.prepFiles + '/';
                }
            }
        } catch (e) {
            // Ignore errors
        }
        return 'prep/';
    }


    async loadSettings() {
        const loadedData = (await this.loadData()) as Partial<TaskGraphSettings> | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
        
        // Add prep folder filter from porpoise-config.json to boards without folder filters
        const prepFolder = await this.getPrepFolder();
        for (const board of this.settings.boards) {
            if (!board.filters?.folders?.length) {
                board.filters = { ...board.filters, folders: [prepFolder] };
            }
        }
        const first = this.settings.boards[0];
        
        if (first && !this.settings.boards.some(board => !board.archived)) {
            this.settings.boards = archiveBoard(this.settings.boards, first.id, this.app.vault).boards;
        }
        const active = this.settings.boards.find(board => board.id === this.settings.lastActiveBoardId && !board.archived)
            || this.settings.boards.find(board => !board.archived);
        if (active) this.settings.lastActiveBoardId = active.id;
    }

    async saveSettings() {
        await this.settingsWriter.request();
    }

    async archiveBoard(id: string): Promise<string> {
        const result = archiveBoard(this.settings.boards, id);
        this.settings.boards = result.boards;
        if (this.settings.lastActiveBoardId === id) this.settings.lastActiveBoardId = result.nextBoardId;
        await this.saveSettings();
        this.viewRefresh?.();
        return result.nextBoardId;
    }

    async restoreBoard(id: string): Promise<void> {
        this.settings.boards = restoreBoard(this.settings.boards, id);
        await this.saveSettings();
        this.viewRefresh?.();
    }

    async deleteArchivedBoard(id: string): Promise<void> {
        this.settings.boards = deleteArchivedBoard(this.settings.boards, id);
        await this.saveSettings();
        this.viewRefresh?.();
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null | undefined = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_TASK_GRAPH);
        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            const centerLeaf = workspace.getLeaf('tab');
            if (centerLeaf) {
                leaf = centerLeaf;
                await leaf.setViewState({ type: VIEW_TYPE_TASK_GRAPH, active: true });
            }
        }
        if (leaf) workspace.setActiveLeaf(leaf, { focus: true });
    }

    getTasks(boardId: string): TaskCacheItem[] {
        const board = this.settings.boards.find(b => b.id === boardId);
        if (!board) return [];
        const taskPaths = board.data.taskPaths || [];
        const tasks: TaskCacheItem[] = [];
        for (const path of taskPaths) {
            const fileTasks = this.taskCache.get(path);
            if (fileTasks) tasks.push(...fileTasks);
        }
        return tasks;
    }

    // Stub methods for TaskGraphView compatibility
    async saveBoardData(boardId: string, data: Partial<GraphBoard['data']>): Promise<void> {
        const board = this.settings.boards.find(b => b.id === boardId);
        if (board) {
            board.data = { ...board.data, ...data };
            await this.saveSettings();
        }
    }

    async updateTaskContent(filePath: string, startLine: number, endLine: number, newText: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        if (startLine >= lines.length) return;
        
        // For H1 tasks, if we're updating the header line, ensure it has the # prefix
        if (lines[startLine]?.trim().startsWith('#')) {
            // Ensure newText is a valid H1 header
            if (!newText.trim().startsWith('#')) {
                newText = `# ${newText.trim()}`;
            }
        }
        
        lines[startLine] = newText;
        await this.app.vault.modify(file, lines.join('\n'));
        void this.updateFileCache(file);
    }

    async clearTaskIndexAndGeneratedBlockIds(): Promise<number> {
        this.taskCache.clear();
        this.taskSnapshots.clear();
        this.isCacheInitialized = true;
        this.scheduleSnapshot();
        await this.saveSettings();
        this.debouncedRefresh();
        return 0;
    }

    async ensureBlockId(boardId: string, taskId: string): Promise<string> {
        return taskId;
    }

    // Stub methods for TaskGraphView compatibility with H1 headers
    async updateTaskNotesStatus(path: string, category: 'backlog' | 'in_progress' | 'finished'): Promise<void> {
        // For H1 headers, we update the header text based on category
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return;
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        // Find the H1 header and update its status marker
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i]!.trim();
            const h1Match = trimmed.match(/^#\s+(.+)$/);
            if (h1Match) {
                let headerText = h1Match[1]!;
                // Remove existing ! if present
                headerText = headerText.replace(/!$/, '').trim();
                // Add ! for in-progress
                if (category === 'in_progress') {
                    headerText = `${headerText}!`;
                }
                lines[i] = `# ${headerText}`;
                break;
            }
        }
        await this.app.vault.modify(file, lines.join('\n'));
        void this.updateFileCache(file);
    }

    async updateTaskNotesContent(path: string, text: string, startLine?: number, endLine?: number): Promise<void> {
        // For H1 headers, notes are the lines between the header and the next section
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return;
        
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        
        // If line info is provided, update that specific section
        if (startLine !== undefined && endLine !== undefined) {
            // Replace lines from startLine+1 to endLine with the new notes
            const notesLines = text.split('\n');
            
            // Build new content
            const newLines = [
                ...lines.slice(0, startLine + 1),
                ...notesLines,
                ...lines.slice(endLine + 1)
            ];
            
            await this.app.vault.modify(file, newLines.join('\n'));
            await this.updateFileCache(file);
            return;
        }
        
        // Fallback: append notes to end of file (shouldn't happen with proper callers)
        await this.appendTaskToFile(path, text);
    }

    async appendTaskToFile(filePath: string, content: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return '';
        const current = await this.app.vault.read(file);
        const newContent = `${current}\n\n${content}`;
        await this.app.vault.modify(file, newContent);
        await this.updateFileCache(file, false);
        // Return the path as a simple ID (the actual ID will be generated by the parser)
        return filePath;
    }

    async updateBoardConfig(boardId: string, config: Partial<GraphBoard>): Promise<void> {
        const board = this.settings.boards.find(b => b.id === boardId);
        if (board) {
            Object.assign(board, config);
            await this.saveSettings();
        }
    }
}
