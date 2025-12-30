#!/bin/bash
# Redis设置密码脚本

echo "设置Redis密码为: 123456"
redis-cli CONFIG SET requirepass "123456"
echo "✅ Redis密码已设置"
echo ""
echo "⚠️  注意: 这个设置是临时的，Redis重启后会丢失"
echo "   要永久设置，请编辑Redis配置文件 redis.conf，添加:"
echo "   requirepass 123456"
echo ""
echo "   然后重启Redis服务"
