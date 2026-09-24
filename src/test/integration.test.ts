/**
 * Terminal Logger 验收测试
 *
 * 覆盖：
 * - ANSI 清理与命令/输出写入
 * - 连续输出在会话结束前就落盘（issue #2）
 * - 多个终端各自保存日志（issue #1 / #2）
 * - read() 为空时后续终端仍继续记录（issue #1）
 * - 日志超过阈值后丢弃旧内容或轮转新文件（issue #3）
 * - 命令输入按整行记录，而不是一行一个字母（issue #7）
 * - Remote SSH 上 bash/zsh/Windows 的逐字回显在命令期间到达时仍按整行记录（issue #9）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LogWriter } from '../logWriter';
import { CaptureRouter } from '../captureRouter';
import { normalizeShellLine } from '../ptyAssembler';
import { allocateLogPath, formatFileName, loggingToggleTarget, pickWorkspaceRoot } from '../format';

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

async function runTests(): Promise<void> {
    console.log('\n🧪 Terminal Logger 验收测试\n');

    const tmpDir = path.join(os.tmpdir(), `terminal-logger-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    console.log('📋 测试组 1: ANSI 转义序列清理');

    assert(
        '清理 CSI 颜色序列',
        LogWriter.stripAnsi('\x1b[32mHello\x1b[0m') === 'Hello'
    );

    assert(
        '清理 OSC 序列 (BEL 终止)',
        LogWriter.stripAnsi('\x1b]0;title\x07Hello') === 'Hello'
    );

    assert(
        '清理单字符 ESC 序列 (\\x1b= \\x1b>)',
        LogWriter.stripAnsi('\x1b=Hello\x1b>') === 'Hello'
    );

    assert(
        '回车换行仍分成两行',
        LogWriter.stripAnsi('Hello\r\nWorld') === 'Hello\nWorld'
    );

    assert(
        '回车覆盖当前行，而不是把前后拼在一起',
        LogWriter.stripAnsi('foo\rbar') === 'bar'
    );

    assert(
        '退格重绘折叠成最终文本',
        LogWriter.stripAnsi('e\becho "again"') === 'echo "again"'
    );

    assert(
        '混合 ANSI 序列全部清理',
        LogWriter.stripAnsi('\x1b[1;32m❯\x1b[0m \x1b[34mls\x1b[0m /tmp\x1b=\r') === '❯ ls /tmp'
    );

    console.log('\n📋 测试组 2: LogWriter 日志文件写入');

    const logPath = path.join(tmpDir, 'test.log');
    const writer = new LogWriter({
        logPath,
        timestampFormat: '[YYYY-MM-DD HH:mm:ss]',
        maxFileSizeBytes: 0
    });

    writer.write('$ ls /tmp');
    writer.write('file1.txt\nfile2.txt\nfile3.txt');
    writer.write('$ date');
    writer.write('Thu Feb 12 12:00:00 CST 2026');
    writer.write('$ echo HELLO_TEST');
    writer.write('HELLO_TEST');
    writer.dispose();

    const logContent = fs.readFileSync(logPath, 'utf-8');
    const logLines = logContent.split('\n');

    assert('日志文件存在且非空', logContent.length > 0, `文件大小: ${logContent.length}`);
    assert('日志包含会话开始标记', logContent.includes('终端日志会话开始'));
    assert('日志包含会话结束标记', logContent.includes('终端日志会话结束'));
    assert('日志包含 $ ls /tmp 命令', logContent.includes('$ ls /tmp'));
    assert('日志包含 ls 输出 (file1.txt)', logContent.includes('file1.txt'));
    assert('日志包含 $ date 命令', logContent.includes('$ date'));
    assert('日志包含 date 输出 (2026)', logContent.includes('2026'));
    assert('日志包含 echo 输出 (HELLO_TEST)', logContent.includes('HELLO_TEST'));
    assert(
        '日志行带有时间戳',
        logLines.some(l => /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/.test(l))
    );

    console.log('\n📋 测试组 3: 带 ANSI 序列的数据写入');

    const logPath2 = path.join(tmpDir, 'test_ansi.log');
    const writer2 = new LogWriter({
        logPath: logPath2,
        timestampFormat: '[YYYY-MM-DD HH:mm:ss]',
        maxFileSizeBytes: 0
    });

    writer2.write('\x1b[1;32m❯\x1b[0m \x1b[34mls\x1b[0m /tmp\r');
    writer2.write('\x1b[32mfile1.txt\x1b[0m  \x1b[34mdir1\x1b[0m\r');
    writer2.write('');
    writer2.write('\x1b[32m');
    writer2.dispose();

    const logContent2 = fs.readFileSync(logPath2, 'utf-8');

    assert(
        'ANSI 序列被清理，保留文本内容',
        logContent2.includes('ls /tmp') && !logContent2.includes('\x1b[')
    );
    assert('空行和纯 ANSI 内容不写入日志', !logContent2.includes('\x1b[32m'));

    console.log('\n📋 测试组 4: 连续输出在会话结束前落盘 (issue #2)');

    const livePath = path.join(tmpDir, 'live.log');
    const liveWriter = new LogWriter({
        logPath: livePath,
        timestampFormat: '[YYYY-MM-DD HH:mm:ss]',
        maxFileSizeBytes: 0
    });
    const sizeBefore = liveWriter.getSize();
    liveWriter.write('continuous line 1');
    const midContent = fs.readFileSync(livePath, 'utf-8');
    const sizeAfterFirst = liveWriter.getSize();
    liveWriter.write('continuous line 2');
    liveWriter.write('progress update 50%');
    const whileRunning = fs.readFileSync(livePath, 'utf-8');

    assert('首行连续输出写入后文件立即变大', sizeAfterFirst > sizeBefore, `before=${sizeBefore}, after=${sizeAfterFirst}`);
    assert('会话未结束时已能读到第一行', midContent.includes('continuous line 1'));
    assert('会话未结束时已能读到后续连续输出', whileRunning.includes('continuous line 2') && whileRunning.includes('progress update 50%'));
    liveWriter.dispose();

    console.log('\n📋 测试组 5: 多个终端各自保存 (issue #1 / #2)');

    const multiDir = path.join(tmpDir, 'multi');
    fs.mkdirSync(multiDir, { recursive: true });
    const when = new Date(2026, 2, 5, 14, 36, 7);
    const pattern = 'terminal_{terminalName}_{date}.log';
    const firstName = formatFileName(pattern, 'bash', when, 'term1');
    const secondName = formatFileName(pattern, 'bash', when, 'term2');
    const reserved = new Set<string>();
    const firstPath = allocateLogPath(multiDir, firstName, reserved, 'term1');
    reserved.add(firstPath);
    const secondPath = allocateLogPath(multiDir, secondName, reserved, 'term2');

    assert('两个同名终端不会共用同一个日志文件', firstPath !== secondPath, `${firstPath} vs ${secondPath}`);

    const firstWriter = new LogWriter({ logPath: firstPath, timestampFormat: '[YYYY-MM-DD HH:mm:ss]', maxFileSizeBytes: 0 });
    const secondWriter = new LogWriter({ logPath: secondPath, timestampFormat: '[YYYY-MM-DD HH:mm:ss]', maxFileSizeBytes: 0 });
    firstWriter.write('$ echo FIRST_TERMINAL');
    firstWriter.write('FIRST_TERMINAL');
    secondWriter.write('$ echo SECOND_TERMINAL');
    secondWriter.write('SECOND_TERMINAL');
    const firstLive = fs.readFileSync(firstPath, 'utf-8');
    const secondLive = fs.readFileSync(secondPath, 'utf-8');
    firstWriter.dispose();
    secondWriter.dispose();

    assert('第一个终端保存了自己的命令和输出', firstLive.includes('FIRST_TERMINAL') && firstLive.includes('$ echo FIRST_TERMINAL'));
    assert('第二个终端保存了自己的命令和输出', secondLive.includes('SECOND_TERMINAL') && secondLive.includes('$ echo SECOND_TERMINAL'));
    assert('第二个终端的日志里没有第一个终端的输出', !secondLive.includes('FIRST_TERMINAL'));

    const workspaceRoot = pickWorkspaceRoot('/ws/app-b/src', ['/ws/app-a', '/ws/app-b']);
    assert('多根工作区按终端所在目录选择日志根，而不是总用第一个', workspaceRoot === '/ws/app-b');
    assert('没有匹配目录时仍回退到第一个工作区', pickWorkspaceRoot('/other', ['/ws/app-a', '/ws/app-b']) === '/ws/app-a');
    assert('有工作区时日志开关只作用于当前工作区', loggingToggleTarget(true) === 'workspace');
    assert('没有工作区时日志开关写入全局配置', loggingToggleTarget(false) === 'global');

    console.log('\n📋 测试组 6: read() 为空时后续终端继续记录 (issue #1)');

    const router = new CaptureRouter(500);
    const captured: string[] = [];
    const sink = (data: string) => captured.push(data);

    router.beginCommand('term-1');
    sink('$ echo ok');
    router.readChunk('term-1', 'ok\n', 1_000, sink);
    router.readFinished('term-1');

    router.beginCommand('term-2');
    sink('$ echo second');
    router.readFinished('term-2');
    const wroteFallback = router.terminalData('term-2', 'second-output\n', 2_000, sink);

    router.beginCommand('term-2');
    sink('$ echo third');
    router.readChunk('term-2', 'third-output\n', 3_000, sink);

    assert('第二个终端在 read() 为空后仍然记录命令', captured.includes('$ echo second') && captured.includes('$ echo third'));
    assert('read() 为空时改用终端原始数据记录输出', wroteFallback && captured.some(line => line.includes('second-output')));
    assert('后续命令的 read() 输出仍会记录', captured.some(line => line.includes('third-output')));

    const streaming: string[] = [];
    const streamSink = (data: string) => streaming.push(data);
    const liveRouter = new CaptureRouter(500);
    liveRouter.beginCommand('live');
    liveRouter.readChunk('live', 'chunk-from-read', 10_000, streamSink);
    const duplicated = liveRouter.terminalData('live', 'chunk-from-pty', 10_200, streamSink);
    const afterStall = liveRouter.terminalData('live', 'continuous-after-stall', 10_600, streamSink);
    liveRouter.readChunk('live', 'late-read-dump', 10_700, streamSink);

    assert('read() 正在推送时不重复记录原始终端数据', duplicated === false && !streaming.includes('chunk-from-pty'));
    assert('read() 停止推送后连续输出仍被记录', afterStall === true && streaming.includes('continuous-after-stall'));
    assert('已经改走原始数据后，不再把 read() 的积压重复写入', !streaming.includes('late-read-dump'));

    console.log('\n📋 测试组 7: 日志长度阈值 (issue #3)');

    const discardPath = path.join(tmpDir, 'discard.log');
    const discardWriter = new LogWriter({
        logPath: discardPath,
        timestampFormat: '[YYYY-MM-DD HH:mm:ss]',
        maxFileSizeBytes: 900,
        overflowPolicy: 'discard',
        maxRotatedFiles: 2
    });
    for (let i = 0; i < 40; i++) {
        discardWriter.write(`OLD_ENTRY_${i}_` + 'x'.repeat(40));
    }
    discardWriter.write('NEWEST_ENTRY_KEEP');
    const discardSize = discardWriter.getSize();
    const discardContent = fs.readFileSync(discardPath, 'utf-8');
    discardWriter.dispose();

    assert('丢弃策略下文件大小不超过阈值', discardSize <= 900, `size=${discardSize}`);
    assert('丢弃策略保留最新日志', discardContent.includes('NEWEST_ENTRY_KEEP'));
    assert('丢弃策略写明已丢掉旧日志', discardContent.includes('已丢弃更早的日志以控制文件大小'));
    assert('最早的日志已被丢弃', !discardContent.includes('OLD_ENTRY_0_'));

    const rotatePath = path.join(tmpDir, 'rotate.log');
    const rotateWriter = new LogWriter({
        logPath: rotatePath,
        timestampFormat: '[YYYY-MM-DD HH:mm:ss]',
        maxFileSizeBytes: 1200,
        overflowPolicy: 'rotate',
        maxRotatedFiles: 2
    });
    for (let i = 0; i < 40; i++) {
        rotateWriter.write(`ROTATE_LINE_${i}_` + 'y'.repeat(50));
    }
    rotateWriter.write('ROTATE_NEWEST');
    const rotateSize = rotateWriter.getSize();
    const rotateContent = fs.readFileSync(rotatePath, 'utf-8');
    rotateWriter.dispose();
    const archived = path.join(tmpDir, 'rotate.1.log');
    const archiveContent = fs.existsSync(archived) ? fs.readFileSync(archived, 'utf-8') : '';

    assert('轮转后当前文件仍不超过阈值（含会话结束标记的少量溢出除外）', rotateSize <= 1200 + 80, `size=${rotateSize}`);
    assert('轮转后的当前文件包含最新日志', rotateContent.includes('ROTATE_NEWEST'));
    assert('轮转会留下历史文件', fs.existsSync(archived) && archiveContent.includes('日志已轮转'));
    assert('最早的日志留在历史文件中，不撑大当前文件', archiveContent.includes('ROTATE_LINE_0_') || !rotateContent.includes('ROTATE_LINE_0_'));

    console.log('\n📋 测试组 8: 命令按整行记录，不逐字拆行 (issue #7)');

    const issue7 = new CaptureRouter(500);
    const issue7Log: string[] = [];
    const recordIssue7 = (data: string) => issue7Log.push(data);
    const typingEcho = ['e\becho', '"', '"', '\b', 'a"\b', 'g"\b', 'e"\b', 't"\b', '\b" \b\b', '\b" \b\b', 'a"\b', 'i"\b', 'n"\b'];
    const typingPs = ['\b p', '\b\b  \b', '\b', 'p', '\bps'];

    for (const chunk of typingEcho) {
        issue7.terminalData('zsh', chunk, 1_000, recordIssue7);
    }

    issue7.beginCommand('zsh');
    recordIssue7('$ echo "again"');
    issue7.readChunk('zsh', 'again\n', 2_000, recordIssue7);
    issue7.readFinished('zsh', 2_010);
    const duplicatedOutput = issue7.terminalData('zsh', 'again\n', 2_020, recordIssue7);
    const promptDuringGap = issue7.terminalData('zsh', '➜  ~ \n', 2_040, recordIssue7);
    issue7.endCommand('zsh');
    const promptAfterEnd = issue7.terminalData('zsh', '➜  ~ \n', 2_100, recordIssue7);

    for (const chunk of typingPs) {
        issue7.terminalData('zsh', chunk, 3_000, recordIssue7);
    }

    issue7.beginCommand('zsh');
    recordIssue7('$ ps');
    issue7.readChunk('zsh', '  PID TTY           TIME CMD\n67072 ttys001    0:00.09 /bin/zsh -l\n', 4_000, recordIssue7);
    issue7.readFinished('zsh', 4_010);
    issue7.endCommand('zsh');
    issue7.terminalData('zsh', '➜  ~ \n', 4_200, recordIssue7);

    const readablePath = path.join(tmpDir, 'issue7.log');
    const readableWriter = new LogWriter({
        logPath: readablePath,
        timestampFormat: '[YYYY-MM-DD HH:mm:ss]',
        maxFileSizeBytes: 0
    });
    for (const entry of issue7Log) {
        readableWriter.write(entry);
    }
    readableWriter.dispose();
    const readable = fs.readFileSync(readablePath, 'utf-8');
    const readableLines = readable.split('\n').map(line => line.replace(/^\[[^\]]+\] /, ''));

    assert('敲命令时的逐字回显不写入日志', typingEcho.every(chunk => !issue7Log.includes(chunk)) && typingPs.every(chunk => !issue7Log.includes(chunk)));
    assert('整行命令被记录', issue7Log.includes('$ echo "again"') && issue7Log.includes('$ ps'));
    assert('命令输出只保留一份', duplicatedOutput === false && issue7Log.filter(entry => entry.includes('again\n')).length === 1);
    assert('提示符不写入日志', promptDuringGap === false && promptAfterEnd === false && !readable.includes('➜'));
    assert('日志里能看到完整命令和输出', readable.includes('$ echo "again"') && readable.includes('again') && readable.includes('$ ps') && readable.includes('PID TTY'));
    assert('日志里没有退格，也没有单字母行', !readable.includes('\b') && !readableLines.some(line => line === 'e' || line === 'p' || line === '"'));

    const remote = new CaptureRouter(500);
    const remoteLog: string[] = [];
    const remoteSink = (data: string) => remoteLog.push(data);
    remote.beginCommand('ssh');
    remoteSink('$ echo second');
    remote.readFinished('ssh');
    const wroteRemote = remote.terminalData('ssh', 'second-output\n', 5_000, remoteSink);
    remote.endCommand('ssh');
    const remotePrompt = remote.terminalData('ssh', 'user@host:~$ \n', 5_100, remoteSink);
    remote.terminalData('ssh', 'l\bls\n', 5_200, remoteSink);

    assert('read() 为空时，命令执行期间的原始输出仍然记录', wroteRemote && remoteLog.some(entry => entry.includes('second-output')));
    assert('命令结束后的提示符和按键不再记录', remotePrompt === false && !remoteLog.some(entry => entry.includes('user@host') || entry.includes('\b')));

    console.log('\n📋 测试组 9: Remote SSH 逐字回显按整行记录 (issue #9)');

    const singleLetter = (entries: string[]) => entries.some(entry => /^[a-zA-Z"]$/.test(entry.trim()) || entry.includes('\b'));

    const bash = new CaptureRouter(500);
    const bashLog: string[] = [];
    bash.beginCommand('ubuntu');
    bash.noteCommand('ubuntu', 'echo hi');
    let bashAt = 60_000;
    for (const ch of 'echo hi') {
        bash.terminalData('ubuntu', ch, bashAt, data => bashLog.push(data));
        bashAt += 120;
    }
    bash.terminalData('ubuntu', '\r\n', bashAt, data => bashLog.push(data));
    bashAt += 40;
    const bashOutput = bash.terminalData('ubuntu', 'hi\r\n', bashAt, data => bashLog.push(data));
    const bashPrompt = bash.terminalData('ubuntu', 'dev@ubuntu:~$ \r\n', bashAt + 30, data => bashLog.push(data));
    bash.endCommand('ubuntu');

    assert('Ubuntu bash 逐字回显不会拆成单字母行', !singleLetter(bashLog) && !bashLog.some(entry => entry.trim() === 'e' || entry.trim() === 'echo'));
    assert('Ubuntu bash 不重复记录已由 Shell Integration 记下的命令', !bashLog.some(entry => entry.trim() === 'echo hi'));
    assert('Ubuntu bash 命令输出仍然记录', bashOutput && bashLog.includes('hi'));
    assert('Ubuntu bash 提示符不写入日志', bashPrompt === false && !bashLog.some(entry => entry.includes('dev@ubuntu')));

    const bashPlain = new CaptureRouter(500);
    const bashPlainLog: string[] = [];
    bashPlain.beginCommand('bash');
    let plainAt = 70_000;
    for (const ch of 'echo hi') {
        bashPlain.terminalData('bash', ch, plainAt, data => bashPlainLog.push(data));
        plainAt += 100;
    }
    bashPlain.terminalData('bash', '\r\n', plainAt, data => bashPlainLog.push(data));
    assert('没有 Shell Integration 命令文本时，bash 输入折叠成一行', bashPlainLog.length === 1 && bashPlainLog[0] === 'echo hi');

    const zshRemote = new CaptureRouter(500);
    const zshLog: string[] = [];
    zshRemote.beginCommand('zsh');
    zshRemote.noteCommand('zsh', 'echo "again"');
    let zshAt = 80_000;
    for (const chunk of typingEcho) {
        zshRemote.terminalData('zsh', chunk, zshAt, data => zshLog.push(data));
        zshAt += 150;
    }
    zshRemote.terminalData('zsh', '\r\n', zshAt, data => zshLog.push(data));
    const zshOutput = zshRemote.terminalData('zsh', 'again\r\n', zshAt + 20, data => zshLog.push(data));
    zshRemote.terminalData('zsh', '%                                                                                \r\n', zshAt + 40, data => zshLog.push(data));
    zshRemote.terminalData('zsh', '➜  ~ \r\n', zshAt + 60, data => zshLog.push(data));
    for (const chunk of typingPs) {
        zshRemote.terminalData('zsh', chunk, zshAt + 200, data => zshLog.push(data));
    }
    zshRemote.terminalData('zsh', '\r\n', zshAt + 400, data => zshLog.push(data));

    assert('zsh 退格重绘不会拆成单字母行', !singleLetter(zshLog) && zshLog.every(entry => !entry.includes('\b')));
    assert('zsh 命令输出仍然记录', zshOutput && zshLog.includes('again'));
    assert('zsh 提示符不写入日志', !zshLog.some(entry => entry.includes('➜') || entry.trim() === '%'));
    assert('zsh 已记录的命令不会从回显再写一遍', !zshLog.some(entry => entry.replace(/\s+/g, '').includes('echo"again')));

    const windows = new CaptureRouter(500);
    const windowsLog: string[] = [];
    windows.beginCommand('ps');
    windows.terminalData('ps', 'hello from powershell\r\n', 90_000, data => windowsLog.push(data));
    windows.terminalData('ps', 'PS C:\\Users\\me>\r\n', 90_100, data => windowsLog.push(data));
    windows.terminalData('ps', 'C:\\Users\\me\\file.txt\r\n', 90_200, data => windowsLog.push(data));
    windows.terminalData('ps', 'C:\\Users\\me>\r\n', 90_300, data => windowsLog.push(data));
    windows.terminalData('ps', 'MacBook-Pro:src jerome$\r\n', 90_400, data => windowsLog.push(data));
    const psPromptStripped = windows.terminalData('ps', 'PS C:\\Users\\me> Get-Date\r\n', 90_500, data => windowsLog.push(data));

    assert('PowerShell 和 cmd 提示符不写入日志', !windowsLog.some(entry => entry.startsWith('PS ') || entry === 'C:\\Users\\me>' || entry.includes('MacBook-Pro')));
    assert('Windows 命令输出和路径仍然记录', windowsLog.includes('hello from powershell') && windowsLog.includes('C:\\Users\\me\\file.txt'));
    assert('提示符和命令在同一行时只留下命令', psPromptStripped && windowsLog.includes('Get-Date'));

    const streamingChars = new CaptureRouter(500);
    const streamChars: string[] = [];
    streamingChars.beginCommand('fast');
    let fastAt = 100_000;
    for (let i = 0; i < 20; i++) {
        streamingChars.terminalData('fast', 'x', fastAt, data => streamChars.push(data));
        fastAt += 10;
    }
    streamingChars.terminalData('fast', '\n', fastAt, data => streamChars.push(data));
    const streamed = streamChars.join('');
    assert('连续单字符输出会记下来，而不是每个字母一行', streamChars.length <= 2 && streamed === 'x'.repeat(20) && streamChars.every(entry => entry.length >= 4));

    assert('纯提示符被识别出来', normalizeShellLine('dev@ubuntu:~$') === null && normalizeShellLine('➜  ~') === null && normalizeShellLine('%') === null && normalizeShellLine('MacBook-Pro:src jerome$') === null);
    assert('普通输出不会被当成提示符', normalizeShellLine('  PID TTY           TIME CMD') === '  PID TTY           TIME CMD' && normalizeShellLine('C:\\Users\\me\\file.txt') === 'C:\\Users\\me\\file.txt');

    const shortOutput = new CaptureRouter(500);
    const shortLog: string[] = [];
    shortOutput.beginCommand('ssh');
    const wroteShort = shortOutput.terminalData('ssh', 'ok', 110_000, data => shortLog.push(data));
    const shortTail = shortOutput.endCommand('ssh');
    assert('没有换行的短输出在命令结束时仍然保留', wroteShort === false && shortLog.length === 0 && shortTail === 'ok');

    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
        // ignore
    }

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
