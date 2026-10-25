import { Plugin } from 'obsidian';
import { PathAutocompleteSuggest } from './autocomplete/pathSuggest';
import {
	DEFAULT_SETTINGS as DEFAULT_PATH_SETTINGS,
	MyPluginSettings as PathSettings,
	SampleSettingTab as PathSettingTab,
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
	taskGraphPlugin?: TaskGraphPlugin;

	async onload() {
		await this.loadSettings();

		// Load path autocomplete
		this.registerEditorSuggest(new PathAutocompleteSuggest(this.app));

		// Load task graph feature
		this.taskGraphPlugin = new TaskGraphPlugin(this.app);
		this.taskGraphPlugin.manifest = this.manifest;
		await this.taskGraphPlugin.onload();

		// Settings tab
		this.addSettingTab(new PathSettingTab(this.app, this));
	}

	onunload() {
		if (this.taskGraphPlugin) {
			this.taskGraphPlugin.onunload();
		}
	}

	async loadSettings() {
		const loadedData = (await this.loadData()) as Partial<PorpoiseSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
