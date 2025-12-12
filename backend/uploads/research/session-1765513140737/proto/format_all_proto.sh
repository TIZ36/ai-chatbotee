#!/bin/bash

# 批量格式化所有 proto 文件
echo "🚀 开始格式化 proto 文件..."

# 查找并格式化所有 .proto 文件，排除 third 和 optx 文件夹
find . -name "*.proto" -type f -not -path "*/third/*" -not -path "*/optx/*" | while read -r file; do
    echo "📝 格式化: $file"
    python3 "$(dirname "$0")/format_proto.py" "$file"
done

echo "✅ 全部格式化完成！" 