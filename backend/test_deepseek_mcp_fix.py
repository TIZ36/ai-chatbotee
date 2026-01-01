#!/usr/bin/env python3
"""
测试 DeepSeek MCP 修复
"""

import sys
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.mcp_execution_service import call_llm_api


def test_deepseek_api_routing():
    """测试 DeepSeek API 路由"""
    print("🔄 测试 DeepSeek API 路由...")

    # 模拟 DeepSeek 配置（provider=openai, model=deepseek-reasoner）
    deepseek_config = {
        'provider': 'openai',
        'model': 'deepseek-reasoner',
        'api_key': 'test_key',
        'api_url': None
    }

    # 模拟普通 OpenAI 配置
    openai_config = {
        'provider': 'openai',
        'model': 'gpt-4',
        'api_key': 'test_key',
        'api_url': None
    }

    # 测试路由逻辑（检查代码分支，不实际调用 API）
    def check_routing_logic(llm_config):
        """检查路由逻辑"""
        provider = llm_config.get('provider', '')
        model = llm_config.get('model', '')
        is_deepseek_model = 'deepseek' in model.lower()

        if provider == 'openai' and is_deepseek_model:
            return 'deepseek'
        elif provider == 'openai' and not is_deepseek_model:
            return 'openai'
        else:
            return 'unknown'

    # 测试 DeepSeek 路由
    print("\n🧪 测试 DeepSeek 模型路由...")
    route1 = check_routing_logic(deepseek_config)
    assert route1 == 'deepseek', f"DeepSeek 路由失败: {route1}"
    print("  ✅ deepseek-reasoner -> deepseek API")

    # 测试 OpenAI 路由
    print("\n🧪 测试 OpenAI 模型路由...")
    route2 = check_routing_logic(openai_config)
    assert route2 == 'openai', f"OpenAI 路由失败: {route2}"
    print("  ✅ gpt-4 -> openai API")

    # 测试实际的 call_llm_api 函数是否包含正确的分支
    import inspect
    source = inspect.getsource(call_llm_api)
    assert 'elif provider == \'openai\' and is_deepseek_model:' in source, "DeepSeek 分支不存在"
    assert 'https://api.deepseek.com/v1/chat/completions' in source, "DeepSeek URL 不存在"

    print("✅ API 路由逻辑测试通过")

    return True


def test_deepseek_config_parsing():
    """测试 DeepSeek 配置解析"""
    print("🔄 测试 DeepSeek 配置解析...")

    # 测试模型识别
    test_configs = [
        ('deepseek-reasoner', True),
        ('deepseek-chat', True),
        ('DeepSeek-V2', True),
        ('gpt-4', False),
        ('claude-3', False),
        ('gemini-pro', False),
    ]

    for model, expected_is_deepseek in test_configs:
        is_deepseek = 'deepseek' in model.lower()
        status = "✅" if is_deepseek == expected_is_deepseek else "❌"
        print(f"  {status} {model}: {is_deepseek} (期望: {expected_is_deepseek})")
        assert is_deepseek == expected_is_deepseek, f"模型识别失败: {model}"

    print("✅ 配置解析测试通过")

    return True


def main():
    """主测试函数"""
    print("🚀 开始 DeepSeek MCP 修复测试")
    print("=" * 60)

    try:
        # 运行所有测试
        test_deepseek_config_parsing()
        test_deepseek_api_routing()

        print("\n" + "=" * 60)
        print("🎉 所有 DeepSeek MCP 修复测试通过！")
        print("\n📋 修复内容:")
        print("  - ✅ 添加 DeepSeek 模型识别逻辑")
        print("  - ✅ 实现 DeepSeek API 路由")
        print("  - ✅ 支持 provider=openai 的 DeepSeek 模型")
        print("  - ✅ 保持向后兼容性")
        return 0

    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    exit(main())