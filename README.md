# Terminal Logger

一个 VSCode 扩展，自动记录终端输出到日志文件，支持时间戳和多终端分别记录。

## 功能特性

- **自动记录终端输出** - 所有终端输出自动记录到日志文件
- **时间戳支持** - 每行日志自动添加时间戳
- **多终端支持** - 每个终端独立记录，日志文件自动命名
- **状态栏显示** - 实时显示记录状态和终端数量
- **可配置路径** - 自定义日志保存位置

## 安装

### 从 VSIX 文件安装

```bash
code --install-extension terminal-logger-1.0.0.vsix
```

### 从源码构建

```bash
npm install
npm run compile
```

## 使用方法

1. 安装扩展后，使用命令面板 (`Cmd+Shift+P`) 执行 `Terminal Logger: 创建日志终端`
2. 在新创建的终端中执行命令，所有输出将自动记录
3. 使用 `Terminal Logger: 打开日志文件夹` 查看日志文件

## 命令

| 命令 | 说明 |
|------|------|
| `Terminal Logger: 创建日志终端` | 创建一个新的日志记录终端 |
| `Terminal Logger: 开启/关闭日志记录` | 切换日志记录状态 |
| `Terminal Logger: 打开日志文件夹` | 在系统文件管理器中打开日志目录 |
| `Terminal Logger: 清空当前日志` | 清空指定日志文件 |

## 配置选项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `terminalLogger.enabled` | `true` | 是否启用终端日志记录 |
| `terminalLogger.logPath` | `""` | 日志文件保存路径（留空使用工作区 `.terminal-logs` 目录） |
| `terminalLogger.timestampFormat` | `"[YYYY-MM-DD HH:mm:ss]"` | 时间戳格式 |
| `terminalLogger.fileNamePattern` | `"terminal_{terminalName}_{date}.log"` | 日志文件名模式 |
| `terminalLogger.includeInput` | `true` | 是否记录用户输入命令 |

## 注意事项

- 由于 VSCode API 限制，需要使用**专用的日志终端**才能捕获输出
- 普通终端无法被捕获，请使用命令 `Terminal Logger: 创建日志终端` 创建可记录的终端
- 日志文件默认保存在工作区的 `.terminal-logs` 目录下

## License

MIT
