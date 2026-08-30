# Remote Qt Designer

右键 `.ui` 文件，用 Qt Designer 打开编辑。支持 **Native Ubuntu（SSH X11 转发）** 和 **Docker** 两种开发环境，自动检测。

## 安装

```bash
# 方法 1：VSCode 命令面板
Ctrl+Shift+P → "Extensions: Install from VSIX" → 选择 .vsix 文件

# 方法 2：命令行
code --install-extension remote-qt-designer-2.1.0.vsix
```

## 使用

1. 在文件资源管理器中**右键**点击任意 `.ui` 文件
2. 选择 **"Open with Qt Designer"**
3. Qt Designer 窗口弹出（通过 X11 转发 / WSLg 显示在本地）

也可以在编辑器标签栏点击布局图标按钮打开。

## 执行模式

| 模式 | 说明 | 适用场景 |
|---|---|---|
| `auto`（默认） | 自动检测：Docker 容器在运行 → Docker 模式，否则 → Native 模式 | 日常使用 |
| `docker` | 强制在 Docker 容器内运行 Designer | Docker 开发环境 |
| `native` | 强制在宿主机本地运行 Designer | SSH 远程原生开发 |

## 配置项

在 VSCode `settings.json` 中配置：

```jsonc
{
    // 执行模式：auto / docker / native
    "qtDesigner.executionMode": "auto",

    // ── Docker 模式 ──
    "qtDesigner.dockerContainerName": "litho-zero-qt-dev-1",
    "qtDesigner.dockerWorkspacePath": "/workspace",
    "qtDesigner.dockerDesignerPath": "designer",
    // Docker 模式 DISPLAY（留空自动检测；macOS/XQuartz 自动映射 host.docker.internal:<N>，端口对不上时可显式指定）
    "qtDesigner.dockerDisplay": "",

    // ── Native 模式 ──
    "qtDesigner.nativeDesignerPath": "/opt/qt/5.14.2/gcc_64/bin/designer",

    // ── 通用 ──
    // 覆盖 DISPLAY 变量（留空时自动检测：优先环境变量，其次 WSLg 的 :0）
    "qtDesigner.display": ""
}
```

## 前置条件

### Native 模式（SSH 远程开发）

需要 SSH X11 转发，让远程的 Designer 窗口显示到本地：

**1) 本地电脑安装 X Server**

| 本地系统 | X Server |
|---|---|
| Windows | VcXsrv（免费）/ MobaXterm（自带） |
| macOS | XQuartz |
| Linux | 系统自带 |

**2) SSH 启用 X11 转发**

远程机器 `/etc/ssh/sshd_config`：
```
X11Forwarding yes
```

连接时加 `-X`：
```bash
ssh -X libing@192.168.x.x
```

**3) 验证**

```bash
echo $DISPLAY    # 应显示 localhost:10.0 之类
xclock           # 能弹出时钟说明 X11 正常
```

如果 VSCode 终端中 `$DISPLAY` 为空，在 `settings.json` 中设置：
```json
"terminal.integrated.env.linux": { "DISPLAY": ":0.0" }
```

### Native 模式（WSL2 + WSLg）

Windows 11 的 WSL2 自带 WSLg，**无需额外配置 X Server**。插件会自动检测：

- 若 `DISPLAY` 环境变量为空但 `/tmp/.X11-unix/X0` 存在 → 自动使用 `DISPLAY=:0`
- 同时补齐 `WAYLAND_DISPLAY=wayland-0`、`XDG_RUNTIME_DIR=/mnt/wslg/runtime-dir`、`PULSE_SERVER`

> **注意**：VSCode Server 启动时往往不继承 `DISPLAY`（不加载 shell profile），这正是本插件自动检测的原因。如自动检测失败，可在设置中显式指定 `"qtDesigner.display": ":0"`。

**前置条件**：在 WSL2 中通过 aqtinstall 安装 Qt 5.14.2 到 `/opt/qt/5.14.2`（项目 `Scripts/setup_native.sh` 已自动化）。

### Docker 模式

需要 Docker 容器已配置 X11/WSLg 转发（项目 `docker-compose.yml` 已配好）：

```yaml
volumes:
  - /tmp/.X11-unix:/tmp/.X11-unix
  - /mnt/wslg:/mnt/wslg
```

插件会自动检测容器是否在运行，未运行时自动 `docker compose up -d`。

### Docker 模式（macOS + XQuartz）

macOS 下容器需通过 `host.docker.internal` 访问宿主机 XQuartz：

1. XQuartz 偏好设置 → Security → 勾选 **Allow network clients**，并重启 XQuartz
2. 终端执行 `xhost +localhost` 授权本机连接
3. 显示号说明：XQuartz 重启后显示号可能从 `:0` 变为 `:1`，插件会自动从 `DISPLAY` 环境变量提取显示号并映射为 `host.docker.internal:<N>`；若仍连不上，可显式指定：

```jsonc
"qtDesigner.dockerDisplay": "host.docker.internal:1"
```

优先级：`dockerDisplay` > 自动检测（macOS 映射 `host.docker.internal:<N>`，其他平台与 Native 模式一致，含 `display` 覆盖）。

## 打包

```bash
cd .setup/qtdesigner-wslg
npx @vscode/vsce package
# 或使用打包脚本：
bash build.sh
```

## 许可证

[MIT](LICENSE)
