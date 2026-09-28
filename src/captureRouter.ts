/**
 * 决定一条终端输出该由 Shell Integration read() 记录，还是由原始终端数据记录。
 *
 * 两条通道看到的是同一段输出，但谁都可能缺一块：
 * - Remote SSH 上 read() 经常是空的，或者只拿到一个换行，真正的输出在原始终端数据里，
 *   而且可能比命令开始事件更早、或比命令结束事件更晚到达。
 * - 高速大量输出时 read() 会持续有数据，但中间会丢行；这时不能因为“刚刚读到过”就把原始数据整段扔掉。
 *
 * 已经由另一条通道写过的行按顺序对上后跳过，避免同一行落两次。没对上的行补进日志。
 * 提示符和逐字输入仍然不记录。
 */
import { PtyAssembler, classifyShellLine } from './ptyAssembler';
import { LogWriter } from './logWriter';

interface ChannelLines {
    read: string[];
    pty: string[];
}

export class CaptureRouter {
    private commandActive: Map<string, boolean> = new Map();
    private graceUntil: Map<string, number> = new Map();
    private lastCommand: Map<string, string> = new Map();
    private assemblers: Map<string, PtyAssembler> = new Map();
    private unmatched: Map<string, ChannelLines> = new Map();
    private earlyOutput: Map<string, string[]> = new Map();

    constructor(private readonly fallbackGapMs: number = 500) {}

    /**
     * @returns 命令开始前缓冲里尚未换行的输入。Shell Integration 没给出命令文本时可以用它补一行。
     */
    beginCommand(terminalKey: string): string {
        const echoed = this.assemblerFor(terminalKey).takePending().trim();
        this.commandActive.set(terminalKey, true);
        this.graceUntil.delete(terminalKey);
        this.unmatched.delete(terminalKey);
        return echoed;
    }

    /**
     * 命令开始事件可能晚于输出。beginCommand 之前攒下的输出在记下命令文本后取走。
     */
    takeEarlyOutput(terminalKey: string): string[] {
        const pending = this.earlyOutput.get(terminalKey) ?? [];
        this.earlyOutput.set(terminalKey, []);
        const lines: string[] = [];
        for (const line of pending) {
            if (this.isSameCommand(terminalKey, line)) {
                continue;
            }
            if (this.consumeOther(terminalKey, line, 'pty')) {
                continue;
            }
            this.remember(terminalKey, line, 'pty');
            lines.push(line);
        }
        return lines;
    }

    /**
     * @returns 命令结束时尚未换行、但属于程序输出的那一行。没有则返回 null。
     */
    endCommand(terminalKey: string, now?: number): string | null {
        this.commandActive.set(terminalKey, false);
        const grace = Math.max(this.fallbackGapMs, 2000);
        this.graceUntil.set(terminalKey, now === undefined ? Number.POSITIVE_INFINITY : now + grace);
        const assembler = this.assemblerFor(terminalKey);
        const tail = assembler.pendingOutput();
        assembler.reset();
        if (!tail.trim()) {
            return null;
        }
        const accepted = this.acceptLine(terminalKey, tail);
        if (!accepted) {
            return null;
        }
        if (this.consumeOther(terminalKey, accepted, 'pty')) {
            return null;
        }
        this.remember(terminalKey, accepted, 'pty');
        return accepted;
    }

    noteCommand(terminalKey: string, commandLine: string): void {
        const trimmed = commandLine.trim();
        if (trimmed) {
            this.lastCommand.set(terminalKey, trimmed);
        }
    }

    readChunk(terminalKey: string, chunk: string, _now: number, sink: (data: string) => void): void {
        const logical = CaptureRouter.logicalLines(chunk);
        if (logical.length === 0) {
            return;
        }
        const fresh: string[] = [];
        for (const line of logical) {
            if (this.consumeOther(terminalKey, line, 'read')) {
                continue;
            }
            this.remember(terminalKey, line, 'read');
            fresh.push(line);
        }
        if (fresh.length === 0) {
            return;
        }
        if (fresh.length === logical.length) {
            sink(chunk);
            return;
        }
        sink(fresh.join('\n'));
    }

    /**
     * read() 结束不等于命令结束。原始终端数据里还没对上的输出仍要补记。
     */
    readFinished(_terminalKey: string, _now?: number): void {
        // 两条通道用“已经写过的行”去重，不再按时间把其中一条整段关掉。
    }

    /**
     * @returns 这段原始终端数据是否已写入日志
     */
    terminalData(terminalKey: string, data: string, now: number, sink: (data: string) => void): boolean {
        const assembled = this.assemblerFor(terminalKey).push(data, now);
        const phase = this.phase(terminalKey, now);
        let wrote = false;

        for (const raw of assembled) {
            const classified = classifyShellLine(raw);
            if (classified.fromPrompt && (phase === 'grace' || !classified.text)) {
                if (phase === 'grace') {
                    this.graceUntil.delete(terminalKey);
                }
                continue;
            }

            const accepted = this.acceptLine(terminalKey, raw);
            if (!accepted) {
                continue;
            }

            if (phase === 'idle') {
                this.stashEarly(terminalKey, accepted);
                continue;
            }

            if (this.consumeOther(terminalKey, accepted, 'pty')) {
                continue;
            }
            this.remember(terminalKey, accepted, 'pty');
            sink(accepted);
            wrote = true;
        }

        return wrote;
    }

    forget(terminalKey: string): void {
        this.commandActive.delete(terminalKey);
        this.graceUntil.delete(terminalKey);
        this.lastCommand.delete(terminalKey);
        this.assemblers.delete(terminalKey);
        this.unmatched.delete(terminalKey);
        this.earlyOutput.delete(terminalKey);
    }

    private phase(terminalKey: string, now: number): 'command' | 'grace' | 'idle' {
        if (this.commandActive.get(terminalKey)) {
            return 'command';
        }
        const until = this.graceUntil.get(terminalKey);
        if (until !== undefined && now <= until) {
            return 'grace';
        }
        return 'idle';
    }

    private assemblerFor(terminalKey: string): PtyAssembler {
        let assembler = this.assemblers.get(terminalKey);
        if (!assembler) {
            assembler = new PtyAssembler();
            this.assemblers.set(terminalKey, assembler);
        }
        return assembler;
    }

    private stashEarly(terminalKey: string, line: string): void {
        const buf = this.earlyOutput.get(terminalKey) ?? [];
        buf.push(line);
        if (buf.length > 20000) {
            buf.shift();
        }
        this.earlyOutput.set(terminalKey, buf);
    }

    private buckets(terminalKey: string): ChannelLines {
        let found = this.unmatched.get(terminalKey);
        if (!found) {
            found = { read: [], pty: [] };
            this.unmatched.set(terminalKey, found);
        }
        return found;
    }

    private remember(terminalKey: string, line: string, source: 'read' | 'pty'): void {
        const list = source === 'read' ? this.buckets(terminalKey).read : this.buckets(terminalKey).pty;
        list.push(CaptureRouter.dedupeKey(line));
        if (list.length > 20000) {
            list.splice(0, list.length - 20000);
        }
    }

    /**
     * 另一条通道已经写过这段文本时消化掉对应记录，返回 true。
     * 整行可以出现在队列中间（两条通道夹着只在一边出现的行）。
     * 长行被拆开时，队首可能只是这一行的前缀，或者这一行要一次盖住队首的好几段。
     */
    private consumeOther(terminalKey: string, line: string, source: 'read' | 'pty'): boolean {
        const other = source === 'read' ? this.buckets(terminalKey).pty : this.buckets(terminalKey).read;
        const piece = CaptureRouter.dedupeKey(line);
        if (!piece || other.length === 0) {
            return false;
        }
        const exact = other.indexOf(piece);
        if (exact >= 0) {
            other.splice(exact, 1);
            return true;
        }
        if (other[0].length > piece.length && other[0].startsWith(piece) && piece.length >= 8) {
            other[0] = other[0].slice(piece.length);
            return true;
        }
        if (other[0].length >= piece.length) {
            return false;
        }

        let combined = '';
        let count = 0;
        while (count < other.length && combined.length < piece.length) {
            combined += other[count];
            count++;
            if (combined === piece) {
                other.splice(0, count);
                return true;
            }
            if (combined.length > piece.length) {
                if (!combined.startsWith(piece)) {
                    return false;
                }
                const keep = combined.slice(piece.length);
                other.splice(0, count);
                if (keep) {
                    other.unshift(keep);
                }
                return true;
            }
        }
        return false;
    }

    private acceptLine(terminalKey: string, line: string): string | null {
        const text = classifyShellLine(line).text;
        if (!text) {
            return null;
        }
        if (this.isSameCommand(terminalKey, text)) {
            return null;
        }
        return text;
    }

    private isSameCommand(terminalKey: string, line: string): boolean {
        const command = this.lastCommand.get(terminalKey);
        if (!command) {
            return false;
        }
        return CaptureRouter.sameCommand(line, command);
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

    private static logicalLines(chunk: string): string[] {
        const lines: string[] = [];
        for (const part of chunk.split('\n')) {
            const cleaned = CaptureRouter.dedupeKey(part);
            if (cleaned.trim() === '') {
                continue;
            }
            lines.push(cleaned);
        }
        return lines;
    }

    private static dedupeKey(line: string): string {
        return LogWriter.stripAnsi(line).replace(/\r/g, '').replace(/[ \t]+$/g, '');
    }
}
