/**
 * 决定一条终端输出该由 Shell Integration read() 记录，还是由原始终端数据记录。
 *
 * read() 返回 0 段（例如无输出命令，或 Remote SSH 暂时读不到回显）不能把这个终端永久判死。
 * read() 长时间不再推送时，改记原始终端数据，这样连续打印的日志不会一直停在缓冲区里。
 */
export class CaptureRouter {
    private lastReadAt: Map<string, number> = new Map();
    private fallbackActive: Map<string, boolean> = new Map();

    constructor(private readonly fallbackGapMs: number = 500) {}

    beginCommand(terminalKey: string): void {
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

    readFinished(terminalKey: string): void {
        this.lastReadAt.delete(terminalKey);
    }

    /**
     * @returns 这段原始终端数据是否已写入日志
     */
    terminalData(terminalKey: string, data: string, now: number, sink: (data: string) => void): boolean {
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
    }
}
