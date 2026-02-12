/**
 * Terminal Logger 单元测试
 * 
 * 注意：Shell Integration API (onDidStartTerminalShellExecution / execution.read())
 * 是 VSCode 运行时 API，只能在 VSCode 扩展宿主进程中运行。
 * 这里测试 LogWriter 的核心功能：ANSI 清理、时间戳写入、日志文件生成。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================
// 测试工具
// ============================================================

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

// ============================================================
// LogWriter 独立测试（不依赖 vscode 模块）
// ============================================================

// 手动模拟 LogWriter 的核心逻辑，因为真正的 LogWriter import 会依赖 vscode
function stripAnsi(str: string): string {
    return str
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\x1b\][^\x07]*\x07/g, '')
        .replace(/\x1b\][^\x1b]*\x1b\\/g, '')
        .replace(/\x1b[()][0-9A-B]/g, '')
        .replace(/\x1b\[[\?]?[0-9;]*[hlm]/g, '')
        .replace(/\x1b[=><=Nno|{}~78]/g, '')
        .replace(/\r/g, '');
}

function formatTimestamp(format: string, date: Date = new Date()): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return format
        .replace('YYYY', date.getFullYear().toString())
        .replace('MM', pad(date.getMonth() + 1))
        .replace('DD', pad(date.getDate()))
        .replace('HH', pad(date.getHours()))
        .replace('mm', pad(date.getMinutes()))
        .replace('ss', pad(date.getSeconds()));
}

/**
 * 简易 LogWriter（不依赖 vscode）
 */
class TestLogWriter {
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
        const dir = path.dirname(this.logPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.writeStream = fs.createWriteStream(this.logPath, { flags: 'a' });
        const startTime = formatTimestamp(this.timestampFormat);
        this.writeStream.write(`\n${'='.repeat(60)}\n`);
        this.writeStream.write(`${startTime} 终端日志会话开始\n`);
        this.writeStream.write(`${'='.repeat(60)}\n\n`);
    }

    write(data: string, timestamp: Date = new Date()): void {
        if (!this.writeStream) {
            return;
        }
        const cleanData = stripAnsi(data);
        if (!cleanData.trim()) {
            return;
        }
        const timestampStr = formatTimestamp(this.timestampFormat, timestamp);
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

    getLogPath(): string {
        return this.logPath;
    }

    dispose(): void {
        if (this.writeStream) {
            const endTime = formatTimestamp(this.timestampFormat);
            this.writeStream.write(`\n\n${endTime} 终端日志会话结束\n`);
            this.writeStream.end();
            this.writeStream = null;
        }
    }
}

// ============================================================
// 测试执行
// ============================================================

async function runTests(): Promise<void> {
    console.log('\n🧪 Terminal Logger 单元测试\n');

    const tmpDir = path.join(os.tmpdir(), `terminal-logger-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // --- 测试组 1: stripAnsi ---
    console.log('📋 测试组 1: ANSI 转义序列清理');

    assert(
        '清理 CSI 颜色序列',
        stripAnsi('\x1b[32mHello\x1b[0m') === 'Hello'
    );

    assert(
        '清理 OSC 序列 (BEL 终止)',
        stripAnsi('\x1b]0;title\x07Hello') === 'Hello'
    );

    assert(
        '清理单字符 ESC 序列 (\\x1b= \\x1b>)',
        stripAnsi('\x1b=Hello\x1b>') === 'Hello'
    );

    assert(
        '清理 \\r 回车符',
        stripAnsi('Hello\r\nWorld') === 'Hello\nWorld'
    );

    assert(
        '混合 ANSI 序列全部清理',
        stripAnsi('\x1b[1;32m❯\x1b[0m \x1b[34mls\x1b[0m /tmp\x1b=\r') === '❯ ls /tmp'
    );

    // --- 测试组 2: LogWriter 文件写入 ---
    console.log('\n📋 测试组 2: LogWriter 日志文件写入');

    const logPath = path.join(tmpDir, 'test.log');
    const writer = new TestLogWriter(logPath, '[YYYY-MM-DD HH:mm:ss]');

    // 模拟 Shell Integration API 捕获到的命令和输出
    writer.write('$ ls /tmp');
    writer.write('file1.txt\nfile2.txt\nfile3.txt');
    writer.write('$ date');
    writer.write('Thu Feb 12 12:00:00 CST 2026');
    writer.write('$ echo HELLO_TEST');
    writer.write('HELLO_TEST');

    // 等待写入流 flush
    await new Promise(resolve => setTimeout(resolve, 500));

    writer.dispose();

    // 等待 dispose 的写入完成
    await new Promise(resolve => setTimeout(resolve, 500));

    const logContent = fs.readFileSync(logPath, 'utf-8');
    const logLines = logContent.split('\n');

    assert(
        '日志文件存在且非空',
        logContent.length > 0,
        `文件大小: ${logContent.length}`
    );

    assert(
        '日志包含会话开始标记',
        logContent.includes('终端日志会话开始')
    );

    assert(
        '日志包含会话结束标记',
        logContent.includes('终端日志会话结束')
    );

    assert(
        '日志包含 $ ls /tmp 命令',
        logContent.includes('$ ls /tmp')
    );

    assert(
        '日志包含 ls 输出 (file1.txt)',
        logContent.includes('file1.txt')
    );

    assert(
        '日志包含 $ date 命令',
        logContent.includes('$ date')
    );

    assert(
        '日志包含 date 输出 (2026)',
        logContent.includes('2026')
    );

    assert(
        '日志包含 echo 输出 (HELLO_TEST)',
        logContent.includes('HELLO_TEST')
    );

    assert(
        '日志行带有时间戳',
        logLines.some(l => /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/.test(l))
    );

    // --- 测试组 3: ANSI 数据写入时自动清理 ---
    console.log('\n📋 测试组 3: 带 ANSI 序列的数据写入');

    const logPath2 = path.join(tmpDir, 'test_ansi.log');
    const writer2 = new TestLogWriter(logPath2, '[YYYY-MM-DD HH:mm:ss]');

    // 模拟真实终端输出（带 ANSI）
    writer2.write('\x1b[1;32m❯\x1b[0m \x1b[34mls\x1b[0m /tmp\r');
    writer2.write('\x1b[32mfile1.txt\x1b[0m  \x1b[34mdir1\x1b[0m\r');
    writer2.write('');  // 空行应被忽略
    writer2.write('\x1b[32m');  // 纯 ANSI 序列应被忽略

    await new Promise(resolve => setTimeout(resolve, 500));
    writer2.dispose();
    await new Promise(resolve => setTimeout(resolve, 500));

    const logContent2 = fs.readFileSync(logPath2, 'utf-8');

    assert(
        'ANSI 序列被清理，保留文本内容',
        logContent2.includes('ls /tmp') && !logContent2.includes('\x1b[')
    );

    assert(
        '空行和纯 ANSI 内容不写入日志',
        !logContent2.includes('\x1b[32m')
    );

    // --- 清理 ---
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
        // ignore
    }

    // --- 结果 ---
    console.log(`\n${'='.repeat(50)}`);
    console.log(`测试结果: ${passCount}/${testCount} 通过, ${failCount} 失败`);
    console.log(`${'='.repeat(50)}\n`);

    if (failCount > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('测试执行错误:', err);
    process.exit(1);
});
