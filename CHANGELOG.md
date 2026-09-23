# Terminal Logger - VSCode 终端日志记录插件

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
