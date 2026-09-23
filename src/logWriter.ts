import * as fs from 'fs';
import * as path from 'path';
import { formatTimestamp } from './format';

export type OverflowPolicy = 'discard' | 'rotate';

export interface LogWriterOptions {
    logPath: string;
    timestampFormat: string;
    maxFileSizeBytes?: number;
    overflowPolicy?: OverflowPolicy;
    maxRotatedFiles?: number;
}

/**
 * 把终端输出同步追加到日志文件。
 * 使用 writeSync，连续输出到达后立刻能在磁盘上看到，而不是停在写入流缓冲区里。
 */
export class LogWriter {
    private logPath: string;
    private readonly timestampFormat: string;
    private readonly maxFileSizeBytes: number;
    private readonly overflowPolicy: OverflowPolicy;
    private readonly maxRotatedFiles: number;
    private fd: number | null = null;
    private size: number = 0;
    private isFirstLine: boolean = true;

    constructor(options: LogWriterOptions) {
        this.logPath = options.logPath;
        this.timestampFormat = options.timestampFormat;
        this.maxFileSizeBytes = Math.max(0, options.maxFileSizeBytes ?? 0);
        this.overflowPolicy = options.overflowPolicy === 'rotate' ? 'rotate' : 'discard';
        this.maxRotatedFiles = Math.max(0, options.maxRotatedFiles ?? 3);
        this.openFresh();
    }

    write(data: string, timestamp: Date = new Date()): void {
        if (this.fd === null) {
            return;
        }

        const body = this.formatBody(data, timestamp);
        if (!body) {
            return;
        }

        const preview = this.isFirstLine ? body : '\n' + body;
        this.makeRoom(Buffer.byteLength(preview));

        if (this.fd === null) {
            return;
        }

        const payload = this.isFirstLine ? body : '\n' + body;
        fs.writeSync(this.fd, payload);
        this.size += Buffer.byteLength(payload);
        this.isFirstLine = false;

        if (this.maxFileSizeBytes > 0 && this.overflowPolicy === 'discard' && this.size > this.maxFileSizeBytes) {
            this.discardOld(0);
        }
    }

    getLogPath(): string {
        return this.logPath;
    }

    getSize(): number {
        if (this.fd === null) {
            return fs.existsSync(this.logPath) ? fs.statSync(this.logPath).size : 0;
        }
        return fs.fstatSync(this.fd).size;
    }

    dispose(): void {
        if (this.fd === null) {
            return;
        }
        const endTime = formatTimestamp(this.timestampFormat);
        try {
            fs.writeSync(this.fd, `\n\n${endTime} 终端日志会话结束\n`);
            fs.closeSync(this.fd);
        } catch {
            try {
                fs.closeSync(this.fd);
            } catch {
                // 关闭失败时忽略，避免影响终端关闭流程
            }
        }
        this.fd = null;
    }

    /**
     * 剥离 ANSI 转义序列，并把退格、回车造成的光标重绘折叠成最终可见文本。
     */
    static stripAnsi(str: string): string {
        const stripped = str
            .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '')
            .replace(/\x1b\][^\x1b]*\x1b\\/g, '')
            .replace(/\x1b[()][0-9A-B]/g, '')
            .replace(/\x1b[=><=Nno|{}~78DMHEc]/g, '')
            .replace(/\x1b./g, '');
        return LogWriter.collapseCursor(stripped);
    }

    /**
     * 按终端光标语义折叠一段文本：`\r` 回到行首，`\b` 左移一格，后续字符覆盖旧内容。
     */
    static collapseCursor(str: string): string {
        const lines: string[] = [];
        let current = '';
        let col = 0;

        for (const ch of str) {
            if (ch === '\n') {
                lines.push(current);
                current = '';
                col = 0;
                continue;
            }
            if (ch === '\r') {
                col = 0;
                continue;
            }
            if (ch === '\b' || ch === '\x7f') {
                if (col > 0) {
                    col -= 1;
                }
                continue;
            }
            if (col < current.length) {
                current = current.slice(0, col) + ch + current.slice(col + 1);
            } else {
                current += ch;
            }
            col += 1;
        }

        lines.push(current);
        return lines.join('\n');
    }

    private formatBody(data: string, timestamp: Date): string | null {
        const cleanData = LogWriter.stripAnsi(data);
        if (!cleanData.trim()) {
            return null;
        }

        const lines = cleanData.split('\n').filter(line => line.trim() !== '');
        if (lines.length === 0) {
            return null;
        }

        const timestampStr = formatTimestamp(this.timestampFormat, timestamp);
        return lines.map(line => `${timestampStr} ${line}`).join('\n');
    }

    private makeRoom(incomingBytes: number): void {
        if (this.maxFileSizeBytes <= 0) {
            return;
        }
        if (this.size + incomingBytes <= this.maxFileSizeBytes) {
            return;
        }
        if (this.overflowPolicy === 'rotate') {
            if (!this.isFirstLine) {
                this.rotate();
            }
            return;
        }
        this.discardOld(incomingBytes);
    }

    private discardOld(incomingBytes: number): void {
        if (this.fd === null) {
            return;
        }

        const keepBudget = Math.max(0, this.maxFileSizeBytes - incomingBytes);
        const target = Math.min(keepBudget, Math.floor(this.maxFileSizeBytes * 0.7));
        const existing = fs.readFileSync(this.logPath);
        let text = '';
        if (target > 0 && existing.length > 0) {
            const start = Math.max(0, existing.length - target);
            text = existing.subarray(start).toString('utf8');
            const newlineAt = text.indexOf('\n');
            if (newlineAt >= 0) {
                text = text.slice(newlineAt + 1);
            }
        }

        const notice = `${formatTimestamp(this.timestampFormat)} [已丢弃更早的日志以控制文件大小]\n`;
        const next = notice + text;
        this.replaceContents(next);
    }

    private rotate(): void {
        if (this.fd === null) {
            return;
        }

        const note = `\n${formatTimestamp(this.timestampFormat)} [日志已轮转]\n`;
        try {
            fs.writeSync(this.fd, note);
        } catch {
            // 轮转标记写失败时仍继续切换文件
        }
        fs.closeSync(this.fd);
        this.fd = null;

        if (this.maxRotatedFiles <= 0) {
            fs.unlinkSync(this.logPath);
        } else {
            const oldest = this.archivePath(this.maxRotatedFiles);
            if (fs.existsSync(oldest)) {
                fs.unlinkSync(oldest);
            }
            for (let i = this.maxRotatedFiles - 1; i >= 1; i--) {
                const src = this.archivePath(i);
                if (fs.existsSync(src)) {
                    fs.renameSync(src, this.archivePath(i + 1));
                }
            }
            fs.renameSync(this.logPath, this.archivePath(1));
        }

        this.openFresh();
    }

    private archivePath(index: number): string {
        const ext = path.extname(this.logPath);
        const base = ext ? this.logPath.slice(0, -ext.length) : this.logPath;
        return ext ? `${base}.${index}${ext}` : `${this.logPath}.${index}`;
    }

    private replaceContents(contents: string): void {
        if (this.fd !== null) {
            fs.closeSync(this.fd);
            this.fd = null;
        }
        fs.writeFileSync(this.logPath, contents);
        this.fd = fs.openSync(this.logPath, 'a');
        this.size = Buffer.byteLength(contents);
        this.isFirstLine = contents.trim().length === 0;
    }

    private openFresh(): void {
        const dir = path.dirname(this.logPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.fd = fs.openSync(this.logPath, 'a');
        const startTime = formatTimestamp(this.timestampFormat);
        const header = `\n${'='.repeat(60)}\n${startTime} 终端日志会话开始\n${'='.repeat(60)}\n\n`;
        fs.writeSync(this.fd, header);
        this.size = Buffer.byteLength(header);
        this.isFirstLine = true;
    }
}
