#!/usr/bin/env python3
"""
DeepSeek API 测试脚本
用于验证 DeepSeek Provider 的修复是否有效
"""

import os
import sys
import json
from typing import Dict, Any

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.providers.openai_provider import DeepSeekProvider
from services.providers.base import LLMMessage


def test_deepseek_basic():
    """测试 DeepSeek 基本功能"""
    print("🔄 测试 DeepSeek 基本功能...")

    # 检查环境变量
    api_key = os.getenv('DEEPSEEK_API_KEY')
    if not api_key:
        print("❌ 请设置 DEEPSEEK_API_KEY 环境变量")
        return False

    try:
        # 创建 Provider
        provider = DeepSeekProvider(
            api_key=api_key,
            model='deepseek-chat'
        )

        # 构建测试消息
        messages = [
            LLMMessage(role='user', content='你好，请简单介绍一下自己')
        ]

        # 测试基本聊天
        print("  📤 发送基本聊天请求...")
        response = provider.chat(messages)

        if response and response.content:
            print(f"  ✅ 收到响应: {response.content[:100]}...")
            return True
        else:
            print("  ❌ 响应为空或格式错误")
            return False

    except Exception as e:
        print(f"  ❌ 基本功能测试失败: {e}")
        return False


def test_deepseek_with_tools():
    """测试 DeepSeek 工具调用功能"""
    print("🔄 测试 DeepSeek 工具调用功能...")

    api_key = os.getenv('DEEPSEEK_API_KEY')
    if not api_key:
        print("❌ 请设置 DEEPSEEK_API_KEY 环境变量")
        return False

    try:
        # 创建 Provider
        provider = DeepSeekProvider(
            api_key=api_key,
            model='deepseek-chat'
        )

        # 构建包含工具的消息
        messages = [
            LLMMessage(
                role='user',
                content='请帮我计算 15 + 27 等于多少'
            )
        ]

        # 模拟工具定义
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "calculate",
                    "description": "计算数学表达式",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "expression": {
                                "type": "string",
                                "description": "数学表达式"
                            }
                        },
                        "required": ["expression"]
                    }
                }
            }
        ]

        # 测试带工具的聊天
        print("  📤 发送带工具的聊天请求...")
        response = provider.chat(messages, tools=tools)

        if response:
            print(f"  ✅ 收到响应: {response.content[:100] if response.content else '无内容'}")
            if response.tool_calls:
                print(f"  ✅ 检测到工具调用: {len(response.tool_calls)} 个")
                for tool_call in response.tool_calls:
                    print(f"    - {tool_call.function.name}: {tool_call.function.arguments}")
            else:
                print("  ℹ️ 没有工具调用")
            return True
        else:
            print("  ❌ 响应为空")
            return False

    except Exception as e:
        print(f"  ❌ 工具调用测试失败: {e}")
        return False


def test_deepseek_reasoner():
    """测试 DeepSeek Reasoner 模型"""
    print("🔄 测试 DeepSeek Reasoner 模型...")

    api_key = os.getenv('DEEPSEEK_API_KEY')
    if not api_key:
        print("❌ 请设置 DEEPSEEK_API_KEY 环境变量")
        return False

    try:
        # 创建 Reasoner Provider
        provider = DeepSeekProvider(
            api_key=api_key,
            model='deepseek-reasoner'
        )

        # 构建测试消息
        messages = [
            LLMMessage(
                role='user',
                content='请解释一下量子计算的基本原理'
            )
        ]

        # 测试 reasoning 模型
        print("  📤 发送 reasoning 模型请求...")
        response = provider.chat(messages)

        if response and response.content:
            print(f"  ✅ 收到响应: {response.content[:100]}...")
            return True
        else:
            print("  ❌ 响应为空或格式错误")
            return False

    except Exception as e:
        print(f"  ❌ Reasoner 模型测试失败: {e}")
        return False


def main():
    """主测试函数"""
    print("🚀 开始 DeepSeek API 测试")
    print("=" * 50)

    # 运行所有测试
    tests = [
        ("基本功能测试", test_deepseek_basic),
        ("工具调用测试", test_deepseek_with_tools),
        ("Reasoner模型测试", test_deepseek_reasoner),
    ]

    results = []
    for test_name, test_func in tests:
        print(f"\n📋 {test_name}")
        print("-" * 30)
        success = test_func()
        results.append((test_name, success))
        print(f"{'✅ 通过' if success else '❌ 失败'}")

    # 输出总结
    print("\n" + "=" * 50)
    print("📊 测试结果总结:")

    passed = sum(1 for _, success in results if success)
    total = len(results)

    for test_name, success in results:
        status = "✅ 通过" if success else "❌ 失败"
        print(f"  {test_name}: {status}")

    print(f"\n总体结果: {passed}/{total} 个测试通过")

    if passed == total:
        print("🎉 所有测试通过！DeepSeek 修复成功。")
        return 0
    else:
        print("⚠️ 部分测试失败，请检查配置和网络连接。")
        return 1


if __name__ == '__main__':
    exit(main())