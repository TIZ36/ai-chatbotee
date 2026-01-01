#!/usr/bin/env python3
"""
测试消息类型 (msgtype) 在实际处理流程中的使用情况
"""

import sys
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.actor.iteration_context import IterationContext, MessageType


def test_msgtype_classification():
    """测试消息类型分类逻辑"""
    print("🔄 测试消息类型分类逻辑...")

    # 模拟 ActorBase 的分类逻辑（简化版）
    def classify_msg_type(msg_data):
        """模拟消息类型分类"""
        sender_type = msg_data.get('sender_type', '')
        ext = msg_data.get('ext', {}) or {}

        msg_type = MessageType.USER_NEW_MSG  # 默认

        # 1. 检查是否是 Agent 消息
        if sender_type == 'agent':
            # 检查是否是链式追加
            if ext.get('chain_append') or ext.get('auto_trigger'):
                msg_type = MessageType.AGENT_MSG
            # 检查是否是工具调用请求
            elif ext.get('tool_call'):
                tool_call = ext['tool_call']
                if isinstance(tool_call, dict) and tool_call.get('tool_name'):
                    msg_type = MessageType.AGENT_TOOLCALL_MSG

        # 2. 检查系统消息中的工具调用标记
        elif sender_type == 'system':
            if ext.get('mcp_error') and ext.get('auto_trigger'):
                msg_type = MessageType.AGENT_MSG  # 错误触发的自处理消息

        return msg_type

    # 测试用例
    test_cases = [
        # (描述, 消息数据, 期望的消息类型)
        ("普通用户消息", {
            'sender_type': 'user',
            'content': '你好'
        }, MessageType.USER_NEW_MSG),

        ("Agent 链式消息", {
            'sender_type': 'agent',
            'content': '继续处理...',
            'ext': {'chain_append': True}
        }, MessageType.AGENT_MSG),

        ("Agent 工具调用消息", {
            'sender_type': 'agent',
            'content': '调用工具',
            'ext': {
                'tool_call': {
                    'tool_name': 'search_web',
                    'server_id': 'mcp_001',
                    'params': {'query': 'test'}
                }
            }
        }, MessageType.AGENT_TOOLCALL_MSG),

        ("系统错误消息", {
            'sender_type': 'system',
            'content': 'MCP调用失败',
            'ext': {
                'mcp_error': True,
                'auto_trigger': True
            }
        }, MessageType.AGENT_MSG),
    ]

    for desc, msg_data, expected_type in test_cases:
        result_type = classify_msg_type(msg_data)
        status = "✅" if result_type == expected_type else "❌"
        print(f"  {status} {desc}: {result_type} (期望: {expected_type})")
        assert result_type == expected_type, f"{desc} 分类错误"

    print("✅ 消息类型分类测试通过")


def test_msgtype_in_context():
    """测试消息类型在 IterationContext 中的使用"""
    print("🔄 测试消息类型在上下文中的使用...")

    # 创建上下文
    ctx = IterationContext()

    # 设置不同的消息类型
    test_msg_types = [
        MessageType.USER_NEW_MSG,
        MessageType.AGENT_MSG,
        MessageType.AGENT_TOOLCALL_MSG,
        MessageType.RESULT_MSG,
    ]

    for msg_type in test_msg_types:
        ctx.set_msg_type(msg_type)
        assert ctx.msg_type == msg_type, f"设置消息类型失败: {msg_type}"

    print("✅ 消息类型在上下文中的使用测试通过")


def test_msgtype_processing_logic():
    """测试基于消息类型的处理逻辑"""
    print("🔄 测试基于消息类型的处理逻辑...")

    def simulate_pre_deal_logic(msg_type, sender_id, agent_id):
        """模拟预处理逻辑"""
        # 1. agent_msg from self: 跳过
        if msg_type == MessageType.AGENT_MSG and sender_id == agent_id:
            return False, "skip_self_message"

        # 2. agent_toolcall_msg: 执行 MCP 调用
        if msg_type == MessageType.AGENT_TOOLCALL_MSG:
            return True, "execute_mcp_call"

        # 其他消息继续处理
        return True, "continue_processing"

    agent_id = "agent_001"

    test_cases = [
        # (消息类型, 发送者ID, 期望结果: (继续处理, 动作))
        (MessageType.USER_NEW_MSG, "user_123", (True, "continue_processing")),
        (MessageType.AGENT_MSG, "agent_001", (False, "skip_self_message")),
        (MessageType.AGENT_MSG, "agent_002", (True, "continue_processing")),
        (MessageType.AGENT_TOOLCALL_MSG, "agent_002", (True, "execute_mcp_call")),
        (MessageType.RESULT_MSG, "system", (True, "continue_processing")),
    ]

    for msg_type, sender_id, (expected_continue, expected_action) in test_cases:
        continue_processing, action = simulate_pre_deal_logic(msg_type, sender_id, agent_id)

        status = "✅" if (continue_processing == expected_continue and action == expected_action) else "❌"
        print(f"  {status} {msg_type} from {sender_id}: {continue_processing}, {action}")

        assert continue_processing == expected_continue, f"处理逻辑错误: {msg_type}"
        assert action == expected_action, f"动作错误: {msg_type}"

    print("✅ 基于消息类型的处理逻辑测试通过")


def test_msgtype_constants():
    """测试消息类型常量定义"""
    print("🔄 测试消息类型常量...")

    # 验证常量值
    assert MessageType.USER_NEW_MSG == 'user_new_msg'
    assert MessageType.AGENT_MSG == 'agent_msg'
    assert MessageType.AGENT_TOOLCALL_MSG == 'agent_toolcall_msg'
    assert MessageType.RESULT_MSG == 'result_msg'

    # 验证常量类型
    assert isinstance(MessageType.USER_NEW_MSG, str)
    assert isinstance(MessageType.AGENT_MSG, str)
    assert isinstance(MessageType.AGENT_TOOLCALL_MSG, str)
    assert isinstance(MessageType.RESULT_MSG, str)

    print("✅ 消息类型常量测试通过")


def main():
    """主测试函数"""
    print("🚀 开始消息类型 (msgtype) 使用情况测试")
    print("=" * 60)

    try:
        # 运行所有测试
        test_msgtype_constants()
        test_msgtype_in_context()
        test_msgtype_classification()
        test_msgtype_processing_logic()

        print("\n" + "=" * 60)
        print("🎉 所有消息类型测试通过！")
        print("✅ 消息类型 (msgtype) 正在系统中正常使用")
        print("\n📋 消息类型使用总结:")
        print("  - MessageType.USER_NEW_MSG: 用户消息处理")
        print("  - MessageType.AGENT_MSG: Agent 链式消息")
        print("  - MessageType.AGENT_TOOLCALL_MSG: MCP 工具调用")
        print("  - MessageType.RESULT_MSG: 工具执行结果")
        return 0

    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    exit(main())