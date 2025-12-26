#!/bin/bash

# Nginx 一键配置脚本
# 用于配置反向代理，提升局域网访问性能

# 注意：不使用 set -e，因为我们需要手动处理错误

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息（使用 printf 避免某些 shell 的 echo -e 问题）
print_info() {
    printf "${BLUE}[INFO]${NC} %s\n" "$1"
}

print_success() {
    printf "${GREEN}[SUCCESS]${NC} %s\n" "$1"
}

print_warning() {
    printf "${YELLOW}[WARNING]${NC} %s\n" "$1"
}

print_error() {
    printf "${RED}[ERROR]${NC} %s\n" "$1"
}

# 检查是否为 root 或 sudo
check_sudo() {
    if [ "$EUID" -ne 0 ]; then
        print_error "此脚本需要 root 权限，请使用 sudo 运行"
        exit 1
    fi
}

# 检测 Linux 发行版
detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO=$ID
    else
        print_error "无法检测 Linux 发行版"
        exit 1
    fi
}

# 检查并安装 Nginx
install_nginx() {
    # 检查 Nginx 是否真的可用（不仅检查命令，还检查是否能运行）
    if command -v nginx &> /dev/null; then
        # 尝试获取版本信息，如果失败说明 Nginx 可能没有正确安装
        if nginx -v &> /dev/null 2>&1; then
            NGINX_VERSION=$(nginx -v 2>&1 | head -n 1)
            print_info "Nginx 已安装: $NGINX_VERSION"
            return 0
        else
            print_warning "检测到 nginx 命令但无法运行，将重新安装..."
        fi
    fi
    
    # 检查 Nginx 服务是否存在
    if systemctl list-unit-files | grep -q nginx.service; then
        print_info "检测到 Nginx 服务，但命令不可用，将重新安装..."
    fi
    
    print_info "正在安装 Nginx..."
    
    case $DISTRO in
        ubuntu|debian)
            apt update
            apt install -y nginx
            ;;
        centos|rhel|fedora)
            if command -v dnf &> /dev/null; then
                dnf install -y nginx
            elif command -v yum &> /dev/null; then
                yum install -y nginx
            fi
            ;;
        *)
            print_error "不支持的 Linux 发行版: $DISTRO"
            print_info "请手动安装 Nginx: https://nginx.org/en/linux_packages.html"
            exit 1
            ;;
    esac
    
    # 验证安装
    print_info "等待安装完成..."
    sleep 3  # 等待安装完成
    
    # 检查 nginx 命令是否可用
    if ! command -v nginx &> /dev/null; then
        print_error "Nginx 安装后命令仍不可用"
        print_info "尝试刷新 PATH..."
        hash -r  # 刷新命令缓存
        sleep 1
    fi
    
    # 再次检查并验证
    if command -v nginx &> /dev/null; then
        # 尝试运行 nginx -v 验证
        if NGINX_VERSION=$(nginx -v 2>&1); then
            NGINX_VERSION=$(echo "$NGINX_VERSION" | head -n 1)
            print_success "Nginx 安装成功: $NGINX_VERSION"
        else
            print_warning "Nginx 命令可用，但无法获取版本信息"
        fi
        
        # 确保 Nginx 服务已启动
        if systemctl list-unit-files 2>/dev/null | grep -q nginx.service; then
            if ! systemctl is-active --quiet nginx 2>/dev/null; then
                print_info "启动 Nginx 服务..."
                systemctl start nginx || print_warning "启动 Nginx 服务失败，可能需要手动启动"
            fi
            systemctl enable nginx 2>/dev/null || true
        fi
    else
        print_error "Nginx 安装失败，命令不可用"
        print_info "可以尝试手动安装:"
        case $DISTRO in
            ubuntu|debian)
                printf "  sudo apt update && sudo apt install -y nginx\n"
                ;;
            centos|rhel|fedora)
                printf "  sudo yum install -y nginx  # 或 sudo dnf install -y nginx\n"
                ;;
        esac
        exit 1
    fi
}

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_CONF_SOURCE="$SCRIPT_DIR/nginx.conf.example"
NGINX_CONF_NAME="ai-chatbotee"
NGINX_SITES_AVAILABLE="/etc/nginx/sites-available"
NGINX_SITES_ENABLED="/etc/nginx/sites-enabled"

# 检查配置文件是否存在
if [ ! -f "$NGINX_CONF_SOURCE" ]; then
    print_error "配置文件不存在: $NGINX_CONF_SOURCE"
    exit 1
fi

# 主函数
main() {
    print_info "开始配置 Nginx 反向代理..."
    echo ""
    
    # 检查权限
    check_sudo
    
    # 检测发行版
    detect_distro
    print_info "检测到 Linux 发行版: $DISTRO"
    echo ""
    
    # 安装 Nginx
    install_nginx
    echo ""
    
    # 创建配置目录（如果不存在）
    mkdir -p "$NGINX_SITES_AVAILABLE"
    mkdir -p "$NGINX_SITES_ENABLED"
    
    # 备份现有配置（如果存在）
    NGINX_CONF_TARGET="$NGINX_SITES_AVAILABLE/$NGINX_CONF_NAME"
    if [ -f "$NGINX_CONF_TARGET" ]; then
        BACKUP_FILE="${NGINX_CONF_TARGET}.backup.$(date +%Y%m%d_%H%M%S)"
        print_warning "配置文件已存在，正在备份到: $BACKUP_FILE"
        cp "$NGINX_CONF_TARGET" "$BACKUP_FILE"
    fi
    
    # 复制配置文件
    print_info "复制配置文件到 $NGINX_CONF_TARGET"
    cp "$NGINX_CONF_SOURCE" "$NGINX_CONF_TARGET"
    
    # 获取服务器 IP 地址（用于提示）
    SERVER_IP=$(hostname -I | awk '{print $1}')
    if [ -z "$SERVER_IP" ]; then
        SERVER_IP="localhost"
    fi
    
    # 询问是否要修改 server_name
    echo ""
    read -p "是否要设置 server_name？(留空使用默认 _，或输入域名/IP): " SERVER_NAME
    
    if [ -n "$SERVER_NAME" ] && [ "$SERVER_NAME" != "_" ]; then
        print_info "设置 server_name 为: $SERVER_NAME"
        sed -i "s/server_name _;/server_name $SERVER_NAME;/" "$NGINX_CONF_TARGET"
    else
        print_info "使用默认 server_name: _"
    fi
    
    # 创建符号链接
    SYMLINK_TARGET="$NGINX_SITES_ENABLED/$NGINX_CONF_NAME"
    if [ -L "$SYMLINK_TARGET" ]; then
        print_info "符号链接已存在，跳过创建"
    else
        print_info "创建符号链接: $SYMLINK_TARGET"
        ln -s "$NGINX_CONF_TARGET" "$SYMLINK_TARGET"
    fi
    
    # 测试配置
    echo ""
    print_info "测试 Nginx 配置..."
    
    # 检查 nginx 命令是否真的可用
    if ! command -v nginx &> /dev/null; then
        print_error "nginx 命令不可用，请确保 Nginx 已正确安装"
        print_info "尝试重新安装 Nginx..."
        install_nginx
    fi
    
    # 执行配置测试
    if nginx -t 2>&1; then
        TEST_RESULT=$?
        if [ $TEST_RESULT -eq 0 ]; then
            print_success "Nginx 配置测试通过"
        else
            print_error "Nginx 配置测试失败，请检查配置文件"
            print_info "查看详细错误信息: sudo nginx -t"
            exit 1
        fi
    else
        TEST_RESULT=$?
        print_error "Nginx 配置测试失败 (退出码: $TEST_RESULT)"
        print_info "查看详细错误信息: sudo nginx -t"
        exit 1
    fi
    
    # 重载 Nginx
    echo ""
    print_info "重载 Nginx 配置..."
    systemctl reload nginx
    
    # 确保 Nginx 正在运行
    if systemctl is-active --quiet nginx; then
        print_success "Nginx 正在运行"
    else
        print_warning "启动 Nginx 服务..."
        systemctl start nginx
        systemctl enable nginx
    fi
    
    # 显示配置信息
    echo ""
    print_success "Nginx 配置完成！"
    echo ""
    echo "=========================================="
    echo "配置信息："
    echo "=========================================="
    echo "配置文件: $NGINX_CONF_TARGET"
    echo "符号链接: $SYMLINK_TARGET"
    echo ""
    echo "访问地址："
    if [ -n "$SERVER_NAME" ] && [ "$SERVER_NAME" != "_" ]; then
        echo "  - http://$SERVER_NAME/"
    else
        echo "  - http://$SERVER_IP/"
        echo "  - http://localhost/"
    fi
    echo ""
    echo "前端开发服务器: http://localhost:5177"
    echo "后端 API: http://localhost:3002"
    echo ""
    echo "注意："
    echo "1. 确保前端开发服务器运行在 localhost:5177"
    echo "2. 确保后端服务运行在 localhost:3002"
    echo "3. 如果使用反向代理，建议在前端 .env 中设置: VITE_BACKEND_URL="
    echo "4. 查看 Nginx 日志: sudo tail -f /var/log/nginx/error.log"
    echo "=========================================="
    echo ""
    
    # 检查防火墙
    if command -v ufw &> /dev/null; then
        if ufw status | grep -q "Status: active"; then
            print_warning "检测到 UFW 防火墙，可能需要开放 80 端口:"
            echo "  sudo ufw allow 80/tcp"
        fi
    elif command -v firewall-cmd &> /dev/null; then
        if firewall-cmd --state &> /dev/null; then
            print_warning "检测到 firewalld，可能需要开放 80 端口:"
            echo "  sudo firewall-cmd --permanent --add-service=http"
            echo "  sudo firewall-cmd --reload"
        fi
    fi
}

# 运行主函数
main

