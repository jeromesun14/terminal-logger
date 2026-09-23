import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { formatFileName, formatTimestamp, loggingToggleTarget, pickWorkspaceRoot } from './format';
import { LogConfig } from './types';

export class ConfigManager {
    private static readonly SECTION = 'terminalLogger';

    static getConfig(): LogConfig {
        const config = vscode.workspace.getConfiguration(this.SECTION);
        return {
            enabled: config.get<boolean>('enabled', true),
            logPath: config.get<string>('logPath', ''),
            timestampFormat: config.get<string>('timestampFormat', '[YYYY-MM-DD HH:mm:ss]'),
            fileNamePattern: config.get<string>('fileNamePattern', 'terminal_{terminalName}_{date}_{time}_{session}.log'),
            includeInput: config.get<boolean>('includeInput', true),
            showStatusBar: config.get<boolean>('showStatusBar', true),
            showActivationMessage: config.get<boolean>('showActivationMessage', true),
            maxFileSizeKB: Math.max(0, config.get<number>('maxFileSizeKB', 512) ?? 512),
            overflowPolicy: config.get<string>('overflowPolicy', 'discard') === 'rotate' ? 'rotate' : 'discard',
            maxRotatedFiles: Math.max(0, config.get<number>('maxRotatedFiles', 3) ?? 3)
        };
    }

    static getLogDirectory(cwd?: vscode.Uri): string {
        const config = this.getConfig();

        if (config.logPath && config.logPath.trim()) {
            return config.logPath;
        }

        const folders = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
        const root = pickWorkspaceRoot(cwd?.fsPath, folders);
        if (root) {
            return path.join(root, '.terminal-logs');
        }

        return path.join(os.homedir(), '.terminal-logs');
    }

    static formatTimestamp(format: string, date: Date = new Date()): string {
        return formatTimestamp(format, date);
    }

    static formatFileName(pattern: string, terminalName: string, date: Date = new Date(), sessionId?: string): string {
        return formatFileName(pattern, terminalName, date, sessionId);
    }

    static toggleTarget(): vscode.ConfigurationTarget {
        const kind = loggingToggleTarget((vscode.workspace.workspaceFolders?.length ?? 0) > 0);
        return kind === 'workspace'
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
    }

    static onDidChange(callback: () => void): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(this.SECTION)) {
                callback();
            }
        });
    }
}
