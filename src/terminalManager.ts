import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
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
    private shellIntegrationActive: Set<vscode.Terminal> = new Set();
    private readBrokenTerminals: Set<vscode.Terminal> = new Set();
    private scriptFallbackTerminals: Set<vscode.Terminal> = new Set();
    private enabled: boolean = true;
    private outputChannel: vscode.OutputChannel | undefined;

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
     * 标记终端正在通过 Shell Integration read() 接收数据
     */
    markShellIntegrationActive(terminal: vscode.Terminal): void {
        this.shellIntegrationActive.add(terminal);
    }

    /**
     * 取消标记
     */
    unmarkShellIntegrationActive(terminal: vscode.Terminal): void {
        this.shellIntegrationActive.delete(terminal);
    }

    /**
     * 检查终端是否正在通过 Shell Integration 接收数据
     */
    isShellIntegrationActive(terminal: vscode.Terminal): boolean {
        return this.shellIntegrationActive.has(terminal);
    }

    /**
     * 标记终端的 read() 不工作
     */
    markReadBroken(terminal: vscode.Terminal): void {
        this.readBrokenTerminals.add(terminal);
    }

    /**
     * 检查终端的 read() 是否已知不工作
     */
    isReadBroken(terminal: vscode.Terminal): boolean {
        return this.readBrokenTerminals.has(terminal);
    }

    /**
     * 设置 Output Channel 用于调试日志
     */
    setOutputChannel(channel: vscode.OutputChannel): void {
        this.outputChannel = channel;
    }

    /**
     * 为 read() 不工作的终端启用 script 命令 fallback。
     * 通过 `script` 命令将终端所有 I/O 记录到日志文件。
     * 仅在 Linux/macOS 下有效。
     */
    enableScriptFallback(terminal: vscode.Terminal): void {
        if (this.scriptFallbackTerminals.has(terminal)) {
            return;
        }

        this.ensureTerminalRegistered(terminal);
        const info = this.terminals.get(terminal);
        if (!info) {
            return;
        }

        this.scriptFallbackTerminals.add(terminal);

        const logDir = ConfigManager.getLogDirectory();
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        // 使用 script 命令将终端所有 I/O 追加到日志文件
        // Linux: script -q -f <file> (flush after each write)
        // macOS: script -q -a <file>
        // 使用 -q 静默模式，-a 追加模式
        const scriptLogPath = info.logPath;
        const scriptCmd = `script -q -a ${this.escapeShellArg(scriptLogPath)}`;

        this.outputChannel?.appendLine(`[Script Fallback] terminal="${terminal.name}", starting: ${scriptCmd}`);

        // 关闭 LogWriter，避免与 script 同时写入同一文件
        info.logWriter.dispose();

        terminal.sendText(scriptCmd, true);
    }

    /**
     * 检查终端是否已启用 script fallback
     */
    isScriptFallbackActive(terminal: vscode.Terminal): boolean {
        return this.scriptFallbackTerminals.has(terminal);
    }

    private escapeShellArg(arg: string): string {
        return `'${arg.replace(/'/g, "'\\''")}'`;
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
        this.readBrokenTerminals.delete(terminal);
        this.scriptFallbackTerminals.delete(terminal);
        this.shellIntegrationActive.delete(terminal);
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
