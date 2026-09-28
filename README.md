# Terminal Logger

[English](README_en.md) | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=jeromesun.terminal-logger)

一个 VSCode 扩展，利用 **Shell Integration API**（VSCode 1.93+）自动记录 IDE 终端的命令及输出到日志文件，无需创建特殊终端。

## 功能特性

- **自动记录终端输出** — 所有 IDE 终端中执行的命令及输出自动记录到日志文件
- **时间戳支持** — 每行日志自动添加时间戳 `[2026-02-12 10:30:45]`
- **多终端支持** — 每个终端独立记录，日志文件自动命名
- **状态栏显示** — 实时显示记录状态和终端数量
- **可配置路径** — 自定义日志保存位置

## 前提条件

- VSCode **1.93.0** 或更高版本
- 终端 Shell Integration 已启用（默认已启用）

## 安装

### 从 VSIX 文件安装

```bash
code --install-extension terminal-logger-1.0.1.vsix
```

### 从源码构建

```bash
npm install
npm run compile
npx vsce package
```

## 使用方法

1. 安装扩展后，日志记录自动对所有终端生效。
2. 在 VSCode 中打开任意终端，正常执行命令即可。
3. 使用命令面板 (`Cmd+Shift+P`) 执行 `Terminal Logger: 打开日志文件夹` 查看日志文件。

## 命令

| 命令 | 说明 |
|------|------|
| `Terminal Logger: 开启/关闭日志记录` | 切换日志记录状态 |
| `Terminal Logger: 打开日志文件夹` | 在系统文件管理器中打开日志目录 |
| `Terminal Logger: 清空当前日志` | 清空指定日志文件 |
| `Terminal Logger: 新建日志终端` | 新建由插件自建 PTY 的终端，用于 Remote SSH 等拿不到终端数据的环境 |

## 配置选项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `terminalLogger.enabled` | `true` | 是否启用终端日志记录 |
| `terminalLogger.logPath` | `""` | 日志文件保存路径（留空使用工作区 `.terminal-logs` 目录） |
| `terminalLogger.timestampFormat` | `"[YYYY-MM-DD HH:mm:ss]"` | 时间戳格式 |
| `terminalLogger.fileNamePattern` | `"terminal_{terminalName}_{date}_{time}_{session}.log"` | 日志文件名模式，支持 `{terminalName}`、`{date}`、`{time}`、`{session}` |
| `terminalLogger.includeInput` | `true` | 是否记录用户输入命令 |
| `terminalLogger.showStatusBar` | `true` | 是否在状态栏显示「终端日志: x 个终端」 |
| `terminalLogger.showActivationMessage` | `true` | 扩展激活时是否显示提示消息 |
| `terminalLogger.maxFileSizeKB` | `512` | 单个日志文件大小上限（KB），`0` 表示不限制 |
| `terminalLogger.overflowPolicy` | `"discard"` | 超过上限时 `discard` 丢弃旧内容，或 `rotate` 轮转新文件 |
| `terminalLogger.maxRotatedFiles` | `3` | 轮转时保留的历史文件数量 |

## 日志示例

```
============================================================
[2026-02-12 10:30:45] 终端日志会话开始
============================================================

--- [2026-02-12 10:30:47] 命令: npm install ---
added 125 packages in 3s

--- [2026-02-12 10:30:52] 命令: npm run compile ---
Compilation complete.
```

## 工作原理

本扩展使用 VSCode 的 **Shell Integration API**（`onDidStartTerminalShellExecution` / `onDidEndTerminalShellExecution`）监听所有 IDE 终端中的命令执行。当命令运行时：

1. 通过 `execution.commandLine.value` 捕获命令文本
2. 通过 `execution.read()` 流式读取命令输出
3. 清除 ANSI 转义码后，带时间戳写入日志文件

Shell Integration 拿不到输出时（例如部分 Remote SSH 环境 `read()` 恒为空），会用 `onDidWriteTerminalData` 补上原始终端数据。该 API 属于 proposed API，未授权时会直接抛错，扩展只把它当作可选增强。

两条通道都不可用时，扩展会主动提示，此时可执行 `Terminal Logger: 新建日志终端`：该终端的 PTY 由插件自己创建（Linux / macOS 走 python3 + `pty.openpty()` 桥接，Windows 走 pipe 直连），输入与输出不经过 IDE 的捕获通道，因此在任何环境下都能完整记录，并自动沿用 `terminal.integrated.defaultProfile` 指定的 shell（bash / zsh / fish / PowerShell / cmd）。

## License

MIT
