import * as vscode from 'vscode';
import * as path from 'path';
import { LogConfig } from './types';

export class ConfigManager {
    private static readonly SECTION = 'terminalLogger';

    static getConfig(): LogConfig {
        const config = vscode.workspace.getConfiguration(this.SECTION);
        return {
            enabled: config.get<boolean>('enabled', true),
            logPath: config.get<string>('logPath', ''),
            timestampFormat: config.get<string>('timestampFormat', '[YYYY-MM-DD HH:mm:ss]'),
            fileNamePattern: config.get<string>('fileNamePattern', 'terminal_{terminalName}_{date}.log'),
            includeInput: config.get<boolean>('includeInput', true)
        };
    }

    static getLogDirectory(): string {
        const config = this.getConfig();
        
        if (config.logPath) {
            return config.logPath;
        }

        // 默认使用工作区 .terminal-logs 目录
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            return path.join(workspaceFolders[0].uri.fsPath, '.terminal-logs');
        }

        // 如果没有工作区，使用用户主目录
        return path.join(require('os').homedir(), '.terminal-logs');
    }

    static formatTimestamp(format: string, date: Date = new Date()): string {
        const pad = (n: number) => n.toString().padStart(2, '0');
        
        return format
            .replace('YYYY', date.getFullYear().toString())
            .replace('MM', pad(date.getMonth() + 1))
            .replace('DD', pad(date.getDate()))
            .replace('HH', pad(date.getHours()))
            .replace('mm', pad(date.getMinutes()))
            .replace('ss', pad(date.getSeconds()));
    }

    static formatFileName(pattern: string, terminalName: string, date: Date = new Date()): string {
        const pad = (n: number) => n.toString().padStart(2, '0');
        
        const sanitizedTerminalName = terminalName.replace(/[<>:"/\\|?*]/g, '_');
        const dateStr = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
        const timeStr = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
        
        return pattern
            .replace('{terminalName}', sanitizedTerminalName)
            .replace('{date}', dateStr)
            .replace('{time}', timeStr);
    }

    static onDidChange(callback: () => void): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(this.SECTION)) {
                callback();
            }
        });
    }
}
