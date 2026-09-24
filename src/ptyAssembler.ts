/**
 * 把 PTY 原始字节折叠成最终可见行。
 *
 * Remote SSH 上，bash/zsh 的逐字回显经常在命令已经开始之后才送到扩展，
 * 而且一次只有一个字母或一小段退格重绘。这里跨分片保持光标状态，
 * 直到换行或一整段输出到来，才交出完整行。
 */
export class TerminalScreen {
    private line = '';
    private col = 0;

    push(input: string): string[] {
        const completed: string[] = [];
        for (let i = 0; i < input.length; i++) {
            const ch = input[i];
            if (ch === '\x1b') {
                i = this.consumeEscape(input, i) - 1;
                continue;
            }
            if (ch === '\r') {
                if (input[i + 1] === '\n') {
                    completed.push(this.line);
                    this.line = '';
                    this.col = 0;
                    i++;
                } else {
                    this.col = 0;
                }
                continue;
            }
            if (ch === '\n') {
                completed.push(this.line);
                this.line = '';
                this.col = 0;
                continue;
            }
            if (ch === '\b' || ch === '\x7f') {
                if (this.col > 0) {
                    this.col -= 1;
                }
                continue;
            }
            if (ch < ' ' && ch !== '\t') {
                continue;
            }
            if (this.col < this.line.length) {
                this.line = this.line.slice(0, this.col) + ch + this.line.slice(this.col + 1);
            } else {
                if (this.col > this.line.length) {
                    this.line += ' '.repeat(this.col - this.line.length);
                }
                this.line += ch;
            }
            this.col += 1;
        }
        return completed;
    }

    pending(): string {
        return this.line;
    }

    takePending(): string {
        const pending = this.line;
        this.line = '';
        this.col = 0;
        return pending;
    }

    reset(): void {
        this.line = '';
        this.col = 0;
    }

    private consumeEscape(input: string, start: number): number {
        const next = input[start + 1];
        if (next === '[') {
            let i = start + 2;
            let params = '';
            while (i < input.length) {
                const c = input[i];
                if ((c >= '0' && c <= '9') || c === ';' || c === '?') {
                    params += c;
                    i++;
                    continue;
                }
                i++;
                this.applyCsi(params, c);
                return i;
            }
            return input.length;
        }
        if (next === ']') {
            let i = start + 2;
            while (i < input.length) {
                if (input[i] === '\x07') {
                    return i + 1;
                }
                if (input[i] === '\x1b' && input[i + 1] === '\\') {
                    return i + 2;
                }
                i++;
            }
            return input.length;
        }
        return Math.min(input.length, start + 2);
    }

    private applyCsi(params: string, final: string): void {
        const first = params.split(';').find(part => part !== '' && part !== '?') ?? '';
        const value = first === '' ? NaN : parseInt(first, 10);
        const n = (fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;

        if (final === 'K') {
            const mode = first === '' ? 0 : (Number.isFinite(value) ? value : 0);
            if (mode === 2) {
                this.line = '';
                this.col = 0;
            } else if (mode === 1) {
                const keep = this.line.slice(this.col);
                this.line = ' '.repeat(Math.max(0, this.col)) + keep;
            } else {
                this.line = this.line.slice(0, this.col);
            }
            return;
        }
        if (final === 'P') {
            const count = n(1);
            this.line = this.line.slice(0, this.col) + this.line.slice(this.col + count);
            return;
        }
        if (final === 'G') {
            this.col = Math.max(0, n(1) - 1);
            return;
        }
        if (final === 'C') {
            this.col += n(1);
            return;
        }
        if (final === 'D') {
            this.col = Math.max(0, this.col - n(1));
            return;
        }
    }
}

/**
 * 跨多次 onDidWriteTerminalData 组装行。
 * 慢速单字符视为正在输入，先留在缓冲里；一次写来的长输出、或很快连在一起的输出立刻落盘。
 */
export class PtyAssembler {
    private readonly screen = new TerminalScreen();
    private lastAt = 0;
    private pendingIsOutput = false;

    push(data: string, now: number): string[] {
        const editing = PtyAssembler.chunkHasLineEdit(data);
        const dt = this.lastAt === 0 ? Number.POSITIVE_INFINITY : now - this.lastAt;
        this.lastAt = now;
        const visible = PtyAssembler.visibleLength(data);

        const lines = this.screen.push(data);
        this.pendingIsOutput = this.markPendingOutput(editing, visible, dt);

        if (editing) {
            return lines;
        }

        if (visible >= 16 && this.screen.pending().length > 0 && lines.length === 0) {
            lines.push(this.screen.takePending());
            this.pendingIsOutput = false;
            return lines;
        }

        if (visible > 0 && visible < 16 && dt <= 40 && this.screen.pending().length >= 16) {
            lines.push(this.screen.takePending());
            this.pendingIsOutput = false;
        }
        return lines;
    }

    /**
     * 命令结束时还没换行的程序输出。逐字输入留在缓冲里，不在这里交出去。
     */
    pendingOutput(): string {
        if (!this.pendingIsOutput) {
            return '';
        }
        return this.screen.pending();
    }

    takePending(): string {
        this.lastAt = 0;
        this.pendingIsOutput = false;
        return this.screen.takePending();
    }

    reset(): void {
        this.lastAt = 0;
        this.pendingIsOutput = false;
        this.screen.reset();
    }

    private markPendingOutput(editing: boolean, visible: number, dt: number): boolean {
        if (this.screen.pending().length === 0) {
            return false;
        }
        if (editing || (visible <= 1 && dt > 40)) {
            return false;
        }
        if (visible >= 2 || (visible === 1 && dt <= 40)) {
            return true;
        }
        return this.pendingIsOutput;
    }

    static chunkHasLineEdit(data: string): boolean {
        if (/[\b\x7f]/.test(data)) {
            return true;
        }
        if (/\r(?!\n)/.test(data)) {
            return true;
        }
        return /\x1b\[[0-9;?]*[ABCDEFGHJKPSTX]/.test(data);
    }

    static visibleLength(data: string): number {
        return data
            .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
            .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
            .replace(/[\x00-\x1f\x7f]/g, '')
            .length;
    }
}

/**
 * 整行都是 shell 提示符时返回 null。
 * 提示符后面还跟着命令时，去掉提示符，留下命令文本。
 */
export function normalizeShellLine(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed) {
        return null;
    }

    const prefixed: RegExp[] = [
        /^[^@\s]+@[^:\s]+:\S*[#$]\s*(.*)$/,
        /^[^@\s]+@\S+\s+\S+\s+[%#$]\s*(.*)$/,
        /^PS\s+[A-Za-z]:\\[^>]*>\s*(.*)$/,
        /^[A-Za-z]:\\[^>]*>\s*(.*)$/,
        /^➜\s+\S+\s*(.*)$/,
        /^[❯]\s+\S+\s*(.*)$/,
        /^[A-Za-z0-9][A-Za-z0-9._-]*:\S+\s+[A-Za-z0-9._-]+[$#]\s*(.*)$/
    ];
    for (const pattern of prefixed) {
        const match = trimmed.match(pattern);
        if (!match) {
            continue;
        }
        const rest = (match[1] ?? '').trim();
        return rest || null;
    }

    if (/^[%$#>❯➜]$/.test(trimmed)) {
        return null;
    }
    return line.replace(/[ \t]+$/g, '');
}
