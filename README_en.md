# Terminal Logger

[中文文档](README.md) | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=jeromesun.terminal-logger)

A VSCode extension that automatically logs terminal output to files using the **Shell Integration API** (VSCode 1.93+). It captures commands and their output from any IDE terminal — no special terminal required.

## Features

- **Auto-capture terminal output** — Logs every command and its output from all IDE terminals
- **Timestamp support** — Each log line is prefixed with a timestamp `[2026-02-12 10:30:45]`
- **Multi-terminal support** — Each terminal gets its own log file, auto-named
- **Status bar indicator** — Shows logging status and active terminal count in real time
- **Configurable paths** — Customize where logs are saved

## Requirements

- VSCode **1.93.0** or later
- Terminal Shell Integration enabled (enabled by default)

## Installation

### From VSIX

```bash
code --install-extension terminal-logger-1.0.1.vsix
```

### Build from Source

```bash
npm install
npm run compile
npx vsce package
```

## Usage

1. Install the extension — logging starts automatically for all terminals.
2. Open any terminal in VSCode and run commands as usual.
3. Use `Terminal Logger: Open Log Folder` from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) to view logs.

## Commands

| Command | Description |
|---------|-------------|
| `Terminal Logger: 开启/关闭日志记录` | Toggle logging on/off |
| `Terminal Logger: 打开日志文件夹` | Open the log directory in your file manager |
| `Terminal Logger: 清空当前日志` | Clear the current log file |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `terminalLogger.enabled` | `true` | Enable/disable terminal logging |
| `terminalLogger.logPath` | `""` | Log file path (empty = workspace `.terminal-logs` directory) |
| `terminalLogger.timestampFormat` | `"[YYYY-MM-DD HH:mm:ss]"` | Timestamp format |
| `terminalLogger.fileNamePattern` | `"terminal_{terminalName}_{date}_{time}_{session}.log"` | Log file name pattern. Supports `{terminalName}`, `{date}`, `{time}`, `{session}` |
| `terminalLogger.includeInput` | `true` | Whether to log user input commands |
| `terminalLogger.showStatusBar` | `true` | Show the status bar item |
| `terminalLogger.showActivationMessage` | `true` | Show a message when the extension activates |
| `terminalLogger.maxFileSizeKB` | `512` | Max size of one log file in KB. `0` means unlimited |
| `terminalLogger.overflowPolicy` | `"discard"` | When the limit is hit: `discard` drops old lines, `rotate` starts a new file |
| `terminalLogger.maxRotatedFiles` | `3` | How many rotated history files to keep |

## Log Example

```
============================================================
[2026-02-12 10:30:45] Terminal log session started
============================================================

--- [2026-02-12 10:30:47] Command: npm install ---
added 125 packages in 3s

--- [2026-02-12 10:30:52] Command: npm run compile ---
Compilation complete.
```

## How It Works

This extension uses VSCode's **Shell Integration API** (`onDidStartTerminalShellExecution` / `onDidEndTerminalShellExecution`) to monitor command execution in all IDE terminals. When a command runs, the extension:

1. Captures the command text via `execution.commandLine.value`
2. Streams the command output via `execution.read()`
3. Strips ANSI escape codes and writes timestamped lines to the log file

The MATLAB command window has no Shell Integration. Commands and output from that terminal are recorded directly from terminal data, instead of waiting for a command-start event that never arrives.

## License

MIT
