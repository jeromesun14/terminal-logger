/**
 * 决定一条终端输出该由 Shell Integration read() 记录，还是由原始终端数据记录。
 *
 * read() 返回 0 段（例如无输出命令，或 Remote SSH 暂时读不到回显）不能把这个终端永久判死。
 * read() 长时间不再推送时，改记原始终端数据，这样连续打印的日志不会一直停在缓冲区里。
 *
 * 原始终端数据只在命令执行期间使用。Remote SSH 上，bash/zsh 的逐字回显可能在命令开始之后
 * 才到达，而且一次一个字母。这些分片先拼成完整行，提示符和已经由 Shell Integration 记下的命令不再重复写入。
 */
import { PtyAssembler, normalizeShellLine } from './ptyAssembler';

export class CaptureRouter {
    private lastReadAt: Map<string, number> = new Map();
    private fallbackActive: Map<string, boolean> = new Map();
    private commandActive: Map<string, boolean> = new Map();
    private lastCommand: Map<string, string> = new Map();
    private assemblers: Map<string, PtyAssembler> = new Map();

    constructor(private readonly fallbackGapMs: number = 500) {}

    /**
     * @returns 命令开始前缓冲里尚未换行的输入。Shell Integration 没给出命令文本时可以用它补一行。
     */
    beginCommand(terminalKey: string): string {
        const echoed = this.assemblerFor(terminalKey).takePending().trim();
        this.commandActive.set(terminalKey, true);
        this.fallbackActive.set(terminalKey, false);
        this.lastReadAt.delete(terminalKey);
        return echoed;
    }

    /**
     * @returns 命令结束时尚未换行、但属于程序输出的那一行。没有则返回 null。
     */
    endCommand(terminalKey: string): string | null {
        this.commandActive.set(terminalKey, false);
        this.fallbackActive.set(terminalKey, false);
        this.lastReadAt.delete(terminalKey);
        const assembler = this.assemblerFor(terminalKey);
        const tail = assembler.pendingOutput();
        assembler.reset();
        if (!tail.trim()) {
            return null;
        }
        return this.acceptLine(terminalKey, tail);
    }

    noteCommand(terminalKey: string, commandLine: string): void {
        const trimmed = commandLine.trim();
        if (trimmed) {
            this.lastCommand.set(terminalKey, trimmed);
        }
    }

    readChunk(terminalKey: string, chunk: string, now: number, sink: (data: string) => void): void {
        this.lastReadAt.set(terminalKey, now);
        if (this.fallbackActive.get(terminalKey)) {
            return;
        }
        sink(chunk);
    }

    /**
     * read() 结束不等于命令结束。保留最近一次读到数据的时间，
     * 这样紧接着到来的 PTY 回显不会把同一段输出再写一遍。
     * 这次命令如果一个分片都没读到，则不写入时间，执行期间的原始输出可以马上补上。
     */
    readFinished(terminalKey: string, now?: number): void {
        if (!this.lastReadAt.has(terminalKey)) {
            return;
        }
        if (now !== undefined) {
            this.lastReadAt.set(terminalKey, now);
        }
    }

    /**
     * @returns 这段原始终端数据是否已写入日志
     */
    terminalData(terminalKey: string, data: string, now: number, sink: (data: string) => void): boolean {
        if (!this.commandActive.get(terminalKey)) {
            return false;
        }
        const last = this.lastReadAt.get(terminalKey) ?? 0;
        if (last > 0 && now - last < this.fallbackGapMs) {
            return false;
        }

        const lines = this.assemblerFor(terminalKey)
            .push(data, now)
            .map(line => this.acceptLine(terminalKey, line))
            .filter((line): line is string => line !== null);

        if (lines.length === 0) {
            return false;
        }

        this.fallbackActive.set(terminalKey, true);
        for (const line of lines) {
            sink(line);
        }
        return true;
    }

    forget(terminalKey: string): void {
        this.fallbackActive.delete(terminalKey);
        this.lastReadAt.delete(terminalKey);
        this.commandActive.delete(terminalKey);
        this.lastCommand.delete(terminalKey);
        this.assemblers.delete(terminalKey);
    }

    private assemblerFor(terminalKey: string): PtyAssembler {
        let assembler = this.assemblers.get(terminalKey);
        if (!assembler) {
            assembler = new PtyAssembler();
            this.assemblers.set(terminalKey, assembler);
        }
        return assembler;
    }

    private acceptLine(terminalKey: string, line: string): string | null {
        const normalized = normalizeShellLine(line);
        if (!normalized) {
            return null;
        }
        const command = this.lastCommand.get(terminalKey);
        if (command && CaptureRouter.sameCommand(normalized, command)) {
            return null;
        }
        return normalized;
    }

    /**
     * zsh 的退格重绘折叠后可能丢掉空格，和 Shell Integration 记下的命令其实是同一条。
     */
    private static sameCommand(line: string, command: string): boolean {
        if (line === command || line === `$ ${command}`) {
            return true;
        }
        const compact = (value: string) => value.replace(/\s+/g, '');
        const got = compact(line);
        const expected = compact(command);
        return got.length > 0 && (got === expected || got === `$${expected}`);
    }
}
