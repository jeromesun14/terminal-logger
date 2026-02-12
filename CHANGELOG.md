# Terminal Logger - VSCode 终端日志记录插件

## 功能

- **自动记录终端输出**：所有终端输出自动记录到日志文件
- **时间戳支持**：每行日志自动添加时间戳 `[2026-02-12 10:30:45]`
- **多终端支持**：每个终端独立记录，日志文件自动命名
- **状态栏显示**：实时显示记录状态和终端数量
- **可配置路径**：自定义日志保存位置

## 使用方法

### 1. 安装依赖

```bash
npm install
```

### 2. 编译

```bash
npm run compile
```

### 3. 调试/安装

- **调试**：在 VSCode 中按 F5 启动调试
- **打包**：使用 `vsce package` 打包为 .vsix 文件
- **安装**：`code --install-extension terminal-logger-1.0.0.vsix`

## 命令

| 命令 | 说明 |
|------|------|
| `Terminal Logger: 创建日志终端` | 创建一个新的日志记录终端 |
| `Terminal Logger: 开启/关闭日志记录` | 切换日志记录状态 |
| `Terminal Logger: 打开日志文件夹` | 在系统文件管理器中打开日志目录 |
| `Terminal Logger: 清空当前日志` | 清空指定日志文件 |

## 配置项

在 `settings.json` 中配置：

```json
{
  // 是否启用终端日志记录
  "terminalLogger.enabled": true,
  
  // 日志文件保存路径（留空使用工作区 .terminal-logs 目录）
  "terminalLogger.logPath": "",
  
  // 时间戳格式
  "terminalLogger.timestampFormat": "[YYYY-MM-DD HH:mm:ss]",
  
  // 日志文件名模式
  "terminalLogger.fileNamePattern": "terminal_{terminalName}_{date}.log",
  
  // 是否记录用户输入命令
  "terminalLogger.includeInput": true
}
```

## 日志示例

```
============================================================
[2026-02-12 10:30:45] 终端日志会话开始
============================================================

[2026-02-12 10:30:45] Welcome to zsh!
[2026-02-12 10:30:45] 
[2026-02-12 10:30:47] $ npm install
[2026-02-12 10:30:50] added 125 packages in 3s
[2026-02-12 10:30:52] $ npm run compile
[2026-02-12 10:30:55] Compilation complete.
```

## 注意事项

- 由于 VSCode API 限制，需要使用**专用的日志终端**才能捕获输出
- 普通终端无法被捕获，请使用命令 `Terminal Logger: 创建日志终端` 创建可记录的终端
- 日志文件默认保存在工作区的 `.terminal-logs` 目录下
