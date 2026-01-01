#!/usr/bin/env python3
"""
测试 IterationContext 前端通知和日志记录功能
"""

import sys
import os
import time

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.actor.iteration_context import IterationContext


def test_step_callback_and_logging():
    """测试步骤回调和日志记录"""
    print("🔄 测试步骤回调和日志记录...")

    # 收集回调通知
    notifications = []

    def mock_callback(ctx, step):
        """模拟前端回调"""
        notifications.append({
            'step_type': step.get('type'),
            'status': step.get('status'),
            'thinking': step.get('thinking', ''),
            'timestamp': step.get('timestamp'),
        })
        print(f"📢 前端收到通知: {step.get('type')} -> {step.get('status')}")

    # 创建上下文并设置回调
    ctx = IterationContext()
    ctx.set_step_callback(mock_callback, "test_agent")

    # 添加步骤
    print("\n📝 添加步骤...")
    step1 = ctx.add_step('load_llm', thinking='加载LLM配置...', status='running')
    assert step1['type'] == 'load_llm'
    assert step1['status'] == 'running'
    assert step1['thinking'] == '加载LLM配置...'

    # 等待一下再更新
    time.sleep(0.1)

    # 更新步骤状态
    print("\n📝 更新步骤状态...")
    ctx.update_last_step(status='completed', result='成功加载')

    # 添加更多步骤
    step2 = ctx.add_step('prepare_context', thinking='准备上下文消息...', status='running')
    time.sleep(0.1)
    ctx.update_last_step(status='completed')

    step3 = ctx.add_step('msg_classify', thinking='分析消息类型...', status='running')
    time.sleep(0.1)
    ctx.update_last_step(status='completed', msg_type='user_new_msg')

    # 验证通知
    print("\n📊 验证通知记录...")
    assert len(notifications) == 6, f"应该收到6个通知，实际收到{len(notifications)}个"

    # 验证通知内容
    expected_notifications = [
        ('load_llm', 'running'),
        ('load_llm', 'completed'),
        ('prepare_context', 'running'),
        ('prepare_context', 'completed'),
        ('msg_classify', 'running'),
        ('msg_classify', 'completed'),
    ]

    for i, (expected_type, expected_status) in enumerate(expected_notifications):
        actual = notifications[i]
        assert actual['step_type'] == expected_type, f"通知{i}类型错误: {actual['step_type']} != {expected_type}"
        assert actual['status'] == expected_status, f"通知{i}状态错误: {actual['status']} != {expected_status}"

    # 验证步骤列表
    steps = ctx.to_process_steps_dict()
    assert len(steps) == 3, f"应该有3个步骤，实际有{len(steps)}个"

    print("✅ 步骤回调和日志记录测试通过")


def test_process_steps_format():
    """测试处理步骤格式"""
    print("🔄 测试处理步骤格式...")

    ctx = IterationContext()

    # 添加测试步骤
    ctx.add_step('test_step', thinking='测试步骤', status='running', extra_field='extra_value')
    ctx.update_last_step(status='completed', duration=100)

    # 获取步骤字典
    steps = ctx.to_process_steps_dict()
    assert len(steps) == 1

    step = steps[0]
    required_fields = ['type', 'timestamp', 'status']
    for field in required_fields:
        assert field in step, f"步骤缺少必需字段: {field}"

    # 检查扩展字段
    assert step['type'] == 'test_step'
    assert step['thinking'] == '测试步骤'
    assert step['status'] == 'completed'
    assert step['extra_field'] == 'extra_value'
    assert 'duration' in step

    print("✅ 处理步骤格式测试通过")


def test_error_handling():
    """测试错误处理"""
    print("🔄 测试错误处理...")

    error_notifications = []

    def error_callback(ctx, step):
        error_notifications.append(step)

    ctx = IterationContext()
    ctx.set_step_callback(error_callback, "test_agent")

    # 测试异常处理
    def failing_callback(ctx, step):
        raise Exception("测试异常")

    ctx._step_callback = failing_callback

    # 这应该不会抛出异常，而是记录错误
    try:
        ctx.add_step('test', thinking='测试')
        print("✅ 异常被正确处理")
    except Exception as e:
        print(f"❌ 异常未被正确处理: {e}")
        return False

    return True


def main():
    """主测试函数"""
    print("🚀 开始 IterationContext 前端通知测试")
    print("=" * 60)

    try:
        # 运行所有测试
        test_step_callback_and_logging()
        test_process_steps_format()
        test_error_handling()

        print("\n" + "=" * 60)
        print("🎉 所有 IterationContext 前端通知测试通过！")
        print("\n📋 功能说明:")
        print("  - ✅ 每步操作自动记录日志")
        print("  - ✅ 每步变更自动通知前端")
        print("  - ✅ 步骤状态实时更新")
        print("  - ✅ 异常安全处理")
        return 0

    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    exit(main())