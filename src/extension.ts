import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from './configManager';
import { TerminalManager } from './terminalManager';
import { StatusBarManager } from './statusBarManager';

let terminalManager: TerminalManager;
let statusBarManager: StatusBarManager;
let isEnabled: boolean = true;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    console.log('Terminal Logger 扩展已激活');

    // 创建调试输出通道
    outputChannel = vscode.window.createOutputChannel('Terminal Logger');
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine('[Terminal Logger] 扩展已激活');

    // 初始化状态栏
    statusBarManager = new StatusBarManager();
    context.subscriptions.push(statusBarManager);

    // 初始化终端管理器
    terminalManager = new TerminalManager();
    terminalManager.setOutputChannel(outputChannel);
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

    // 监听 Shell Integration 变化，用于调试
    context.subscriptions.push(
        vscode.window.onDidChangeTerminalShellIntegration((event) => {
            const terminal = event.terminal;
            const si = event.shellIntegration;
            outputChannel.appendLine(`[Shell Integration Changed] terminal="${terminal.name}", cwd=${si.cwd?.toString()}`);
        })
    );

    // 监听终端打开，记录 shell integration 状态
    context.subscriptions.push(
        vscode.window.onDidOpenTerminal((terminal) => {
            const si = terminal.shellIntegration;
            outputChannel.appendLine(`[Terminal Opened] name="${terminal.name}", shellIntegration=${si ? 'available' : 'not available'}`);
        })
    );

    // ============================================================
    // 方案一：Shell Integration API — 捕获命令及其输出
    // ============================================================
    context.subscriptions.push(
        vscode.window.onDidStartTerminalShellExecution(async (event) => {
            if (!isEnabled) {
                return;
            }

            const terminal = event.terminal;
            const execution = event.execution;
            const commandLine = execution.commandLine.value;

            outputChannel.appendLine(`[ShellExec Start] terminal="${terminal.name}", cmd="${commandLine}", readBroken=${terminalManager.isReadBroken(terminal)}`);

            // 确保该终端已注册 LogWriter
            terminalManager.ensureTerminalRegistered(terminal);

            // 如果该终端已知 read() 不工作，跳过 read()，依赖 fallback
            if (terminalManager.isReadBroken(terminal)) {
                if (!terminalManager.isScriptFallbackActive(terminal)) {
                    // 仅在 onDidWriteTerminalData 不可用时启用 script fallback
                    const hasWriteDataAPI = typeof (vscode.window as any).onDidWriteTerminalData === 'function';
                    if (!hasWriteDataAPI) {
                        outputChannel.appendLine(`[ShellExec] terminal="${terminal.name}", enabling script fallback`);
                        terminalManager.enableScriptFallback(terminal);
                    }
                }
                // script fallback 模式下不再通过 LogWriter 记录（script 会记录所有内容）
                // onDidWriteTerminalData fallback 模式下也会自动记录
                outputChannel.appendLine(`[ShellExec Skip Read] terminal="${terminal.name}", read() known broken, relying on fallback`);
                return;
            }

            // 记录命令本身
            const config = ConfigManager.getConfig();
            if (config.includeInput) {
                terminalManager.logToTerminal(terminal, `$ ${commandLine}`);
            }

            // 流式读取命令输出
            let chunkCount = 0;
            try {
                const stream = execution.read();
                for await (const data of stream) {
                    chunkCount++;
                    if (chunkCount === 1) {
                        // 只有在实际收到数据后才标记 active，防止阻塞 fallback
                        terminalManager.markShellIntegrationActive(terminal);
                    }
                    if (!isEnabled) {
                        break;
                    }
                    outputChannel.appendLine(`[ShellExec Output] terminal="${terminal.name}", chunk#${chunkCount}, len=${data.length}`);
                    terminalManager.logToTerminal(terminal, data);
                }
                outputChannel.appendLine(`[ShellExec Read Done] terminal="${terminal.name}", totalChunks=${chunkCount}`);
            } catch (err: any) {
                outputChannel.appendLine(`[ShellExec Error] terminal="${terminal.name}": ${err.message}`);
            }

            // read() 结束后取消标记
            terminalManager.unmarkShellIntegrationActive(terminal);

            // 如果 read() 返回了 0 chunks，标记该终端的 read() 不工作
            if (chunkCount === 0) {
                terminalManager.markReadBroken(terminal);
                outputChannel.appendLine(`[ShellExec Read Broken] terminal="${terminal.name}", read() returned 0 chunks, marking as broken for future commands`);

                // 如果 onDidWriteTerminalData 也不可用，启用 script fallback
                const hasWriteDataAPI = typeof (vscode.window as any).onDidWriteTerminalData === 'function';
                if (!hasWriteDataAPI && !terminalManager.isScriptFallbackActive(terminal)) {
                    outputChannel.appendLine(`[ShellExec] terminal="${terminal.name}", no fallback API available, enabling script fallback`);
                    terminalManager.enableScriptFallback(terminal);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.window.onDidEndTerminalShellExecution((event) => {
            if (!isEnabled) {
                return;
            }
            const exitCode = event.exitCode;
            outputChannel.appendLine(`[ShellExec End] terminal="${event.terminal.name}", exitCode=${exitCode}`);

            // 命令结束后取消标记（双重保险）
            terminalManager.unmarkShellIntegrationActive(event.terminal);

            // script fallback 模式下不写入退出码（script 记录所有内容）
            if (terminalManager.isScriptFallbackActive(event.terminal)) {
                return;
            }

            if (exitCode !== undefined && exitCode !== 0) {
                terminalManager.logToTerminal(
                    event.terminal,
                    `[命令退出码: ${exitCode}]`
                );
            }
        })
    );

    // ============================================================
    // 方案二：Fallback — 使用 onDidWriteTerminalData (如果可用)
    // 这是一个 proposed API，在某些环境下可能不可用
    // 当 Shell Integration 的 read() 不工作时，这是唯一的输出捕获途径
    // ============================================================
    try {
        const onDidWriteTerminalData = (vscode.window as any).onDidWriteTerminalData;
        if (typeof onDidWriteTerminalData === 'function') {
            outputChannel.appendLine('[Terminal Logger] onDidWriteTerminalData API 可用，启用 fallback 数据捕获');
            context.subscriptions.push(
                onDidWriteTerminalData((event: any) => {
                    if (!isEnabled) {
                        return;
                    }
                    const terminal = event.terminal;
                    const data = event.data;

                    // 仅当 Shell Integration read() 未在活跃捕获时才记录
                    // 避免重复记录。对于 read() 已知不工作的终端，始终使用 fallback
                    if (terminalManager.isShellIntegrationActive(terminal)) {
                        return;
                    }

                    terminalManager.ensureTerminalRegistered(terminal);
                    terminalManager.logToTerminal(terminal, data);
                })
            );
        } else {
            outputChannel.appendLine('[Terminal Logger] onDidWriteTerminalData API 不可用');
        }
    } catch (e: any) {
        outputChannel.appendLine(`[Terminal Logger] 检测 onDidWriteTerminalData 失败: ${e.message}`);
    }

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
