import * as path from 'path';

export function formatTimestamp(format: string, date: Date = new Date()): string {
    const pad = (n: number) => n.toString().padStart(2, '0');

    return format
        .replace('YYYY', date.getFullYear().toString())
        .replace('MM', pad(date.getMonth() + 1))
        .replace('DD', pad(date.getDate()))
        .replace('HH', pad(date.getHours()))
        .replace('mm', pad(date.getMinutes()))
        .replace('ss', pad(date.getSeconds()));
}

export function createSessionId(): string {
    return Math.random().toString(36).slice(2, 8);
}

/**
 * 生成日志文件名。
 * 模式里如果没有 {session}，会自动追加会话后缀，避免多个终端或窗口写进同一个文件。
 */
export function formatFileName(
    pattern: string,
    terminalName: string,
    date: Date = new Date(),
    sessionId?: string
): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const session = sessionId && sessionId.length > 0 ? sanitizeFilePart(sessionId) : createSessionId();
    const sanitizedTerminalName = sanitizeFilePart(terminalName);
    const dateStr = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    const timeStr = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

    let fileName = pattern
        .replace(/\{terminalName\}/g, sanitizedTerminalName)
        .replace(/\{date\}/g, dateStr)
        .replace(/\{time\}/g, timeStr)
        .replace(/\{session\}/g, session);

    if (!pattern.includes('{session}')) {
        const ext = path.extname(fileName);
        const base = ext ? fileName.slice(0, -ext.length) : fileName;
        fileName = `${base}_${session}${ext}`;
    }

    return fileName;
}

export function sanitizeFilePart(value: string): string {
    const cleaned = value.replace(/[<>:"/\\|?*\s]/g, '_').replace(/_+/g, '_');
    return cleaned.length > 0 ? cleaned : 'terminal';
}

/**
 * 同一进程内如果目标路径已被占用，再追加会话后缀。
 */
export function allocateLogPath(
    dir: string,
    fileName: string,
    reserved: ReadonlySet<string>,
    sessionId: string
): string {
    const desired = path.join(dir, fileName);
    if (!reserved.has(desired)) {
        return desired;
    }

    const ext = path.extname(fileName);
    const base = ext ? fileName.slice(0, -ext.length) : fileName;
    const suffix = sanitizeFilePart(sessionId);
    let n = 2;
    let candidate = path.join(dir, `${base}_${suffix}${ext}`);
    while (reserved.has(candidate)) {
        candidate = path.join(dir, `${base}_${suffix}_${n}${ext}`);
        n++;
    }
    return candidate;
}

/**
 * 按终端 cwd 选择工作区根目录。多根工作区不能总是落到第一个文件夹。
 */
export function pickWorkspaceRoot(cwd: string | undefined, folders: readonly string[]): string | undefined {
    if (folders.length === 0) {
        return undefined;
    }
    if (!cwd) {
        return folders[0];
    }

    const matches = folders.filter(folder => cwd === folder || cwd.startsWith(folder + path.sep));
    if (matches.length === 0) {
        return folders[0];
    }

    return matches.slice().sort((a, b) => b.length - a.length)[0];
}

/**
 * 有工作区时，日志开关只写当前工作区，避免一个窗口把其他窗口一起关掉。
 */
export function loggingToggleTarget(hasWorkspace: boolean): 'workspace' | 'global' {
    return hasWorkspace ? 'workspace' : 'global';
}
