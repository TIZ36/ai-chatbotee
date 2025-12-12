#!/usr/bin/env python3
"""
极简 Proto 格式化工具 - 只对齐等号
"""
import sys

def format_proto_file(file_path: str):
    try:
        # 读取文件
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        result = []
        inside_message = False
        inside_enum = False
        message_lines = []
        enum_lines = []
        
        for line in lines:
            stripped = line.strip()
            
            # 检测 message 开始
            if stripped.startswith('message ') and '{' in stripped:
                inside_message = True
                result.append(line)
                continue
            
            # 检测 enum 开始（允许 { 前有空格）
            if stripped.startswith('enum ') and '{' in stripped:
                inside_enum = True
                result.append(line)
                continue
            
            # 检测 enum 结束
            if stripped == '}' and inside_enum:
                # 处理收集的 enum 行
                if enum_lines:
                    aligned_lines = align_simple(enum_lines)
                    result.extend(aligned_lines)
                    enum_lines = []
                result.append(line)
                inside_enum = False
                continue
            
            # 检测 message 结束
            if stripped == '}' and inside_message:
                # 处理收集的 message 行
                if message_lines:
                    aligned_lines = align_simple(message_lines)
                    result.extend(aligned_lines)
                    message_lines = []
                result.append(line)
                inside_message = False
                continue
            
            # 收集 message 或 enum 内的行
            if inside_enum:
                enum_lines.append(line)
            elif inside_message:
                message_lines.append(line)
            else:
                result.append(line)
        
        # 写回文件
        with open(file_path, 'w', encoding='utf-8') as f:
            f.writelines(result)
        
        print(f"✅ 格式化完成: {file_path}")
        
    except Exception as e:
        print(f"❌ 错误: {e}")

def align_simple(lines):
    """简单对齐，只处理包含 = 的行"""
    field_lines = []
    other_lines = []
    
    # 分离字段行和其他行
    for i, line in enumerate(lines):
        stripped = line.strip()
        if ('=' in line and 
            not stripped.startswith('//') and 
            not stripped.startswith('option') and
            stripped):
            field_lines.append((i, line))
        else:
            other_lines.append((i, line))
    
    if not field_lines:
        return lines
    
    # 解析字段信息
    parsed_fields = []
    for i, line in field_lines:
        try:
            # 找到等号位置
            eq_pos = line.find('=')
            if eq_pos == -1:
                continue
                
            before_eq = line[:eq_pos].rstrip()
            after_eq = line[eq_pos+1:].lstrip()
            
            # 提取缩进
            indent = ''
            j = 0
            while j < len(line) and line[j] in ' \t':
                indent += line[j]
                j += 1
            
            # 提取类型和字段名
            before_parts = before_eq.strip().split()
            
            # 处理 enum 值（只有名称，没有类型）或 message 字段（有类型和名称）
            if len(before_parts) == 1:
                # enum 值格式：EnumName_Value = number;
                field_name = before_parts[0]
                type_part = ''
            elif len(before_parts) >= 2:
                # message 字段格式：type field_name = number;
                field_name = before_parts[-1]
                type_part = ' '.join(before_parts[:-1])
            else:
                continue
            
            parsed_fields.append((i, indent, type_part, field_name, after_eq))
        except:
            continue
    
    if not parsed_fields:
        return lines
    
    # 计算对齐宽度
    max_type_len = max(len(pf[2]) for pf in parsed_fields) if any(pf[2] for pf in parsed_fields) else 0
    max_name_len = max(len(pf[3]) for pf in parsed_fields)
    
    # 生成结果
    result = list(lines)
    
    for line_idx, indent, type_part, field_name, after_eq in parsed_fields:
        if type_part:
            # message 字段格式
            new_line = f"{indent}{type_part:<{max_type_len}} {field_name:<{max_name_len}} = {after_eq}"
        else:
            # enum 值格式
            new_line = f"{indent}{field_name:<{max_name_len}} = {after_eq}"
        result[line_idx] = new_line
    
    return result

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("用法: python format_proto_fast.py <文件名>")
        sys.exit(1)
    
    format_proto_file(sys.argv[1]) 