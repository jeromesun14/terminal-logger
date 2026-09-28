import * as vscode from 'vscode';
import { PtySession, resolveShell, ShellProfileEntry } from './ptySession';

export interface LoggingPtyTerminalOptions {
    cwd?: string;
    includeInput: boolean;
    /** 一行已经清理好的文本，交给调用方落盘 */
    writeLog: (text: string) => void;
    onDebug?: (message: string) => void;
}

function readTerminalProfile(): {
    defaultProfile?: string;
    profiles?: Record<string, ShellProfileEntry | null | undefined>;
} {
    try {
        const config = vscode.workspace.getConfiguration('terminal.integrated');
        const key = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
        return {
            defaultProfile: config.get<string>(`defaultProfile.${key}`),
            profiles: config.get<Record<string, ShellProfileEntry | null | undefined>>(`profiles.${key}`) ?? undefined
        };
    } catch {
        return {};
    }
}

/**
 * 由插件自己提供 PTY 的终端。
 * Shell Integration 与 proposed API 都不可用时（典型场景：Remote SSH），
 * 用这种终端仍能 100% 捕获输入与输出。
 */
export class LoggingPtyTerminal implements vscode.Pseudoterminal {
    private readonly writeEmitter = new vscode.EventEmitter<string>();
    private readonly closeEmitter = new vscode.EventEmitter<number>();

    readonly onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    readonly onDidClose: vscode.Event<number> = this.closeEmitter.event;

    private session?: PtySession;
    private rows = 24;
    private columns = 80;

    constructor(private readonly options: LoggingPtyTerminalOptions) { }

    open(initialDimensions?: vscode.TerminalDimensions): void {
        if (initialDimensions) {
            this.rows = initialDimensions.rows;
            this.columns = initialDimensions.columns;
        }

        const profile = readTerminalProfile();
        const shell = resolveShell({
            platform: process.platform,
            env: process.env,
            defaultProfile: profile.defaultProfile,
            profiles: profile.profiles
        });

        this.session = new PtySession({
            shell,
            cwd: this.options.cwd,
            rows: this.rows,
            columns: this.columns,
            onData: data => this.writeEmitter.fire(data),
            onLine: line => this.options.writeLog(line),
            onCommand: commandLine => {
                if (this.options.includeInput) {
                    this.options.writeLog(`$ ${commandLine}`);
                }
            },
            onDebug: this.options.onDebug,
            onExit: code => this.closeEmitter.fire(code ?? 0)
        });

        this.session.start();
    }

    close(): void {
        this.session?.dispose();
        this.session = undefined;
    }

    handleInput(data: string): void {
        this.session?.write(data);
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        this.rows = dimensions.rows;
        this.columns = dimensions.columns;
        this.session?.resize(dimensions.rows, dimensions.columns);
    }
}
