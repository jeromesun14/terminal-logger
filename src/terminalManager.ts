import * as vscode from 'vscode';
import * as path from 'path';
import { TerminalInfo } from './types';
import { ConfigManager } from './configManager';
import { LogWriter } from './logWriter';

/**
 * 终端管理器
 * 管理终端实例与 LogWriter 的映射关系。
 * 当 Shell Integration API 捕获到命令执行时，
 * 通过 logToTerminal() 将数据写入对应终端的日志文件。
 */
export class TerminalManager {
    private terminals: Map<vscode.Terminal, TerminalInfo> = new Map();
    private enabled: boolean = true;

    /**
     * 确保终端已注册（如果尚未注册，则创建 LogWriter）
     */
    ensureTerminalRegistered(terminal: vscode.Terminal): void {
        if (!this.enabled) {
            return;
        }

        if (this.terminals.has(terminal)) {
            return;
        }

        const config = ConfigManager.getConfig();
        const logDir = ConfigManager.getLogDirectory();
        const fileName = ConfigManager.formatFileName(
            config.fileNamePattern,
            terminal.name,
            new Date()
        );
        const logPath = path.join(logDir, fileName);
        const logWriter = new LogWriter(logPath, config.timestampFormat);

        this.terminals.set(terminal, {
            terminal,
            logPath,
            logWriter
        });
    }

    /**
     * 向指定终端的日志写入数据
     */
    logToTerminal(terminal: vscode.Terminal, data: string): void {
        if (!this.enabled) {
            return;
        }

        const info = this.terminals.get(terminal);
        if (info) {
            info.logWriter.write(data);
        }
    }

    /**
     * 注销终端，关闭对应的 LogWriter
     */
    unregisterTerminal(terminal: vscode.Terminal): void {
        const info = this.terminals.get(terminal);
        if (info) {
            info.logWriter.dispose();
            this.terminals.delete(terminal);
        }
    }

    getLogPaths(): string[] {
        const paths: string[] = [];
        this.terminals.forEach(info => {
            paths.push(info.logPath);
        });
        return paths;
    }

    getActiveTerminalCount(): number {
        return this.terminals.size;
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) {
            this.terminals.forEach(info => {
                info.logWriter.dispose();
            });
            this.terminals.clear();
        }
    }

    dispose(): void {
        this.terminals.forEach(info => {
            info.logWriter.dispose();
        });
        this.terminals.clear();
    }
}
