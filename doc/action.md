过程有问题
我需要知道的内容既代表前端 processing模块应该出现文字提示

我们先定义工作节点action类型，后续会用到，以及遇到action类型该如何处理的逻辑

ActionChain: 一个工作链表，agent在处理消息的时候的行为依据，也是agent和agent沟通过程中通过传递共享的任务行为进度

Action_AG_ACCEPT: 大模型接受处理消息，可在一次回答中
Action_AG_REFUSE: 大模型拒绝处理消息，可在一次回答中
Action_AG_SELF_GEN: 大模型自己处理，可在一次回答中
Action_AG_SELF_DECISION: 大模型决策， 可在一次回答中
Action_AG_USE_MCP: 大模型使用mcp完成任务，可在一次回答中
Action_AG_CALL_AG: 大模型需要在输出正文中@其他topic中的agent处理， 不可在一次回答中。需要标记当前任务完成节点进度，发出消息@对应的Agent，并传递 ActionChain
Action_AG_CALL_HUMAN: 大模型需要人类回答或操作，会在回答中@用户

每个Action会有一个 kv结构，k为actiontype，value在没有完成的时候是一个空{}，主要有：
1. 参数列表: 完成这个action可能需要正确的参数列表，比如mcp调用
2. 结果：执行完成该动作的输出字符串
3. interrupt：是不是应该打断后续action

Action封装一个通用类型，默认实现一个dobefore，doafter的回调。目前主要用于通知前端的processing组件，完成进度

思考输出：、、、、、（独立的processing模块）
1. agent处于什么模式，普通模式、persona模式
2. 是否接收到之前的action_chain，完成到哪个节点 
3. 是否决定回复该问题
3. 收到了问题，及看到 xxx，xxx mcp，是否需要修改后续决策工作链
4. 我可以连续处理几个相邻的action n
4. Action x/n 开始：类型：，参数，
5. Aciton x/n 结果:
