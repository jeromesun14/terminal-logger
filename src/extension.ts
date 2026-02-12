import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from './configManager';
import { TerminalManager } from './terminalManager';
import { StatusBarManager } from './statusBarManager';

let terminalManager: TerminalManager;
let statusBarManager: StatusBarManager;
let isEnabled: boolean = true;

export function activate(context: vscode.ExtensionContext) {
    console.log('Terminal Logger 扩展已激活');

    // 初始化状态栏
    statusBarManager = new StatusBarManager();
    context.subscriptions.push(statusBarManager);

    // 初始化终端管理器
    terminalManager = new TerminalManager();
    context.subscriptions.push(terminalManager);

    // 监听配置变更
    context.subscriptions.push(
        ConfigManager.onDidChange(() => {
            const config = ConfigManager.getConfig();
            isEnabled = config.enabled;
            statusBarManager.setEnabled(isEnabled);
            terminalManager.setEnabled(isEnabled);
        })
    );

    // ============================================================
    // 核心：使用 Shell Integration API 监听 IDE 自带终端的命令执行
    // ============================================================

    // 当终端中有命令开始执行时
    context.subscriptions.push(
        vscode.window.onDidStartTerminalShellExecution(async (event) => {
            if (!isEnabled) {
                return;
            }

            const terminal = event.terminal;
            const execution = event.execution;
            const commandLine = execution.commandLine.value;

            // 确保该终端已注册 LogWriter
            terminalManager.ensureTerminalRegistered(terminal);

            // 记录命令本身
            const config = ConfigManager.getConfig();
            if (config.includeInput) {
                terminalManager.logToTerminal(terminal, `$ ${commandLine}`);
            }

            // 流式读取命令输出
            try {
                const stream = execution.read();
                for await (const data of stream) {
                    if (!isEnabled) {
                        break;
                    }
                    terminalManager.logToTerminal(terminal, data);
                }
            } catch (err: any) {
                console.error(`Terminal Logger: 读取命令输出失败: ${err.message}`);
            }
        })
    );

    // 当终端中命令执行结束时（可选：记录退出码）
    context.subscriptions.push(
        vscode.window.onDidEndTerminalShellExecution((event) => {
            if (!isEnabled) {
                return;
            }
            const exitCode = event.exitCode;
            if (exitCode !== undefined && exitCode !== 0) {
                terminalManager.logToTerminal(
                    event.terminal,
                    `[命令退出码: ${exitCode}]`
                );
            }
        })
    );

    // 监听终端关闭，清理资源
    context.subscriptions.push(
        vscode.window.onDidCloseTerminal((terminal) => {
            terminalManager.unregisterTerminal(terminal);
            statusBarManager.setTerminalCount(terminalManager.getActiveTerminalCount());
        })
    );

    // 注册命令：切换日志记录
    const toggleCommand = vscode.commands.registerCommand(
        'terminalLogger.toggle',
        async () => {
            isEnabled = !isEnabled;

            const config = vscode.workspace.getConfiguration('terminalLogger');
            await config.update('enabled', isEnabled, vscode.ConfigurationTarget.Global);

            statusBarManager.setEnabled(isEnabled);
            terminalManager.setEnabled(isEnabled);

            const message = isEnabled ? '终端日志记录已开启' : '终端日志记录已关闭';
            statusBarManager.showTemporaryMessage(message);
            vscode.window.showInformationMessage(message);
        }
    );
    context.subscriptions.push(toggleCommand);

    // 注册命令：打开日志文件夹
    const openLogFolderCommand = vscode.commands.registerCommand(
        'terminalLogger.openLogFolder',
        () => {
            const logDir = ConfigManager.getLogDirectory();

            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }

            const uri = vscode.Uri.file(logDir);
            vscode.commands.executeCommand('revealFileInOS', uri);
        }
    );
    context.subscriptions.push(openLogFolderCommand);

    // 注册命令：清空当前日志
    const clearCurrentLogCommand = vscode.commands.registerCommand(
        'terminalLogger.clearCurrentLog',
        async () => {
            const logPaths = terminalManager.getLogPaths();

            if (logPaths.length === 0) {
                vscode.window.showWarningMessage('没有活动的终端日志');
                return;
            }

            const items = logPaths.map(p => ({
                label: path.basename(p),
                description: p
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: '选择要清空的日志文件'
            });

            if (selected) {
                fs.writeFileSync(selected.description!, '');
                vscode.window.showInformationMessage(`已清空日志: ${selected.label}`);
            }
        }
    );
    context.subscriptions.push(clearCurrentLogCommand);

    // 更新初始状态
    const config = ConfigManager.getConfig();
    isEnabled = config.enabled;
    statusBarManager.setEnabled(isEnabled);
    statusBarManager.setTerminalCount(terminalManager.getActiveTerminalCount());

    vscode.window.showInformationMessage(
        'Terminal Logger 已激活，自动记录所有终端命令执行日志。'
    );
}

export function deactivate() {
    if (terminalManager) {
        terminalManager.dispose();
    }
    if (statusBarManager) {
        statusBarManager.dispose();
    }
    console.log('Terminal Logger 扩展已停用');
}
