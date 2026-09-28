import * as vscode from 'vscode';
import { TerminalInfo } from './types';
import { ConfigManager } from './configManager';
import { LogWriter } from './logWriter';
import { allocateLogPath, createSessionId } from './format';

/**
 * 终端管理器
 * 管理终端实例与 LogWriter 的映射关系。
 * 每个终端会话使用独立日志文件，避免后打开的终端覆盖或关掉前一个终端的写入。
 */
export class TerminalManager {
    private terminals: Map<vscode.Terminal, TerminalInfo> = new Map();
    private enabled: boolean = true;

    /**
     * 确保终端已注册（如果尚未注册，则创建 LogWriter）
     * @param cwdOverride 自建 PTY 终端没有 shellIntegration，由调用方给出工作目录
     */
    ensureTerminalRegistered(terminal: vscode.Terminal, cwdOverride?: vscode.Uri): boolean {
        if (!this.enabled) {
            return false;
        }

        if (this.terminals.has(terminal)) {
            return false;
        }

        const config = ConfigManager.getConfig();
        const cwd = cwdOverride ?? terminal.shellIntegration?.cwd;
        const logDir = ConfigManager.getLogDirectory(cwd);
        const sessionId = createSessionId();
        const fileName = ConfigManager.formatFileName(
            config.fileNamePattern,
            terminal.name,
            new Date(),
            sessionId
        );
        const logPath = allocateLogPath(logDir, fileName, new Set(this.getLogPaths()), sessionId);
        const logWriter = new LogWriter({
            logPath,
            timestampFormat: config.timestampFormat,
            maxFileSizeBytes: config.maxFileSizeKB * 1024,
            overflowPolicy: config.overflowPolicy,
            maxRotatedFiles: config.maxRotatedFiles
        });

        this.terminals.set(terminal, {
            terminal,
            logPath,
            logWriter
        });

        return true;
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
