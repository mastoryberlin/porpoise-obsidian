import { Editor, Plugin } from 'obsidian';
import { PathAutocompleteSuggest } from './autocomplete/pathSuggest';
import {
	DEFAULT_PATH_SETTINGS,
	PathSettings,
	PathSettingTab,
} from './settings';
import TaskGraphPlugin from './features/task-graph/main';

// Combined settings
export interface PorpoiseSettings {
	pathSettings: PathSettings;
}

export const DEFAULT_SETTINGS: PorpoiseSettings = {
	pathSettings: DEFAULT_PATH_SETTINGS,
};

// Main plugin class
export default class PorpoisePlugin extends Plugin {
	settings!: PorpoiseSettings;
	taskGraphPlugin!: TaskGraphPlugin;

	async onload() {
		await this.loadSettings();

		// Load path autocomplete
		const suggest = new PathAutocompleteSuggest(this.app);
		this.registerEditorSuggest(suggest);

		// Load task graph feature
		this.taskGraphPlugin = new TaskGraphPlugin(this.app, this.manifest);
		await this.taskGraphPlugin.onload();

		// Settings tab
		this.addSettingTab(new PathSettingTab(this.app, this));
	}

	onunload() {
		this.taskGraphPlugin.onunload();
	}

	async loadSettings() {
		const loadedData = (await this.loadData()) as Partial<PorpoiseSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
