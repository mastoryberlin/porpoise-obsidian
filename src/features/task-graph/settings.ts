import { PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import TaskGraphPlugin from "./main";
import { isSimplifiedChinese } from "./language";
import { ClearIndexModal } from "./clearIndexModal";

export class TaskGraphSettingTab extends PluginSettingTab {
    plugin: TaskGraphPlugin;
    private clearIndexModal?: ClearIndexModal;

    constructor(app: App, plugin: TaskGraphPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        const zh = isSimplifiedChinese();
        
        // Auto-fit setting
        new Setting(containerEl)
            .setName(zh ? '布局后自动适应' : 'Auto-fit after layout')
            .setDesc(zh ? '在自动布局后自动缩放视图以适应所有节点' : 'Automatically fit the viewport to show all nodes after auto-layout')
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.autoFitAfterLayout);
                toggle.onChange(async (value) => {
                    this.plugin.settings.autoFitAfterLayout = value;
                    await this.plugin.saveSettings();
                });
                return toggle;
            });
        
        // Sync hierarchy setting
        new Setting(containerEl)
            .setName(zh ? '布局前同步层级' : 'Sync hierarchy before layout')
            .setDesc(zh ? '在自动布局前同步任务层级关系' : 'Synchronize task hierarchy relationships before auto-layout')
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.autoSyncHierarchy);
                toggle.onChange(async (value) => {
                    this.plugin.settings.autoSyncHierarchy = value;
                    await this.plugin.saveSettings();
                });
                return toggle;
            });

        // Clear index button
        containerEl.createEl('hr');
        new Setting(containerEl)
            .setName(zh ? '清除任务索引' : 'Clear task index')
            .setDesc(zh ? '清除看板索引、任务引用。不会删除任务内容。' : 'Clear board indexes and task references. Task content will not be deleted.')
            .addButton((button) => {
                button.setButtonText(zh ? '清除' : 'Clear');
                button.setCta();
                button.onClick(() => this.confirmClearTaskIndex());
                return button;
            });

        // Archived boards section
        containerEl.createEl('hr');
        const archiveSection = containerEl.createDiv();
        archiveSection.createEl('h3', { text: zh ? '已归档画板' : 'Archived boards' });
        this.renderArchivedBoards(archiveSection);
    }

    private renderArchivedBoards(containerEl: HTMLElement): void {
        const zh = isSimplifiedChinese();
        const { settings } = this.plugin;
        const archivedBoards = settings.boards.filter(b => b.archived);
        
        if (archivedBoards.length === 0) {
            containerEl.createEl('p', { text: zh ? '没有已归档的画板' : 'No archived boards' });
            return;
        }

        const list = containerEl.createEl('ul');
        for (const board of archivedBoards) {
            const item = list.createEl('li');
            item.createEl('span', { text: board.name });
            
            const restoreBtn = item.createEl('button', { text: zh ? '恢复' : 'Restore' });
            restoreBtn.addEventListener('click', async () => {
                await this.plugin.restoreBoard(board.id);
            });
            
            const deleteBtn = item.createEl('button', { text: zh ? '删除' : 'Delete' });
            deleteBtn.addEventListener('click', async () => {
                await this.plugin.deleteArchivedBoard(board.id);
            });
        }
    }

    private confirmClearTaskIndex(): void {
        if (this.clearIndexModal) return;
        this.clearIndexModal = new ClearIndexModal(
            this.app,
            () => this.plugin.clearTaskIndexAndGeneratedBlockIds(),
            () => { this.clearIndexModal = undefined; }
        );
        this.clearIndexModal.open();
    }
}
