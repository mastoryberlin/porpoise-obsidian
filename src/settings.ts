import { App, PluginSettingTab, Setting } from 'obsidian';
import PorpoisePlugin from './main';

export interface PathSettings {
	mySetting: string;
}

export const DEFAULT_PATH_SETTINGS: PathSettings = {
	mySetting: 'default',
};

export class PathSettingTab extends PluginSettingTab {
	plugin: PorpoisePlugin;

	constructor(app: App, plugin: PorpoisePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Path autocomplete settings')
			.setDesc("Path autocomplete settings")
			.addText((text) =>
				text
					.setPlaceholder('Enter your secret')
					.setValue(this.plugin.settings.pathSettings.mySetting)
					.onChange(async (value) => {
						this.plugin.settings.pathSettings.mySetting = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
