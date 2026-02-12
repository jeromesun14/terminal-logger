import * as vscode from 'vscode';

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private isEnabled: boolean = true;
    private terminalCount: number = 0;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.updateDisplay();
        this.statusBarItem.show();
    }

    private updateDisplay(): void {
        if (this.isEnabled) {
            this.statusBarItem.text = `$(record) 终端日志: ${this.terminalCount} 个终端`;
            this.statusBarItem.tooltip = '终端日志记录已开启\n点击切换开关';
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.command = 'terminalLogger.toggle';
        } else {
            this.statusBarItem.text = '$(circle-slash) 终端日志: 已关闭';
            this.statusBarItem.tooltip = '终端日志记录已关闭\n点击开启';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground'
            );
            this.statusBarItem.command = 'terminalLogger.toggle';
        }
    }

    setEnabled(enabled: boolean): void {
        this.isEnabled = enabled;
        this.updateDisplay();
    }

    setTerminalCount(count: number): void {
        this.terminalCount = count;
        this.updateDisplay();
    }

    showTemporaryMessage(message: string, duration: number = 3000): void {
        const originalText = this.statusBarItem.text;
        this.statusBarItem.text = `$(check) ${message}`;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
            'statusBarItem.prominentBackground'
        );

        setTimeout(() => {
            this.statusBarItem.text = originalText;
            this.updateDisplay();
        }, duration);
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}
