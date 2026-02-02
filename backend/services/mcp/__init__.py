"""
MCP 执行服务模块

模块结构:
- text_extractor: 文本提取工具
- argument_generator: 参数生成
- llm_caller: LLM 调用包装
- utils: 通用工具函数

使用方式:
    # 使用工具函数
    from services.mcp.text_extractor import extract_user_request
    from services.mcp.llm_caller import call_llm_api
    
    # 执行 MCP（推荐直接从 mcp_execution_service 导入）
    from services.mcp_execution_service import execute_mcp_with_llm
"""

# 导出常用工具函数
from services.mcp.text_extractor import (
    extract_user_request,
    extract_title,
    extract_images_from_context,
)
from services.mcp.llm_caller import (
    call_llm_api,
    call_llm_with_tools,
    LLMCaller,
)
from services.mcp.argument_generator import (
    generate_tool_arguments,
    ArgumentGenerator,
)
from services.mcp.utils import (
    create_logger,
    truncate_deep,
    build_tool_description,
    build_tool_name_map,
    convert_to_openai_tools,
)

__all__ = [
    # text_extractor
    'extract_user_request',
    'extract_title', 
    'extract_images_from_context',
    # llm_caller
    'call_llm_api',
    'call_llm_with_tools',
    'LLMCaller',
    # argument_generator
    'generate_tool_arguments',
    'ArgumentGenerator',
    # utils
    'create_logger',
    'truncate_deep',
    'build_tool_description',
    'build_tool_name_map',
    'convert_to_openai_tools',
]
