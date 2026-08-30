# AGENTS.md

面向 AI 编码代理的项目指南。

## 项目简介

VSCode 扩展 **Remote Qt Designer**（`remote-qt-designer`）：右键 `.ui` 文件用 Qt Designer 打开编辑。支持两种执行模式，`auto` 下自动检测：

- **Docker 模式**：目标容器在运行 → 在容器内执行 `designer`
- **Native 模式**：宿主机直接运行 Designer（SSH X11 转发 或 WSL2/WSLg）

运行环境为 Linux（远程 Ubuntu / WSL2），GUI 通过 X11/Wayland 转发显示。

## 目录结构

项目极小，**全部逻辑在单文件 `extension.js`** 中（CommonJS，无构建步骤、无依赖、无 TypeScript）：

- `extension.js` — 扩展全部实现
- `package.json` — 扩展清单 + 配置项声明（`contributes.configuration`）
- `build.sh` — 打包脚本
- `README.md` — 用户文档（中文）
- `LICENSE` — MIT 许可证
- `icon.jpg` — 扩展图标

### extension.js 关键函数

| 函数 | 职责 |
|---|---|
| `activate` | 注册 `qtDesigner.open` 命令，解析 `.ui` 路径并分发到对应模式 |
| `detectMode` | `docker inspect` 检查容器是否在运行，决定 docker/native |
| `getDisplay` | DISPLAY 解析优先级：配置覆盖 > 环境变量 > WSLg socket 自动检测（`:0`） |
| `getDockerDisplay` | Docker 模式 DISPLAY：`dockerDisplay` 配置 > macOS/XQuartz 自动映射 `host.docker.internal:<N>`（N 取自环境变量 DISPLAY 末尾，默认 0）> 复用 `getDisplay` |
| `patchWslgEnv` | WSLg 下补齐 `WAYLAND_DISPLAY` / `XDG_RUNTIME_DIR` / `PULSE_SERVER` |
| `launchNative` | 宿主机 spawn Designer，处理 LD_LIBRARY_PATH、错误与帮助提示 |
| `launchDocker` | 路径映射（工作区 → 容器内路径），容器未运行时 `docker compose up -d` |

## 构建与验证

无测试、无 lint。验证方式即打包能否通过：

```bash
bash build.sh
# 等价于: npx @vscode/vsce package --no-dependencies --no-git-tag-version
```

安装测试：

```bash
code --install-extension remote-qt-designer-<version>.vsix
```

功能验证需在目标 Linux 环境（WSL2 或 SSH 远程 Ubuntu）中，右键 `.ui` 文件触发命令，观察输出面板 "Remote Qt Designer" 的日志。

## 修改约定

- **改代码只动 `extension.js`**：保持单文件、CommonJS、`require('vscode')` 风格，不要引入构建工具或依赖。
- **新增配置项**：需同时改 `package.json` 的 `contributes.configuration` 和 `extension.js` 中对应 `config.get(...)` 读取处，并同步更新 `README.md` 的配置表。
- **发版**：手动提升 `package.json` 的 `version` 后重新打包。
- **日志与提示用中文**：所有 `outputChannel.appendLine` 和 `showErrorMessage/showWarningMessage` 保持中文，前缀风格为 `[INFO]` / `[WARN]` / `[ERROR]`。
- **子进程风格**：Designer 进程用 `spawn(..., { detached: true, stdio: ['ignore','pipe','pipe'] })` + `child.unref()`（不阻塞 VSCode），stdout/stderr 逐行转发到输出面板；短命令（docker inspect 等）用 `exec`。
- **路径默认值**：Native Designer 默认 `/opt/qt/5.14.2/gcc_64/bin/designer`，容器名默认 `litho-zero-qt-dev-1`，容器内工作区默认 `/workspace`。改动默认值时注意三处（代码 fallback、package.json default、README）保持一致。

## 常见坑

- VSCode Server 不加载 shell profile，`process.env.DISPLAY` 常为空，这正是 `getDisplay` 做 WSLg socket 探测的原因；不要假设 DISPLAY 一定存在。
- Docker 模式下文件不在工作区根目录时无法映射容器内路径，代码中已有 `[WARN]` 分支，保持该行为。
- `package.json` 声明的 `activationEvents` 为 `onFileSystem:/**/*.ui`，改动激活时机需谨慎。
