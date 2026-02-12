import * as vscode from 'vscode';

export interface LogConfig {
    enabled: boolean;
    logPath: string;
    timestampFormat: string;
    fileNamePattern: string;
    includeInput: boolean;
}

export interface TerminalInfo {
    terminal: vscode.Terminal;
    logPath: string;
    logWriter: LogWriter;
}

export interface LogWriter {
    write(data: string, timestamp?: Date): void;
    getLogPath(): string;
    dispose(): void;
}
