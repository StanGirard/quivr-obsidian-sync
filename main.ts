import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { requestUrl } from 'obsidian';
import axios, { AxiosInstance } from 'axios';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	apiKey: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	apiKey: ''
}

// Define the AddKnowledgeFileData interface
export interface AddKnowledgeFileData {
	parent_id: string | null;
	file_name: string;
	is_folder: boolean;
}

// Define the addKnowledgeFile function
export const addKnowledgeFile = async (
	knowledgeData: AddKnowledgeFileData,
	file: File,
	axiosInstance: AxiosInstance
): Promise<any> => {
	const formData = new FormData();
	formData.append("knowledge_data", JSON.stringify(knowledgeData));
	formData.append("file", file);

	return (
		await axiosInstance.post(`/knowledge/`, formData, {
			headers: {
				"Content-Type": "multipart/form-data",
			},
		})
	).data;
};

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Quivr Sync', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('This is a notice!');
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'quivr-sync',
			name: 'Sync to Quivr',
			callback: async () => {
				new Notice('Starting sync to Quivr...');
				const rootFolder = this.app.vault.getRoot();
				new Notice(`Root folder: ${rootFolder.name}`);
				await this.exploreAndUpload();
				new Notice('Finished uploading files. Fetching files from Quivr...');
				const files = await this.fetchFiles();
				const folders = files.filter(file => file.is_folder);
				new Notice(`Folders: ${folders.map(folder => folder.file_name).join(', ')}`);
				new Notice('Sync complete.');
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));

		this.addRibbonIcon('upload', 'Upload Files', async () => {
			await this.exploreAndUpload();
		});
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async fetchFiles() {
		try {
			const response = await requestUrl({
				url: 'https://api.quivr.app/knowledge/files',
				method: 'GET',
				headers: {
					'accept': 'application/json',
					'Authorization': `Bearer ${this.settings.apiKey}`
				},
			});

			if (response.status === 200) {
				const files = response.json;
				return files;
			} else {
				new Notice(`Failed to fetch files: ${response.status} ${response.json}`);
				console.error(`Failed to fetch files: ${response.status} ${response.json}`);
				return [];
			}
		} catch (error) {
			console.error('Error fetching files:', error);
			new Notice('Error fetching files. Check console for details.');
			return [];
		}
	}

	async createFolder(folderName: string): Promise<string | null> {
		try {
			const response = await requestUrl({
				url: 'https://api.quivr.app/knowledge/',
				method: 'POST',
				headers: {
					'accept': 'application/json',
					'Authorization': `Bearer ${this.settings.apiKey}`,
					'content-type': 'multipart/form-data; boundary=----WebKitFormBoundaryjpD4mAhPBDMdS5QN'
				},
				body: `------WebKitFormBoundaryjpD4mAhPBDMdS5QN\r\nContent-Disposition: form-data; name="knowledge_data"\r\n\r\n{"parent_id":null,"file_name":"${folderName}","is_folder":true}\r\n------WebKitFormBoundaryjpD4mAhPBDMdS5QN--\r\n`
			});

			if (response.status === 200) {
				const responseData = response.json;
				const folderId = responseData.id;
				new Notice(`Folder "${folderName}" created successfully with ID: ${folderId}.`);
				return folderId;
			} else {
				new Notice(`Failed to create folder "${folderName}".`);
				new Notice(response.json);
				return null;
			}
		} catch (error) {
			console.error(`Error creating folder "${folderName}":`, error);
			new Notice(`Error creating folder "${folderName}".`);
			return null;
		}
	}

	async exploreAndUpload() {
		const markdownFiles = this.app.vault.getMarkdownFiles();
		const files = await this.fetchFiles();
		new Notice(`Found Quivr files: ${files.map(file => file.file_name).join(', ')}`);
		let obsidianSyncFolderId: string | null = null;

		// Check if the folder already exists in Quivr
		const existingFolder = files.find(file => file.file_name === 'obsidian-sync' && file.is_folder);
		if (existingFolder) {
			new Notice(`Found existing folder: ${existingFolder.file_name}`);
			obsidianSyncFolderId = existingFolder.id;
		} else {
			// Create the folder in Quivr if it doesn't exist
			new Notice('Creating new folder in Quivr...');
			obsidianSyncFolderId = await this.createFolder('obsidian-sync');
		}

		if (obsidianSyncFolderId) {
			for (const file of markdownFiles) {
				new Notice(`Uploading file: ${file.name}`);
				await this.uploadFile(file, obsidianSyncFolderId);
			}
		} else {
			new Notice('Failed to determine folder ID for uploads.');
		}
	}

	async uploadFile(file: TFile, parentId: string | null) {
		try {
			const fileContent = await this.app.vault.read(file);
			const blob = new Blob([fileContent], { type: file.extension === 'md' ? 'text/markdown' : 'application/pdf' });
			const fileToUpload = new File([blob], file.name);

			const knowledgeData: AddKnowledgeFileData = {
				parent_id: parentId,
				file_name: file.name,
				is_folder: false
			};

			const axiosInstance = axios.create({
				baseURL: 'https://api.quivr.app',
				headers: {
					"Authorization": `Bearer ${this.settings.apiKey}`
				}
			});

			const response = await addKnowledgeFile(knowledgeData, fileToUpload, axiosInstance);

			new Notice(`File uploaded successfully: ${file.name}`);
		} catch (error) {
			new Notice(`Error uploading file "${file.name}": ${error}`, 10000);
		}
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
		
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Your Quivr API key')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));
	}
}
