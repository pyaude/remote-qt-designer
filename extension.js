const vscode = require('vscode');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

let outputChannel;

function activate(context) {
    outputChannel = vscode.window.createOutputChannel("Remote Qt Designer");
    context.subscriptions.push(outputChannel);

    const disposable = vscode.commands.registerCommand('qtDesigner.open', async function (uri) {
        const config = vscode.workspace.getConfiguration('qtDesigner');

        // 解析 .ui 文件路径
        let filePath = uri ? uri.fsPath : null;
        if (!filePath && vscode.window.activeTextEditor) {
            filePath = vscode.window.activeTextEditor.document.uri.fsPath;
        }

        if (!filePath || !filePath.endsWith('.ui')) {
            vscode.window.showErrorMessage('请选择一个 .ui 文件');
            return;
        }

        outputChannel.show(true);
        outputChannel.appendLine(`[INFO] 文件: ${filePath}`);

        // 确定执行模式
        let mode = config.get('executionMode') || 'auto';
        if (mode === 'auto') {
            mode = await detectMode(config);
            outputChannel.appendLine(`[INFO] 自动检测 → ${mode} 模式`);
        }

        if (mode === 'docker') {
            await launchDocker(config, filePath);
        } else {
            await launchNative(config, filePath);
        }
    });

    context.subscriptions.push(disposable);
}

// ─── 自动检测：Docker 容器在运行则用 Docker，否则用 Native ───
function detectMode(config) {
    const containerName = config.get('dockerContainerName') || 'litho-zero-qt-dev-1';
    return new Promise((resolve) => {
        exec(`docker inspect -f "{{.State.Running}}" ${containerName} 2>/dev/null`, (err, stdout) => {
            if (!err && stdout && stdout.toString().trim() === 'true') {
                resolve('docker');
            } else {
                resolve('native');
            }
        });
    });
}

// ─── 获取 DISPLAY（优先用配置覆盖值，其次自动检测 WSLg）───
function getDisplay(config) {
    const override = config.get('display');
    if (override) return override;
    if (process.env.DISPLAY) return process.env.DISPLAY;

    // WSLg 自动检测：VSCode Server 启动时往往未继承 DISPLAY，
    // 但 WSLg 已在 /tmp/.X11-unix/X0 提供 X server。
    if (fs.existsSync('/tmp/.X11-unix/X0')) {
        outputChannel.appendLine('[INFO] 检测到 WSLg X11 socket (/tmp/.X11-unix/X0)，自动使用 DISPLAY=:0');
        return ':0';
    }
    return '';
}

// ─── 获取 Docker 模式 DISPLAY（优先 dockerDisplay 配置，macOS/XQuartz 自动映射 host.docker.internal）───
function getDockerDisplay(config) {
    const override = config.get('dockerDisplay');
    if (override) return override;

    // macOS + XQuartz：容器内无法使用宿主机 launchd socket 形式的 DISPLAY
    // （如 /private/tmp/.../org.macosforge.xquartz:0），需改用 host.docker.internal:<显示号>。
    // 显示号从环境变量 DISPLAY 末尾提取（XQuartz 重启后可能从 :0 变为 :1），提取不到则默认 0。
    if (process.platform === 'darwin') {
        const m = (process.env.DISPLAY || '').match(/:(\d+)(?:\.\d+)?$/);
        const display = `host.docker.internal:${m ? m[1] : '0'}`;
        outputChannel.appendLine(`[INFO] macOS + XQuartz 自动映射 DISPLAY=${display}`);
        return display;
    }

    return getDisplay(config) || ':0';
}

// ─── 检测 WSLg 环境 ───
function isWslg() {
    return fs.existsSync('/mnt/wslg/runtime-dir/wayland-0');
}

// ─── 补齐 WSLg 相关环境变量（Wayland / XDG_RUNTIME_DIR / PULSE）───
function patchWslgEnv(env) {
    if (!isWslg()) return;
    if (!env.WAYLAND_DISPLAY) env.WAYLAND_DISPLAY = 'wayland-0';
    // WSLg 的 runtime 目录里有 wayland-0 socket
    if (!env.XDG_RUNTIME_DIR || !fs.existsSync(path.join(env.XDG_RUNTIME_DIR, 'wayland-0'))) {
        env.XDG_RUNTIME_DIR = '/mnt/wslg/runtime-dir';
    }
    if (!env.PULSE_SERVER) env.PULSE_SERVER = '/mnt/wslg/PulseServer';
}

// ─── Native 模式：直接在宿主机运行 Designer ───
async function launchNative(config, filePath) {
    const designerPath = config.get('nativeDesignerPath') || '/opt/qt/5.14.2/gcc_64/bin/designer';

    if (!fs.existsSync(designerPath)) {
        const msg = `Qt Designer 未找到: ${designerPath}`;
        outputChannel.appendLine(`[ERROR] ${msg}`);
        vscode.window.showErrorMessage(msg);
        return;
    }

    const display = getDisplay(config);
    outputChannel.appendLine(`[INFO] Native 模式 | DISPLAY=${display || '(未设置)'}`);

    if (!display) {
        const wslgAvailable = fs.existsSync('/mnt/wslg');
        const msg = wslgAvailable
            ? 'DISPLAY 未设置且未找到 WSLg X11 socket。请在设置中配置 qtDesigner.display（例如 ":0"）'
            : 'DISPLAY 未设置。请启用 SSH X11 转发 (ssh -X) 或 WSLg，或在设置中配置 qtDesigner.display';
        outputChannel.appendLine(`[WARN] ${msg}`);
        const choice = await vscode.window.showWarningMessage(msg, '查看帮助');
        if (choice === '查看帮助') {
            outputChannel.appendLine('');
            outputChannel.appendLine('=== 如何让 GUI 程序显示 ===');
            outputChannel.appendLine('[场景 A] WSL2 (Windows 11+)：');
            outputChannel.appendLine('  · WSLg 默认提供 X server，DISPLAY 应为 :0');
            outputChannel.appendLine('  · 若 /tmp/.X11-unix/X0 不存在，检查 .wslconfig 是否禁用了 WSLg');
            outputChannel.appendLine('  · 或直接在设置中填 qtDesigner.display = ":0"');
            outputChannel.appendLine('[场景 B] SSH 远程开发：');
            outputChannel.appendLine('  1. 本地电脑安装 X Server（Windows: VcXsrv/MobaXterm，macOS: XQuartz）');
            outputChannel.appendLine('  2. SSH 连接时加 -X 参数: ssh -X user@host');
            outputChannel.appendLine('  3. 或在 VSCode settings.json 中设置:');
            outputChannel.appendLine('     "terminal.integrated.env.linux": { "DISPLAY": ":10.0" }');
        }
        return;
    }

    // 设置环境变量
    const env = { ...process.env };
    env.DISPLAY = display;
    // WSLg 环境下补齐 WAYLAND_DISPLAY / XDG_RUNTIME_DIR / PULSE_SERVER
    patchWslgEnv(env);

    // 确保 Qt 库在 LD_LIBRARY_PATH 中
    const qtLibPath = path.join(path.dirname(path.dirname(designerPath)), 'lib');
    const existingLdPath = env.LD_LIBRARY_PATH || '';
    if (fs.existsSync(qtLibPath) && !existingLdPath.includes(qtLibPath)) {
        env.LD_LIBRARY_PATH = `${qtLibPath}:${existingLdPath}`;
        outputChannel.appendLine(`[INFO] LD_LIBRARY_PATH += ${qtLibPath}`);
    }

    outputChannel.appendLine(`[INFO] 启动: ${designerPath} "${filePath}"`);

    const child = spawn(designerPath, [filePath], { detached: true, env, stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.on('data', (data) => {
        const line = data.toString().trim();
        if (line) outputChannel.appendLine(`[STDOUT] ${line}`);
    });
    child.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line) outputChannel.appendLine(`[STDERR] ${line}`);
    });
    child.on('error', (err) => {
        outputChannel.appendLine(`[ERROR] ${err.message}`);
        vscode.window.showErrorMessage(`Qt Designer 启动失败: ${err.message}`);
    });
    child.on('close', (code) => {
        outputChannel.appendLine(`[INFO] 进程退出，code=${code}`);
    });
    child.unref();
}

// ─── Docker 模式：在容器内运行 Designer ───
async function launchDocker(config, filePath) {
    const containerName = config.get('dockerContainerName') || 'litho-zero-qt-dev-1';
    let targetWorkspacePath = config.get('dockerWorkspacePath') || '/workspace';
    const designerCommand = config.get('dockerDesignerPath') || 'designer';

    if (targetWorkspacePath.endsWith('/')) {
        targetWorkspacePath = targetWorkspacePath.slice(0, -1);
    }

    // 宿主机路径 → 容器内路径映射
    let dockerPath = filePath;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    if (workspaceFolder) {
        const wsPath = workspaceFolder.uri.fsPath;
        if (filePath.startsWith(wsPath)) {
            dockerPath = targetWorkspacePath + filePath.substring(wsPath.length);
            outputChannel.appendLine(`[INFO] 容器内路径: ${dockerPath}`);
        } else {
            outputChannel.appendLine(`[WARN] 文件路径不在工作区根目录下，使用原路径`);
        }
    }

    const display = getDockerDisplay(config);
    const waylandDisplay = process.env.WAYLAND_DISPLAY || 'wayland-0';
    outputChannel.appendLine(`[INFO] Docker 模式 | DISPLAY=${display} | WAYLAND=${waylandDisplay}`);

    function spawnDesigner() {
        const args = [
            'exec',
            '-e', `DISPLAY=${display}`,
            '-e', `WAYLAND_DISPLAY=${waylandDisplay}`,
            '-e', 'XDG_RUNTIME_DIR=/mnt/wslg',
            containerName,
            designerCommand,
            dockerPath
        ];

        outputChannel.appendLine(`[INFO] 启动: docker ${args.join(' ')}`);

        const child = spawn('docker', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });

        child.stdout.on('data', (data) => {
            const line = data.toString().trim();
            if (line) outputChannel.appendLine(`[STDOUT] ${line}`);
        });
        child.stderr.on('data', (data) => {
            const line = data.toString().trim();
            if (line) outputChannel.appendLine(`[STDERR] ${line}`);
        });
        child.on('error', (err) => {
            outputChannel.appendLine(`[ERROR] ${err.message}`);
            vscode.window.showErrorMessage(`Qt Designer 启动失败: ${err.message}`);
        });
        child.on('close', (code) => {
            outputChannel.appendLine(`[INFO] 进程退出，code=${code}`);
        });
        child.unref();
    }

    // 检查容器是否在运行，未运行则尝试启动
    outputChannel.appendLine(`[INFO] 检查容器 '${containerName}' ...`);
    exec(`docker inspect -f "{{.State.Running}}" ${containerName} 2>/dev/null`, (err, stdout) => {
        const isRunning = stdout && stdout.toString().trim() === 'true';
        if (isRunning) {
            outputChannel.appendLine(`[INFO] 容器已在运行`);
            spawnDesigner();
        } else {
            outputChannel.appendLine(`[INFO] 容器未运行，尝试启动...`);
            const wsPath = workspaceFolder ? workspaceFolder.uri.fsPath : '';
            const startCmd = wsPath
                ? `cd "${wsPath}" && docker compose up -d 2>&1`
                : `docker start ${containerName} 2>&1`;

            exec(startCmd, (startErr, startOut, startErrOut) => {
                if (startErr) {
                    const msg = startErrOut || startErr.message;
                    outputChannel.appendLine(`[ERROR] 容器启动失败: ${msg}`);
                    vscode.window.showErrorMessage(`容器启动失败: ${msg}`);
                    return;
                }
                outputChannel.appendLine(`[INFO] 容器已启动`);
                spawnDesigner();
            });
        }
    });
}

function deactivate() { }

module.exports = { activate, deactivate };
