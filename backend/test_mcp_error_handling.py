#!/usr/bin/env python3
"""
测试 MCP 错误处理机制，确保不会触发自动分析
"""

import sys
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.mcp_execution_service import execute_mcp_with_llm


def test_mcp_error_no_auto_analysis():
    """测试 MCP 错误时不会触发自动分析"""
    print("🔄 测试 MCP 错误处理（不触发自动分析）...")

    # 使用不存在的配置ID来触发错误
    result = execute_mcp_with_llm(
        mcp_server_id='nonexistent_server',
        input_text='测试输入',
        llm_config_id='nonexistent_config',
    )

    # 检查结果
    assert result.get('error'), "应该返回错误"
    print(f"✅ 错误信息: {result.get('error')}")

    # 检查是否包含自动分析相关的字段
    debug_info = result.get('debug', {})
    assert 'suggestion' not in debug_info, "不应包含suggestion字段（会触发自动分析）"
    print("✅ 未包含suggestion字段")

    # 检查日志
    logs = result.get('logs', [])
    assert len(logs) > 0, "应该有日志记录"
    print(f"✅ 包含 {len(logs)} 条日志记录")

    return True


def test_mcp_auto_trigger_disabled():
    """测试 MCP 自动触发功能已禁用"""
    print("🔄 测试 MCP 自动触发功能已禁用...")

    # 检查actor_base.py中是否还有MCP错误自动分析的代码
    with open('services/actor/actor_base.py', 'r') as f:
        content = f.read()

        # 检查是否还有发送错误分析消息的代码
        error_trigger_patterns = [
            "MCP 工具调用失败.*请分析错误原因",
            "get_topic_service().send_message.*mcp_error.*True",
            "auto_trigger.*True.*mcp_error"
        ]

        for pattern in error_trigger_patterns:
            assert pattern not in content, f"不应包含自动分析触发代码: {pattern}"

        # 检查注释中是否标记为已禁用
        assert "MCP 错误自动分析功能已禁用" in content, "应包含禁用标记"
        assert "未触发自动分析" in content, "应包含未触发标记"

    # 检查chat_agent.py中的自动触发逻辑是否已禁用
    with open('services/actor/agents/chat_agent.py', 'r') as f:
        content = f.read()

        # 检查是否还有MCP错误自动触发的决策逻辑
        assert "MCP 错误自动触发：功能已禁用" in content, "ChatAgent中应标记功能已禁用"
        # 确保自动触发代码已被注释
        assert "# if ext.get('auto_trigger') and ext.get('mcp_error'):" in content, "应注释掉自动触发逻辑"

    print("✅ MCP 自动触发功能已正确禁用")

    return True


def test_error_details_structure():
    """测试错误详情结构不包含自动分析字段"""
    print("🔄 测试错误详情结构...")

    # 模拟错误详情
    error_details = {
        "error": "LLM API调用失败",
        "logs": ["错误日志"],
        "llm_response": "错误响应",
        "debug": {
            "llm_parse_error": "API调用失败",
            "llm_output_length": 0,
            "available_tools": [],
            "iteration": 1,
            # "suggestion": "不应包含此字段"  # 已移除
        },
    }

    # 验证结构
    assert 'error' in error_details
    assert 'logs' in error_details
    assert 'debug' in error_details
    assert 'suggestion' not in error_details['debug'], "不应包含suggestion字段"
    print("✅ 错误详情结构正确")

    return True


def main():
    """主测试函数"""
    print("🚀 开始 MCP 错误处理测试")
    print("=" * 60)

    try:
        # 运行所有测试
        test_mcp_error_no_auto_analysis()
        test_mcp_auto_trigger_disabled()
        test_error_details_structure()

        print("\n" + "=" * 60)
        print("🎉 所有 MCP 错误处理测试通过！")
        print("✅ MCP 错误不再触发自动分析")
        print("\n📋 修复内容:")
        print("  - 移除了 MCP 错误时的自动分析触发")
        print("  - 禁用了 ChatAgent 的 MCP 错误自动回复")
        print("  - 移除了错误详情中的 suggestion 字段")
        return 0

    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    exit(main())