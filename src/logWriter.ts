import * as fs from 'fs';
import * as path from 'path';
import { LogWriter as ILogWriter } from './types';
import { ConfigManager } from './configManager';

export class LogWriter implements ILogWriter {
    private logPath: string;
    private timestampFormat: string;
    private writeStream: fs.WriteStream | null = null;
    private isFirstLine: boolean = true;

    constructor(logPath: string, timestampFormat: string) {
        this.logPath = logPath;
        this.timestampFormat = timestampFormat;
        this.init();
    }

    private init(): void {
        // 确保目录存在
        const dir = path.dirname(this.logPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // 创建写入流
        this.writeStream = fs.createWriteStream(this.logPath, { flags: 'a' });
        
        // 写入会话开始标记
        const startTime = ConfigManager.formatTimestamp(this.timestampFormat);
        this.writeStream.write(`\n${'='.repeat(60)}\n`);
        this.writeStream.write(`${startTime} 终端日志会话开始\n`);
        this.writeStream.write(`${'='.repeat(60)}\n\n`);
    }

    write(data: string, timestamp: Date = new Date()): void {
        if (!this.writeStream) {
            return;
        }

        const cleanData = LogWriter.stripAnsi(data);
        if (!cleanData.trim()) {
            return;
        }

        const timestampStr = ConfigManager.formatTimestamp(this.timestampFormat, timestamp);
        
        const lines = cleanData.split('\n').filter(line => line.trim() !== '');
        const formattedLines = lines.map(line => `${timestampStr} ${line}`);

        const output = formattedLines.join('\n');
        
        if (this.isFirstLine) {
            this.writeStream.write(output);
            this.isFirstLine = false;
        } else {
            this.writeStream.write('\n' + output);
        }
    }

    /**
     * 剥离 ANSI 转义序列
     */
    static stripAnsi(str: string): string {
        return str
            .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')      // CSI 序列
            .replace(/\x1b\][^\x07]*\x07/g, '')           // OSC 序列 (BEL 终止)
            .replace(/\x1b\][^\x1b]*\x1b\\/g, '')         // OSC 序列 (ST 终止)
            .replace(/\x1b[()][0-9A-B]/g, '')             // 字符集选择
            .replace(/\x1b\[[\?]?[0-9;]*[hlm]/g, '')     // 模式设置
            .replace(/\x1b[=><=Nno|{}~78]/g, '')          // 单字符 ESC 序列
            .replace(/\r/g, '');
    }

    getLogPath(): string {
        return this.logPath;
    }

    dispose(): void {
        if (this.writeStream) {
            const endTime = ConfigManager.formatTimestamp(this.timestampFormat);
            this.writeStream.write(`\n\n${endTime} 终端日志会话结束\n`);
            this.writeStream.end();
            this.writeStream = null;
        }
    }
}
