#!/usr/bin/env bash
# 打包 VSCode 扩展为 .vsix
# 用法: bash build.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 检查 Node.js
if ! command -v npx &>/dev/null; then
    echo "[ERROR] 需要 Node.js / npx，请先安装"
    exit 1
fi

# 用 vsce 打包（自动下载，无需全局安装）
echo "[1/2] 打包中..."
npx @vscode/vsce package --no-dependencies --no-git-tag-version

# 找到生成的 .vsix 文件
VSIX_FILE=$(ls -t remote-qt-designer-*.vsix 2>/dev/null | head -1)
if [ -z "$VSIX_FILE" ]; then
    echo "[ERROR] 未找到生成的 .vsix 文件"
    exit 1
fi

echo ""
echo "[2/2] 打包完成: $SCRIPT_DIR/$VSIX_FILE"
echo ""
echo "安装方式："
echo "  code --install-extension $VSIX_FILE"
echo "  或 VSCode 命令面板 → 'Extensions: Install from VSIX'"
