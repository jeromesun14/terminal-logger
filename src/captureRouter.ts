/**
 * 决定一条终端输出该由 Shell Integration read() 记录，还是由原始终端数据记录。
 *
 * read() 返回 0 段（例如无输出命令，或 Remote SSH 暂时读不到回显）不能把这个终端永久判死。
 * read() 长时间不再推送时，改记原始终端数据，这样连续打印的日志不会一直停在缓冲区里。
 *
 * 原始终端数据只在命令执行期间使用。命令还没开始、或已经结束时，PTY 上是提示符和逐字回显
 * （含退格重绘）。那些片段不能落盘，否则一条命令会被拆成一行一个字母。
 */
export class CaptureRouter {
    private lastReadAt: Map<string, number> = new Map();
    private fallbackActive: Map<string, boolean> = new Map();
    private commandActive: Map<string, boolean> = new Map();

    constructor(private readonly fallbackGapMs: number = 500) {}

    beginCommand(terminalKey: string): void {
        this.commandActive.set(terminalKey, true);
        this.fallbackActive.set(terminalKey, false);
        this.lastReadAt.delete(terminalKey);
    }

    endCommand(terminalKey: string): void {
        this.commandActive.set(terminalKey, false);
        this.fallbackActive.set(terminalKey, false);
        this.lastReadAt.delete(terminalKey);
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
        this.fallbackActive.set(terminalKey, true);
        sink(data);
        return true;
    }

    forget(terminalKey: string): void {
        this.fallbackActive.delete(terminalKey);
        this.lastReadAt.delete(terminalKey);
        this.commandActive.delete(terminalKey);
    }
}
