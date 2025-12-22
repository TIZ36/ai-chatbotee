#!/bin/bash

# Nginx 配置重载脚本
# 用于测试和重载 Nginx 配置

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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
if [ "$EUID" -ne 0 ]; then
    print_error "此脚本需要 root 权限，请使用 sudo 运行"
    exit 1
fi

# 检查 Nginx 是否安装
if ! command -v nginx &> /dev/null; then
    print_error "Nginx 未安装，请先运行 ./setup_nginx.sh"
    exit 1
fi

print_info "测试 Nginx 配置..."

# 测试配置
if nginx -t 2>&1; then
    TEST_RESULT=$?
    if [ $TEST_RESULT -eq 0 ]; then
        print_success "Nginx 配置测试通过"
        echo ""
        print_info "重载 Nginx 配置..."
        
        # 重载配置（不中断服务）
        if systemctl reload nginx 2>/dev/null; then
            print_success "Nginx 配置已重载"
        elif nginx -s reload 2>/dev/null; then
            print_success "Nginx 配置已重载"
        else
            print_warning "无法通过 systemctl 重载，尝试重启服务..."
            systemctl restart nginx
            if systemctl is-active --quiet nginx; then
                print_success "Nginx 服务已重启"
            else
                print_error "Nginx 重启失败"
                exit 1
            fi
        fi
        
        echo ""
        print_info "Nginx 状态:"
        systemctl status nginx --no-pager -l | head -n 5
    else
        print_error "Nginx 配置测试失败，请检查配置文件"
        print_info "查看详细错误信息:"
        nginx -t
        exit 1
    fi
else
    print_error "Nginx 配置测试失败"
    exit 1
fi

