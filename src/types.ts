import * as vscode from 'vscode';

export interface LogConfig {
    enabled: boolean;
    logPath: string;
    timestampFormat: string;
    fileNamePattern: string;
    includeInput: boolean;
    showStatusBar: boolean;
    showActivationMessage: boolean;
    maxFileSizeKB: number;
    overflowPolicy: 'discard' | 'rotate';
    maxRotatedFiles: number;
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
