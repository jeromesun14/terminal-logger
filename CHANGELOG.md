# Terminal Logger - VSCode 终端日志记录插件

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
