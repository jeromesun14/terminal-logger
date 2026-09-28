/**
 * 自建 PTY 会话测试
 *
 * 覆盖：
 * - shell 解析：Linux / macOS / Windows 三平台，bash / zsh / PowerShell / cmd，profile 优先
 * - 真实 PTY 捕获：命令整行、命令输出、多行输出都能拿到
 * - 命令回显去重：命令不会被记两遍
 * - 会话关闭后进程退出
 */

import * as os from 'os';
import { PtySession, resolveShell, ShellLaunch } from '../ptySession';

let testCount = 0;
let passCount = 0;
let failCount = 0;

function assert(name: string, condition: boolean, detail?: string): void {
    testCount++;
    if (condition) {
        passCount++;
        console.log(`  ✅ 测试 ${testCount}: ${name}`);
    } else {
        failCount++;
        console.log(`  ❌ 测试 ${testCount}: ${name}`);
        if (detail) {
            console.log(`     详情: ${detail}`);
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function testResolveShell(): void {
    console.log('\n📦 shell 解析');

    const linux = resolveShell({ platform: 'linux', env: { SHELL: '/usr/bin/zsh' } });
    assert('Linux 使用 SHELL 指定的 zsh', linux.command === '/usr/bin/zsh', JSON.stringify(linux));
    assert('Linux zsh 以交互模式启动', linux.args.join(' ') === '-i', JSON.stringify(linux.args));

    const darwin = resolveShell({ platform: 'darwin', env: {} });
    assert('macOS 无 SHELL 时兜底 zsh', darwin.command === '/bin/zsh', JSON.stringify(darwin));

    const linuxNoShell = resolveShell({ platform: 'linux', env: {} });
    assert('Linux 无 SHELL 时兜底 bash', linuxNoShell.command === '/bin/bash', JSON.stringify(linuxNoShell));

    const darwinFish = resolveShell({
        platform: 'darwin',
        env: { SHELL: '/opt/homebrew/bin/fish' },
        defaultProfile: 'fish',
        profiles: { fish: { path: '/opt/homebrew/bin/fish' } }
    });
    assert('profile 指定的 shell 优先', darwinFish.command === '/opt/homebrew/bin/fish', JSON.stringify(darwinFish));

    const windowsCmd = resolveShell({ platform: 'win32', env: { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' } });
    assert('Windows 默认走 cmd', windowsCmd.command === 'C:\\Windows\\System32\\cmd.exe', JSON.stringify(windowsCmd));
    assert('Windows cmd 参数', windowsCmd.args.join(' ') === '/Q /K', JSON.stringify(windowsCmd.args));
    assert('Windows 不使用 PTY 桥接', windowsCmd.mode === 'pipe', windowsCmd.mode);

    const windowsPwsh = resolveShell({
        platform: 'win32',
        env: {},
        defaultProfile: 'PowerShell',
        profiles: { PowerShell: { path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' } }
    });
    assert(
        'Windows PowerShell 用 -Command - 读 stdin',
        windowsPwsh.args.join(' ') === '-NoProfile -Command -',
        JSON.stringify(windowsPwsh.args)
    );

    const windowsBash = resolveShell({
        platform: 'win32',
        env: {},
        defaultProfile: 'Git Bash',
        profiles: { 'Git Bash': { path: 'C:\\Program Files\\Git\\bin\\bash.exe' } }
    });
    assert('Windows Git Bash 交互启动', windowsBash.args.join(' ') === '-i', JSON.stringify(windowsBash.args));

    const customArgs = resolveShell({
        platform: 'linux',
        env: {},
        defaultProfile: 'bash',
        profiles: { bash: { path: '/bin/bash', args: ['--login'] } }
    });
    assert('profile 自带 args 被保留', customArgs.args.join(' ') === '--login', JSON.stringify(customArgs.args));
}

async function testLiveSession(shell: ShellLaunch): Promise<void> {
    console.log(`\n🖥️  真实 PTY 会话（mode=${shell.mode}, shell=${shell.command}）`);

    const lines: string[] = [];
    const commands: string[] = [];
    let exited = false;

    const session = new PtySession({
        shell,
        cwd: os.tmpdir(),
        rows: 30,
        columns: 100,
        onData: () => { /* 界面回显，测试不关心 */ },
        onLine: line => lines.push(line),
        onCommand: commandLine => commands.push(commandLine),
        onDebug: message => {
            if (process.env.TL_TEST_VERBOSE) {
                console.log(`     [debug] ${message}`);
            }
        },
        onExit: () => { exited = true; }
    });

    session.start();
    await sleep(800);

    session.write('echo TL_PTY_MARKER\r');
    await sleep(1200);

    session.write('printf "TL_LINE_A\\nTL_LINE_B\\n"\r');
    await sleep(1200);

    session.resize(40, 120);
    await sleep(200);

    session.dispose();
    await sleep(800);

    assert(
        '整行命令被识别',
        commands.includes('echo TL_PTY_MARKER') && commands.includes('printf "TL_LINE_A\\nTL_LINE_B\\n"'),
        JSON.stringify(commands)
    );

    assert(
        '命令输出被捕获',
        lines.some(line => line.trim() === 'TL_PTY_MARKER'),
        JSON.stringify(lines)
    );

    assert(
        '多行输出分别成行',
        lines.some(line => line.trim() === 'TL_LINE_A') && lines.some(line => line.trim() === 'TL_LINE_B'),
        JSON.stringify(lines)
    );

    const echoLines = lines.filter(line => line.trim() === 'echo TL_PTY_MARKER');
    assert('命令回显没有重复入账', echoLines.length === 0, JSON.stringify(echoLines));

    assert('会话关闭后子进程退出', exited);
}

async function runTests(): Promise<void> {
    console.log('\n🧪 自建 PTY 会话测试\n');

    testResolveShell();

    const shell = resolveShell({
        platform: process.platform,
        env: { ...process.env, SHELL: process.env.SHELL || '/bin/bash' } as NodeJS.ProcessEnv
    });
    await testLiveSession(shell);

    console.log(`\n📊 结果: ${passCount} 通过 / ${failCount} 失败 / 共 ${testCount}\n`);

    if (failCount > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('测试执行异常:', err);
    process.exit(1);
});
