import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from './configManager';
import { TerminalManager } from './terminalManager';
import { StatusBarManager } from './statusBarManager';
import { CaptureRouter } from './captureRouter';
import { normalizeShellLine } from './ptyAssembler';
import { LoggingPtyTerminal } from './ptyTerminal';

let terminalManager: TerminalManager;
let statusBarManager: StatusBarManager;
let isEnabled: boolean = true;
let outputChannel: vscode.OutputChannel;
const captureRouter = new CaptureRouter();
const terminalKeys: WeakMap<vscode.Terminal, string> = new WeakMap();
let nextTerminalKey = 1;

// 两条捕获通道的健康状态。Shell Integration read() 拿不到数据、原始终端数据 API 又未授权时
// （Remote SSH 常见组合），日志会只剩头尾，此时提示用户改用插件自建 PTY 的终端。
let sawShellExecOutput = false;
let rawDataAvailable = false;
let execCount = 0;
let fallbackNotified = false;
let ptyTerminalSeq = 0;

export function activate(context: vscode.ExtensionContext) {
    console.log('Terminal Logger 扩展已激活');

    outputChannel = vscode.window.createOutputChannel('Terminal Logger');
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine('[Terminal Logger] 扩展已激活');

    statusBarManager = new StatusBarManager();
    context.subscriptions.push(statusBarManager);

    terminalManager = new TerminalManager();
    context.subscriptions.push(terminalManager);

    context.subscriptions.push(
        ConfigManager.onDidChange(() => {
            const config = ConfigManager.getConfig();
            isEnabled = config.enabled;
            statusBarManager.setEnabled(isEnabled);
            terminalManager.setEnabled(isEnabled);
            statusBarManager.setVisible(config.showStatusBar);
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeTerminalShellIntegration((event) => {
            const terminal = event.terminal;
            const si = event.shellIntegration;
            outputChannel.appendLine(`[Shell Integration Changed] terminal="${terminal.name}", cwd=${si.cwd?.toString()}`);
        })
    );

    context.subscriptions.push(
        vscode.window.onDidOpenTerminal((terminal) => {
            const si = terminal.shellIntegration;
            outputChannel.appendLine(`[Terminal Opened] name="${terminal.name}", shellIntegration=${si ? 'available' : 'not available'}`);
        })
    );

    // Shell Integration：记录命令，并在 read() 持续有数据时记录输出。
    // read() 返回空不能停掉这个终端；连续输出如果 read() 不再推送，改由原始终端数据补上。
    context.subscriptions.push(
        vscode.window.onDidStartTerminalShellExecution(async (event) => {
            const terminal = event.terminal;
            const execution = event.execution;
            const commandLine = execution.commandLine.value;
            const key = terminalKey(terminal);

            const echoed = captureRouter.beginCommand(key).trim();
            const typed = commandLine.trim() || (echoed && normalizeShellLine(echoed)) || '';
            outputChannel.appendLine(`[ShellExec Start] terminal="${terminal.name}", cmd="${commandLine}"`);

            if (isEnabled && ConfigManager.getConfig().includeInput && typed) {
                captureRouter.noteCommand(key, typed);
                writeToTerminal(terminal, `$ ${typed}`);
            }

            let chunkCount = 0;
            try {
                const stream = execution.read();
                for await (const data of stream) {
                    chunkCount++;
                    if (!isEnabled) {
                        continue;
                    }
                    captureRouter.readChunk(key, data, Date.now(), chunk => {
                        sawShellExecOutput = true;
                        outputChannel.appendLine(`[ShellExec Output] terminal="${terminal.name}", chunk#${chunkCount}, len=${chunk.length}`);
                        writeToTerminal(terminal, chunk);
                    });
                }
            } catch (err: any) {
                outputChannel.appendLine(`[ShellExec Error] terminal="${terminal.name}": ${err.message}`);
            } finally {
                captureRouter.readFinished(key, Date.now());
                outputChannel.appendLine(`[ShellExec Read Done] terminal="${terminal.name}", totalChunks=${chunkCount}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.window.onDidEndTerminalShellExecution((event) => {
            const tail = captureRouter.endCommand(terminalKey(event.terminal));
            if (!isEnabled) {
                return;
            }
            if (tail) {
                writeToTerminal(event.terminal, tail);
            }
            execCount++;
            const exitCode = event.exitCode;
            outputChannel.appendLine(`[ShellExec End] terminal="${event.terminal.name}", exitCode=${exitCode}`);

            if (exitCode !== undefined && exitCode !== 0) {
                writeToTerminal(event.terminal, `[命令退出码: ${exitCode}]`);
            }

            notifyIfCaptureUnavailable();
        })
    );

    // 原始终端数据只补命令执行期间、read() 不再推送的输出。
    // 提示符和逐字输入（命令开始前 / 结束后）不记录，避免一行一个字母。
    //
    // onDidWriteTerminalData 是 proposed API：未授权时「注册」这一步就会抛错，
    // 只做 typeof 判断会误报可用（Remote SSH 上每次激活都踩到），因此注册必须一起放进 try。
    try {
        const onDidWriteTerminalData = (vscode.window as any).onDidWriteTerminalData;
        if (typeof onDidWriteTerminalData === 'function') {
            context.subscriptions.push(
                onDidWriteTerminalData((event: { terminal: vscode.Terminal; data: string }) => {
                    if (!isEnabled) {
                        return;
                    }
                    const terminal = event.terminal;
                    const key = terminalKey(terminal);
                    captureRouter.terminalData(key, event.data, Date.now(), data => {
                        writeToTerminal(terminal, data);
                    });
                })
            );
            rawDataAvailable = true;
            outputChannel.appendLine('[Terminal Logger] onDidWriteTerminalData 已注册，启用原始终端数据捕获');
        } else {
            outputChannel.appendLine('[Terminal Logger] onDidWriteTerminalData API 不可用');
        }
    } catch (e: any) {
        rawDataAvailable = false;
        outputChannel.appendLine(`[Terminal Logger] onDidWriteTerminalData 不可用: ${e?.message ?? e}`);
    }

    context.subscriptions.push(
        vscode.window.onDidCloseTerminal((terminal) => {
            captureRouter.forget(terminalKey(terminal));
            terminalManager.unregisterTerminal(terminal);
            statusBarManager.setTerminalCount(terminalManager.getActiveTerminalCount());
        })
    );

    const toggleCommand = vscode.commands.registerCommand(
        'terminalLogger.toggle',
        async () => {
            isEnabled = !isEnabled;

            const config = vscode.workspace.getConfiguration('terminalLogger');
            await config.update('enabled', isEnabled, ConfigManager.toggleTarget());

            statusBarManager.setEnabled(isEnabled);
            terminalManager.setEnabled(isEnabled);

            const message = isEnabled ? '终端日志记录已开启' : '终端日志记录已关闭';
            statusBarManager.showTemporaryMessage(message);
            vscode.window.showInformationMessage(message);
        }
    );
    context.subscriptions.push(toggleCommand);

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

    // 自建 PTY 的日志终端：不依赖 Shell Integration，也不依赖 proposed API，
    // 用于 Remote SSH 等拿不到终端数据的环境。
    const newLoggingTerminalCommand = vscode.commands.registerCommand(
        'terminalLogger.newLoggingTerminal',
        () => {
            createLoggingTerminal();
        }
    );
    context.subscriptions.push(newLoggingTerminalCommand);

    const config = ConfigManager.getConfig();
    isEnabled = config.enabled;
    statusBarManager.setEnabled(isEnabled);
    statusBarManager.setTerminalCount(terminalManager.getActiveTerminalCount());
    statusBarManager.setVisible(config.showStatusBar);

    if (config.showActivationMessage) {
        vscode.window.showInformationMessage(
            'Terminal Logger 已激活，自动记录所有终端命令执行日志。'
        );
    }
}

function terminalKey(terminal: vscode.Terminal): string {
    let key = terminalKeys.get(terminal);
    if (!key) {
        key = `t${nextTerminalKey++}`;
        terminalKeys.set(terminal, key);
    }
    return key;
}

function writeToTerminal(terminal: vscode.Terminal, data: string, cwdPath?: string): void {
    if (!isEnabled) {
        return;
    }
    try {
        const cwdOverride = cwdPath ? vscode.Uri.file(cwdPath) : undefined;
        const isNew = terminalManager.ensureTerminalRegistered(terminal, cwdOverride);
        if (isNew) {
            statusBarManager.setTerminalCount(terminalManager.getActiveTerminalCount());
        }
        terminalManager.logToTerminal(terminal, data);
    } catch (err: any) {
        outputChannel.appendLine(`[Log Error] terminal="${terminal.name}": ${err.message}`);
    }
}

/**
 * 新建一个由插件自己提供 PTY 的终端。
 * 它的输入/输出不经过 VSCode 的捕获通道，因此在任何环境下都能完整记录。
 */
function createLoggingTerminal(): void {
    const config = ConfigManager.getConfig();

    if (!config.enabled) {
        vscode.window.showWarningMessage('终端日志记录当前是关闭状态，请先开启再新建日志终端。');
        return;
    }

    ptyTerminalSeq += 1;
    const name = `日志终端 ${ptyTerminalSeq}`;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let terminal: vscode.Terminal | undefined;

    const pty = new LoggingPtyTerminal({
        cwd,
        includeInput: config.includeInput,
        writeLog: text => {
            if (terminal) {
                writeToTerminal(terminal, text, cwd);
            }
        },
        onDebug: message => outputChannel.appendLine(message)
    });

    terminal = vscode.window.createTerminal({ name, pty });
    terminal.show();
    outputChannel.appendLine(`[PTY Terminal] 已创建 name="${name}", cwd=${cwd ?? '(未指定)'}`);
}

/**
 * 两条通道都拿不到数据时，明确告诉用户，并给出可一键执行的替代方案。
 */
function notifyIfCaptureUnavailable(): void {
    if (fallbackNotified || isEnabled === false) {
        return;
    }
    if (rawDataAvailable || sawShellExecOutput || execCount < 2) {
        return;
    }

    fallbackNotified = true;
    outputChannel.appendLine('[Terminal Logger] Shell Integration 无输出且原始终端数据 API 不可用，提示改用自建 PTY 终端');

    vscode.window
        .showWarningMessage(
            'Terminal Logger 在当前环境捕获不到终端输出（Remote SSH 常见）。可改用自建 PTY 的日志终端，记录不受环境限制。',
            '新建日志终端'
        )
        .then(choice => {
            if (choice === '新建日志终端') {
                vscode.commands.executeCommand('terminalLogger.newLoggingTerminal');
            }
        });
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
