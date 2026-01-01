#!/usr/bin/env python3
"""
测试 IterationContext 是否在实际运行中使用
"""

import sys
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.actor.iteration_context import IterationContext, MessageType, ProcessPhase, LLMDecision


def test_iteration_context_creation():
    """测试 IterationContext 基本创建"""
    print("🔄 测试 IterationContext 基本功能...")

    # 创建上下文
    ctx = IterationContext(max_iterations=5)
    ctx.original_message = {
        'message_id': 'test_msg_123',
        'content': 'Hello world'
    }
    ctx.topic_id = 'test_topic_123'

    # 测试基本属性
    assert ctx.max_iterations == 5
    assert ctx.iteration == 0
    assert ctx.original_message['content'] == 'Hello world'
    assert ctx.topic_id == 'test_topic_123'
    assert not ctx.is_complete
    assert not ctx.is_interrupted

    print("✅ IterationContext 基本创建成功")


def test_iteration_context_steps():
    """测试处理步骤管理"""
    print("🔄 测试处理步骤管理...")

    ctx = IterationContext()

    # 添加步骤
    step1 = ctx.add_step('thinking', thinking='正在思考...', status='running')
    assert step1['type'] == 'thinking'
    assert step1['thinking'] == '正在思考...'
    assert step1['status'] == 'running'

    # 更新步骤
    ctx.update_last_step(status='completed')
    assert ctx.process_steps[-1]['status'] == 'completed'

    # 添加更多步骤
    ctx.add_step('mcp_call', thinking='调用 MCP 工具', status='running')
    ctx.update_last_step(status='completed', result='success')

    # 验证步骤数量
    assert len(ctx.process_steps) == 2
    assert ctx.process_steps[0]['type'] == 'thinking'
    assert ctx.process_steps[1]['type'] == 'mcp_call'

    print("✅ 处理步骤管理测试通过")


def test_iteration_context_phases():
    """测试处理阶段管理"""
    print("🔄 测试处理阶段管理...")

    ctx = IterationContext()

    # 设置阶段
    ctx.set_phase('load_llm_tool', status='running')
    assert ctx.current_phase == 'load_llm_tool'
    assert ctx.event_states['load_llm_tool']['status'] == 'running'

    # 更新阶段
    ctx.update_phase(status='completed')
    assert ctx.event_states['load_llm_tool']['status'] == 'completed'

    # 设置新阶段
    ctx.set_phase('msg_deal', status='running', decision='continue')
    assert ctx.current_phase == 'msg_deal'
    assert ctx.event_states['msg_deal']['decision'] == 'continue'

    print("✅ 处理阶段管理测试通过")


def test_iteration_context_decisions():
    """测试LLM决策管理"""
    print("🔄 测试LLM决策管理...")

    ctx = IterationContext()

    # 设置决策
    ctx.set_llm_decision('continue', {
        'next_tool_call': {
            'name': 'search_web',
            'arguments': {'query': 'test'}
        }
    })

    assert ctx.llm_decision == 'continue'
    assert ctx.should_continue == True
    assert ctx.next_tool_call['name'] == 'search_web'

    print("✅ LLM决策管理测试通过")


def test_iteration_context_completion():
    """测试完成状态管理"""
    print("🔄 测试完成状态管理...")

    ctx = IterationContext()

    # 标记完成
    ctx.mark_complete("处理完成", [{"type": "text", "text": "result"}])

    assert ctx.is_complete == True
    assert ctx.final_content == "处理完成"
    assert len(ctx.final_media) == 1

    # 验证扩展数据
    ext_data = ctx.build_ext_data()
    assert 'processSteps' in ext_data
    assert 'media' in ext_data

    print("✅ 完成状态管理测试通过")


def test_constants():
    """测试常量定义"""
    print("🔄 测试常量定义...")

    # 消息类型
    assert MessageType.USER_NEW_MSG == 'user_new_msg'
    assert MessageType.AGENT_MSG == 'agent_msg'
    assert MessageType.RESULT_MSG == 'result_msg'

    # 处理阶段
    assert ProcessPhase.LOAD_LLM_TOOL == 'load_llm_tool'
    assert ProcessPhase.MSG_DEAL == 'msg_deal'

    # LLM决策
    assert LLMDecision.CONTINUE == 'continue'
    assert LLMDecision.COMPLETE == 'complete'

    print("✅ 常量定义测试通过")


def main():
    """主测试函数"""
    print("🚀 开始 IterationContext 测试")
    print("=" * 50)

    try:
        # 运行所有测试
        test_iteration_context_creation()
        test_iteration_context_steps()
        test_iteration_context_phases()
        test_iteration_context_decisions()
        test_iteration_context_completion()
        test_constants()

        print("\n" + "=" * 50)
        print("🎉 所有 IterationContext 测试通过！")
        print("✅ IterationContext 模块工作正常")
        return 0

    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    exit(main())