# Terminal Logger - VSCode 终端日志记录插件

## [1.0.8] - 2026-10-04

### Fixed
- 修复 MATLAB 命令窗口无法记录的问题。该终端没有 Shell Integration，命令和运行结果现在会从终端数据直接写入日志；提示符清行后的短输出不会带上 `>>` 残留。PowerShell、Java 以及带 Shell Integration 的终端仍按原来的方式记录

## [1.0.7] - 2026-09-28

### Fixed
- 修复命令输出有时丢失的问题。Shell Integration 的 `read()` 只拿到一部分（甚至只有一个换行）时，不再把同一时间到达的原始终端输出整段丢掉；命令开始事件晚到、或命令已经结束后才到达的输出也会补上。本地和 Remote SSH 都会记，已经写过的行不重复。高速大量输出按行保留，回车重绘的长输出不会被当成逐字输入丢掉

## [1.0.6] - 2026-09-24

### Fixed
- 修复 v1.0.5 在 Remote SSH（Ubuntu）下仍把 bash/zsh 正在输入的命令按一个字母一行写入日志的问题。原始终端数据会先跨分片折叠退格和回车重绘，只在形成完整行后落盘；bash、zsh、PowerShell 和 cmd 的提示符不再写入。Windows、Linux、macOS 的命令输出仍会记录

## [1.0.5] - 2026-09-23

### Fixed
- 修复 v1.0.4 把正在输入的命令按一个字母一行写入日志的问题。提示符和逐字回显（含退格重绘）不再落盘；命令仍按整行记录，输出在 Shell Integration 停止推送后继续由原始终端数据补上

## [1.0.4] - 2026-09-23

### Fixed
- 修复 Remote SSH 下只有第一个终端能记录、后续终端输入和输出都丢失的问题。空的 `read()` 不再把终端永久标记为失效，也不再向终端注入 `script`（注入时会关掉日志写入，导致之后完全不记录）
- 修复连续打印时日志文件大小不增长的问题：输出到达后立即落盘；Shell Integration 停止推送后继续记录原始终端数据
- 修复多个工作区只能保存一份日志的问题：每个终端会话使用独立日志文件；日志目录按终端所在工作区选择；开关改为当前工作区配置，避免一个窗口关掉其他窗口的记录

### Added
- 新增 `terminalLogger.maxFileSizeKB`（默认 512KB）、`terminalLogger.overflowPolicy`（`discard` 丢弃旧内容 / `rotate` 轮转新文件）和 `terminalLogger.maxRotatedFiles`，避免日志无限增长
- 日志文件名支持 `{session}`，默认文件名包含时间与会话

## [1.0.3] - 2026-02-26

### Fixed
- 修复状态栏「终端日志: x 个终端」计数始终为 0 的问题，终端注册后立即更新计数

### Added
- 新增配置项 `terminalLogger.showStatusBar`：可开关状态栏显示
- 新增配置项 `terminalLogger.showActivationMessage`：可开关激活提示消息

## [1.0.2] - 2026-02-12

### Fixed
- 修复 Remote SSH 场景下只记录输入命令、未记录命令回显/输出的问题
- 新增三级 fallback 机制：Shell Integration read() → onDidWriteTerminalData → script 命令，确保各场景下均可捕获终端输出

## [1.0.1] - 2026-02-12

### Changed
- 更新插件图标，去除白边（透明背景）
- 更新 README 文档，适配 Shell Integration API 新方案
- 新增英文文档 README_en.md

## [1.0.0] - 2026-02-12

### Added
- 基于 VSCode Shell Integration API 自动记录终端命令及输出
- 时间戳支持（可自定义格式）
- 多终端独立记录，日志文件自动命名
- 状态栏实时显示记录状态
- 可配置日志路径、文件名模式等
- 命令：开启/关闭日志记录、打开日志文件夹、清空当前日志

### Changed
- 从 Pseudoterminal 方案迁移到 Shell Integration API（需要 VSCode 1.93+）
- 移除"创建日志终端"命令，改为自动监听所有 IDE 终端
