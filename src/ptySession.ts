/**
 * 自建 PTY 会话（不依赖任何 VSCode 实验性 API）
 *
 * 背景：Shell Integration 的 execution.read() 在部分 Remote SSH 环境下恒返回空，
 * onDidWriteTerminalData 又属于 proposed API（未授权时直接抛错），两条通道同时失效时
 * 日志只剩「会话开始 / 结束」。这里自己起一个 PTY，把终端字节流完整拿回来，
 * 是唯一在任何环境都成立的记录方式。
 *
 * 平台策略：
 * - Linux / macOS：python3 + pty.openpty() 做 PTY 桥接（bash / zsh / fish / pwsh 均可）
 * - Windows：无 POSIX PTY，退化为 pipe 直连 cmd / PowerShell / Git Bash
 */
import * as cp from 'child_process';
import { LogWriter } from './logWriter';
import { normalizeShellLine } from './ptyAssembler';

/**
 * Python PTY 桥接脚本。
 * Node 侧用 pipe 与它通信，shell 侧拿到的是真正的 TTY 设备，交互行为与真实终端一致。
 *
 * 环境变量（由 Node 侧注入）：
 *   TL_SHELL      要启动的 shell
 *   TL_SHELL_ARGS 完整 argv（JSON 数组），缺省 [shell, "-i"]
 *   TL_CWD        启动目录
 *   TL_ROWS/TL_COLS 初始窗口大小
 * 控制序列：stdin 中出现 `\x1b]TLRESIZE;<rows>;<cols>\x07` 时调整 PTY 窗口大小。
 */
const PY_BRIDGE = [
    'import os, sys, json, select, signal',
    '',
    'def env_num(name, default):',
    '    try:',
    '        return int(os.environ.get(name) or default)',
    '    except ValueError:',
    '        return default',
    '',
    'shell = os.environ.get("TL_SHELL") or "/bin/bash"',
    'cwd = os.environ.get("TL_CWD") or None',
    'rows = env_num("TL_ROWS", 24)',
    'cols = env_num("TL_COLS", 80)',
    '',
    'try:',
    '    import pty, fcntl, termios, struct',
    'except Exception:',
    '    sys.stderr.write("TL_BRIDGE: pty module unavailable\\n")',
    '    sys.exit(97)',
    '',
    'argv = None',
    'try:',
    '    argv = json.loads(os.environ.get("TL_SHELL_ARGS") or "")',
    'except Exception:',
    '    argv = None',
    'if not argv:',
    '    argv = [shell, "-i"]',
    '',
    'master, slave = pty.openpty()',
    'try:',
    '    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))',
    'except Exception:',
    '    pass',
    '',
    'pid = os.fork()',
    'if pid == 0:',
    '    try:',
    '        os.close(master)',
    '        os.setsid()',
    '        try:',
    '            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)',
    '        except Exception:',
    '            pass',
    '        os.dup2(slave, 0)',
    '        os.dup2(slave, 1)',
    '        os.dup2(slave, 2)',
    '        if slave > 2:',
    '            os.close(slave)',
    '        if cwd:',
    '            try:',
    '                os.chdir(cwd)',
    '            except Exception:',
    '                pass',
    '        env = dict(os.environ)',
    '        for key in ("TL_SHELL", "TL_SHELL_ARGS", "TL_CWD", "TL_ROWS", "TL_COLS"):',
    '            env.pop(key, None)',
    '        env.setdefault("TERM", "xterm-256color")',
    '        os.execvpe(argv[0], argv, env)',
    '    except Exception as exc:',
    '        try:',
    '            os.write(2, ("TL_BRIDGE: exec failed: %s\\n" % exc).encode())',
    '        except Exception:',
    '            pass',
    '    os._exit(127)',
    '',
    'os.close(slave)',
    'out = sys.stdout.buffer',
    'PREFIX = b"\\x1b]TLRESIZE;"',
    'pending = b""',
    'stop = False',
    '',
    'def resize(body):',
    '    try:',
    '        parts = body.split(b";")',
    '        if len(parts) != 2:',
    '            return',
    '        fcntl.ioctl(master, termios.TIOCSWINSZ,',
    '                   struct.pack("HHHH", int(parts[0]), int(parts[1]), 0, 0))',
    '        try:',
    '            os.kill(pid, signal.SIGWINCH)',
    '        except Exception:',
    '            pass',
    '    except Exception:',
    '        pass',
    '',
    'while not stop:',
    '    try:',
    '        readable, _, _ = select.select([0, master], [], [], 0.5)',
    '    except (OSError, ValueError):',
    '        break',
    '    for fd in readable:',
    '        if fd == 0:',
    '            try:',
    '                chunk = os.read(0, 4096)',
    '            except OSError:',
    '                chunk = b""',
    '            if not chunk:',
    '                stop = True',
    '                break',
    '            pending += chunk',
    '            while True:',
    '                start = pending.find(PREFIX)',
    '                if start < 0:',
    '                    break',
    '                end = pending.find(b"\\x07", start)',
    '                if end < 0:',
    '                    break',
    '                resize(pending[start + len(PREFIX):end])',
    '                pending = pending[:start] + pending[end + 1:]',
    '            if pending:',
    '                try:',
    '                    os.write(master, pending)',
    '                except OSError:',
    '                    stop = True',
    '                pending = b""',
    '        else:',
    '            try:',
    '                data = os.read(master, 8192)',
    '            except OSError:',
    '                data = b""',
    '            if not data:',
    '                stop = True',
    '                break',
    '            try:',
    '                out.write(data)',
    '                out.flush()',
    '            except Exception:',
    '                stop = True',
    '                break',
    '',
    'try:',
    '    os.close(master)',
    'except Exception:',
    '    pass',
    'try:',
    '    os.kill(pid, signal.SIGHUP)',
    'except Exception:',
    '    pass',
    'try:',
    '    os.waitpid(pid, os.WNOHANG)',
    'except Exception:',
    '    pass'
].join('\n');

export type LaunchMode = 'pty-bridge' | 'pipe';

export interface ShellProfileEntry {
    path?: string | string[];
    args?: string[] | string;
}

export interface ResolveShellInput {
    platform: NodeJS.Platform;
    env: NodeJS.ProcessEnv;
    defaultProfile?: string;
    profiles?: Record<string, ShellProfileEntry | null | undefined>;
}

export interface ShellLaunch {
    /** 真正 spawn 的进程（pty-bridge 模式下是 python） */
    command: string;
    args: string[];
    mode: LaunchMode;
    /** pty-bridge 模式下的 python 可执行文件 */
    bridge?: string;
}

let cachedPython: string | null | undefined;

/** 检测可用的 python（带 pty 模块）。Windows 直接返回 undefined。 */
export function detectPythonBridge(platform: NodeJS.Platform = process.platform): string | undefined {
    if (platform === 'win32') {
        return undefined;
    }
    if (cachedPython !== undefined) {
        return cachedPython ?? undefined;
    }
    for (const candidate of ['python3', 'python']) {
        try {
            const result = cp.spawnSync(candidate, ['-c', 'import pty, fcntl, termios, struct'], {
                stdio: 'ignore',
                timeout: 5000
            });
            if (result.status === 0) {
                cachedPython = candidate;
                return candidate;
            }
        } catch {
            // 该候选不可用，继续下一个
        }
    }
    cachedPython = null;
    return undefined;
}

function firstString(value?: string | string[]): string | undefined {
    if (!value) {
        return undefined;
    }
    if (Array.isArray(value)) {
        return value.find(item => typeof item === 'string' && item.trim().length > 0)?.trim();
    }
    return value.trim() || undefined;
}

function normalizeArgs(value?: string[] | string): string[] {
    if (!value) {
        return [];
    }
    const list = Array.isArray(value) ? value : String(value).split(' ');
    return list.filter(item => typeof item === 'string' && item.trim().length > 0);
}

function looksLike(command: string, ...keys: string[]): boolean {
    const lower = command.toLowerCase();
    return keys.some(key => lower.includes(key));
}

function defaultWindowsArgs(command: string): string[] {
    if (looksLike(command, 'pwsh', 'powershell')) {
        return ['-NoProfile', '-Command', '-'];
    }
    if (looksLike(command, 'cmd')) {
        return ['/Q', '/K'];
    }
    if (looksLike(command, 'bash', 'zsh', 'sh')) {
        return ['-i'];
    }
    return [];
}

/**
 * 解析要启动的 shell：优先 VSCode 的 defaultProfile，其次 SHELL / COMSPEC，最后按平台兜底。
 */
export function resolveShell(input: ResolveShellInput): ShellLaunch {
    const { platform, env, defaultProfile, profiles } = input;
    const profile = defaultProfile ? profiles?.[defaultProfile] : undefined;
    const profilePath = firstString(profile?.path);
    const profileArgs = normalizeArgs(profile?.args);

    if (platform === 'win32') {
        const command = profilePath || env.COMSPEC || 'cmd.exe';
        const args = profileArgs.length > 0 ? profileArgs : defaultWindowsArgs(command);
        return { command, args, mode: 'pipe' };
    }

    const fallback = env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
    const command = profilePath || fallback;
    const args = profileArgs.length > 0 ? profileArgs : ['-i'];
    const bridge = detectPythonBridge(platform);

    if (bridge) {
        return { command, args, mode: 'pty-bridge', bridge };
    }
    return { command, args, mode: 'pipe' };
}

/**
 * 把 PTY 字节流切成「行」再交给日志。
 * 终端回显是逐字符到达的，直接按 chunk 落盘会一行一个字母；
 * 这里按 \r / \n 聚合，空闲一段时间（提示符等无换行内容）也强制收尾。
 */
class LineBuffer {
    private buffer = '';
    private timer?: NodeJS.Timeout;

    constructor(
        /** idle=true 表示这段是靠空闲超时收尾的（通常是提示符），不是真正的换行 */
        private readonly emit: (line: string, idle: boolean) => void,
        private readonly idleMs: number = 250
    ) { }

    push(data: string): void {
        this.buffer += data;
        let index = this.buffer.search(/[\r\n]/);
        while (index >= 0) {
            this.flush(this.buffer.slice(0, index), false);
            this.buffer = this.buffer.slice(index + 1);
            index = this.buffer.search(/[\r\n]/);
        }
        this.arm();
    }

    flushRest(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.flush(this.buffer, true);
        this.buffer = '';
    }

    private arm(): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.flush(this.buffer, true);
            this.buffer = '';
        }, this.idleMs);
    }

    private flush(line: string, idle: boolean): void {
        if (line.trim().length === 0) {
            return;
        }
        this.emit(line, idle);
    }
}

export interface PtySessionOptions {
    shell: ShellLaunch;
    cwd?: string;
    rows?: number;
    columns?: number;
    /** 原始终端数据，用于回显到终端界面 */
    onData: (data: string) => void;
    /** 已按行聚合、可直接落盘的文本 */
    onLine: (line: string) => void;
    /** 用户输入的一整行命令（回车时触发） */
    onCommand?: (commandLine: string) => void;
    onExit?: (exitCode?: number) => void;
    onDebug?: (message: string) => void;
}

export class PtySession {
    private child?: cp.ChildProcess;
    private readonly lineBuffer: LineBuffer;
    private input = '';
    private pendingEcho?: { text: string; at: number };
    private disposed = false;
    private lastPromptLine?: string;
    private rows: number;
    private columns: number;

    constructor(private readonly options: PtySessionOptions) {
        this.rows = options.rows ?? 24;
        this.columns = options.columns ?? 80;
        this.lineBuffer = new LineBuffer((line, idle) => this.handleLine(line, idle));
    }

    start(): void {
        const { shell, cwd } = this.options;
        const env: NodeJS.ProcessEnv = { ...process.env };
        let command = shell.command;
        let args = shell.args;

        if (shell.mode === 'pty-bridge' && shell.bridge) {
            env.TL_SHELL = shell.command;
            env.TL_SHELL_ARGS = JSON.stringify([shell.command, ...shell.args]);
            env.TL_ROWS = String(this.rows);
            env.TL_COLS = String(this.columns);
            if (cwd) {
                env.TL_CWD = cwd;
            }
            command = shell.bridge;
            args = ['-c', PY_BRIDGE];
        }

        this.options.onDebug?.(`[PTY] spawn mode=${shell.mode} command="${command}" args=${JSON.stringify(args)} shell="${shell.command}"`);

        let child: cp.ChildProcess;
        try {
            child = cp.spawn(command, args, {
                cwd: cwd || undefined,
                env,
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: process.platform !== 'win32',
                windowsHide: true
            });
        } catch (err: any) {
            this.disposed = true;
            const message = err?.message ?? String(err);
            this.options.onDebug?.(`[PTY] spawn failed: ${message}`);
            this.options.onData?.(`\r\n[Terminal Logger] 无法启动 shell: ${message}\r\n`);
            this.options.onExit?.(1);
            return;
        }

        this.child = child;

        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');

        child.stdout?.on('data', (chunk: string) => {
            if (this.disposed) {
                return;
            }
            this.options.onData(chunk);
            this.lineBuffer.push(chunk);
        });

        child.stderr?.on('data', (chunk: string) => {
            this.options.onDebug?.(`[PTY stderr] ${chunk.trim()}`);
        });

        child.on('error', (err: Error) => {
            this.options.onDebug?.(`[PTY error] ${err.message}`);
        });

        child.on('exit', (code?: number | null) => {
            this.lineBuffer.flushRest();
            this.options.onExit?.(code === null ? undefined : code);
        });
    }

    /** 转发用户输入，并按回车切出整行命令 */
    write(data: string): void {
        if (this.disposed) {
            return;
        }
        try {
            this.child?.stdin?.write(data);
        } catch {
            // 进程已退出时忽略
        }

        for (const ch of data) {
            if (ch === '\r' || ch === '\n') {
                const line = this.input;
                this.input = '';
                if (line.trim().length > 0) {
                    const text = line.trim();
                    this.pendingEcho = { text, at: Date.now() };
                    this.options.onCommand?.(text);
                }
            } else if (ch === '\b' || ch === '\u007f') {
                this.input = this.input.slice(0, -1);
            } else {
                this.input += ch;
            }
        }
    }

    resize(rows: number, columns: number): void {
        this.rows = rows;
        this.columns = columns;
        if (this.options.shell.mode !== 'pty-bridge') {
            return;
        }
        try {
            this.child?.stdin?.write(`\x1b]TLRESIZE;${rows};${columns}\x07`);
        } catch {
            // 忽略 resize 失败
        }
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.lineBuffer.flushRest();
        const child = this.child;
        this.child = undefined;
        if (!child) {
            return;
        }
        try {
            child.stdin?.end();
        } catch {
            // 忽略
        }
        if (child.exitCode !== null || child.signalCode !== null) {
            return;
        }
        try {
            if (process.platform === 'win32') {
                cp.spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
                    stdio: 'ignore',
                    windowsHide: true
                });
            } else if (child.pid) {
                // detached 启动，python 桥接与它 fork 出的 shell 同属一个进程组
                process.kill(-child.pid, 'SIGKILL');
            }
        } catch {
            try {
                child.kill('SIGKILL');
            } catch {
                // 进程已退出
            }
        }
    }

    /**
     * 命令已由 onCommand 记成 `$ xxx`，PTY 紧接着回显的同一行要丢掉，否则命令会被记两遍。
     */
    private handleLine(rawLine: string, idle: boolean): void {
        const normalized = normalizeShellLine(LogWriter.stripAnsi(rawLine));
        if (normalized === null) {
            return;
        }

        const line = normalized.replace(/\s+$/, '');
        const echo = this.pendingEcho;

        if (echo) {
            if (Date.now() - echo.at > 3000) {
                this.pendingEcho = undefined;
            } else if (line.endsWith(echo.text)) {
                this.pendingEcho = undefined;
                return;
            }
        }

        // 提示符会被空闲收尾反复送出，同一个不重复记
        if (idle) {
            if (line === this.lastPromptLine) {
                return;
            }
            this.lastPromptLine = line;
        }

        this.options.onLine(line);
    }
}
