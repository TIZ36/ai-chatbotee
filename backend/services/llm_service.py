"""
LLM 服务层
处理 LLM 配置相关的业务逻辑

职责：
1. 配置管理（CRUD）
2. 非 Actor 模式的 LLM 调用（使用 Provider SDK）
3. 图片生成（使用 Provider SDK）
"""

from typing import List, Optional, Dict, Any
import uuid

from models.llm_config import LLMConfig, LLMConfigRepository
from services.providers import create_provider
from services.providers.base import LLMMessage


class LLMService:
    """LLM 服务"""
    
    def __init__(self, get_connection):
        """
        Args:
            get_connection: 获取数据库连接的函数
        """
        self.repository = LLMConfigRepository(get_connection)
    
    def get_all_configs(self, enabled_only: bool = False, 
                        include_api_key: bool = False) -> List[dict]:
        """
        获取所有 LLM 配置
        
        Args:
            enabled_only: 是否只返回启用的配置
            include_api_key: 是否包含 API Key
        """
        configs = self.repository.find_all(enabled_only=enabled_only)
        return [config.to_dict(include_api_key=include_api_key) for config in configs]
    
    def get_config(self, config_id: str, include_api_key: bool = False) -> Optional[dict]:
        """
        获取单个配置

        Args:
            config_id: 配置 ID
            include_api_key: 是否包含 API Key
        """
        config = self.repository.find_by_id(config_id)
        if config:
            config_dict = config.to_dict(include_api_key=include_api_key)

            # 自动设置 DeepSeek 的 API URL
            # 1. 直接使用 deepseek provider 的情况（迁移后的新格式）
            if config.provider == 'deepseek':
                if not config.api_url:  # 只有在没有设置自定义 URL 时才自动设置
                    config_dict['api_url'] = 'https://api.deepseek.com/v1/chat/completions'
            # 2. 兼容旧数据：provider='openai' 但 model 包含 'deepseek'（建议运行迁移脚本）
            elif config.provider == 'openai' and config.model and 'deepseek' in config.model.lower():
                if not config.api_url:  # 只有在没有设置自定义 URL 时才自动设置
                    config_dict['api_url'] = 'https://api.deepseek.com/v1/chat/completions'

            return config_dict
        return None
    
    def get_api_key(self, config_id: str) -> Optional[str]:
        """
        获取配置的 API Key（安全接口）
        
        Args:
            config_id: 配置 ID
        """
        config = self.repository.find_by_id(config_id)
        if config:
            return config.api_key
        return None
    
    def create_config(self, data: dict) -> dict:
        """
        创建 LLM 配置
        
        Args:
            data: 配置数据
        
        Returns:
            创建的配置
        
        Raises:
            ValueError: 如果数据无效
        """
        # 验证必填字段
        if not data.get('name'):
            raise ValueError('Name is required')
        if not data.get('provider'):
            raise ValueError('Provider is required')
        
        # 生成 ID
        config_id = data.get('config_id') or f"llm_{uuid.uuid4().hex[:8]}"
        
        # supplier = Token/计费归属（如 nvidia, openai）
        supplier = data.get('supplier')
        if not supplier:
            supplier = data.get('provider')
            print(f"[LLMService] ⚠️ 警告: 创建配置时未提供 supplier，使用 provider 作为默认值: {supplier}")
        else:
            print(f"[LLMService] ✅ 创建配置: name={data.get('name')}, provider={data.get('provider')}, supplier={supplier}")
        
        config = LLMConfig(
            config_id=config_id,
            name=data['name'],
            provider=data['provider'],
            supplier=supplier,
            api_key=data.get('api_key'),
            api_url=data.get('api_url'),
            model=data.get('model'),
            tags=data.get('tags'),
            enabled=data.get('enabled', True),
            description=data.get('description'),
            metadata=data.get('metadata'),
        )
        
        try:
            if self.repository.save(config):
                return config.to_dict(include_api_key=False)
            raise RuntimeError('Failed to save config (repository returned False)')
        except Exception as e:
            # 保留原始异常信息
            import traceback
            error_msg = f"保存配置失败: {str(e)}"
            print(f"[LLMService] {error_msg}")
            print(f"[LLMService] Traceback:\n{traceback.format_exc()}")
            raise RuntimeError(error_msg) from e
    
    def update_config(self, config_id: str, data: dict) -> Optional[dict]:
        """
        更新 LLM 配置
        
        Args:
            config_id: 配置 ID
            data: 更新数据
        
        Returns:
            更新后的配置，如果不存在返回 None
        """
        existing = self.repository.find_by_id(config_id)
        if not existing:
            return None
        
        # 更新字段
        if 'name' in data:
            existing.name = data['name']
        if 'provider' in data:
            existing.provider = data['provider']
        if 'supplier' in data:
            existing.supplier = data['supplier']
        if 'api_key' in data:
            existing.api_key = data['api_key']
        if 'api_url' in data:
            existing.api_url = data['api_url']
        if 'model' in data:
            existing.model = data['model']
        if 'tags' in data:
            existing.tags = data['tags']
        if 'enabled' in data:
            existing.enabled = data['enabled']
        if 'description' in data:
            existing.description = data['description']
        if 'metadata' in data:
            existing.metadata = data['metadata']
        
        if self.repository.save(existing):
            return existing.to_dict(include_api_key=False)
        return None
    
    def delete_config(self, config_id: str) -> bool:
        """
        删除 LLM 配置
        
        Args:
            config_id: 配置 ID
        
        Returns:
            是否删除成功
        """
        return self.repository.delete(config_id)
    
    def toggle_enabled(self, config_id: str, enabled: bool) -> Optional[dict]:
        """
        切换配置启用状态
        
        Args:
            config_id: 配置 ID
            enabled: 是否启用
        
        Returns:
            更新后的配置
        """
        return self.update_config(config_id, {'enabled': enabled})

    def chat_completion(self, config_id: str, messages: List[dict], stream: bool = False) -> dict:
        """
        执行聊天补全（非 Actor 模式）
        
        使用 Provider SDK 统一调用，不再使用 RESTful API
        
        Args:
            config_id: 配置 ID
            messages: 消息列表（dict 格式，包含 role 和 content）
            stream: 是否使用流式（暂不支持，返回完整响应）
            
        Returns:
            {
                'content': str,  # 响应内容
                'raw': dict,     # 原始响应（如果可用）
            }
        """
        # ANSI 颜色码（非 Actor 模式使用蓝色）
        BLUE = '\033[94m'
        RESET = '\033[0m'
        BOLD = '\033[1m'
        
        config = self.get_config(config_id, include_api_key=True)
        if not config:
            raise ValueError(f"LLM config not found: {config_id}")
        
        provider_type = config['provider']
        model = config.get('model', 'unknown')
        
        print(f"{BLUE}{BOLD}[LLM Service - 非 Actor 模式] ========== 开始 LLM 调用 =========={RESET}")
        print(f"{BLUE}[LLM Service] Provider: {provider_type}, Model: {model}{RESET}")
        print(f"{BLUE}[LLM Service] Config ID: {config_id}{RESET}")
        
        # 转换消息格式并打印提示词
        llm_messages = []
        for msg in messages:
            role = msg.get('role', 'user')
            content = msg.get('content', '')
            llm_messages.append(LLMMessage(
                role=role,
                content=content,
                media=msg.get('media'),
            ))
            
            # 打印提示词（只打印前 500 字符，避免过长）
            content_preview = content[:500] + '...' if len(content) > 500 else content
            print(f"{BLUE}[LLM Service] {role.upper()} 提示词 ({len(content)} 字符): {content_preview}{RESET}")
        
        # 创建 Provider
        provider = create_provider(
            provider_type=provider_type,
            api_key=config['api_key'],
            api_url=config.get('api_url'),
            model=model,
            **(config.get('metadata') or {})
        )
        
        # 调用 Provider（非流式）
        # 注意：stream 参数暂不支持，统一返回完整响应
        print(f"{BLUE}[LLM Service] 调用 Provider SDK...{RESET}")
        response = provider.chat(llm_messages)
        
        content_length = len(response.content or '')
        print(f"{BLUE}[LLM Service] ✅ 调用成功，返回内容长度: {content_length} 字符{RESET}")
        print(f"{BLUE}{BOLD}[LLM Service - 非 Actor 模式] ========== LLM 调用完成 =========={RESET}\n")
        
        return {
            'content': response.content or '',
            'raw': {
                'thinking': response.thinking,
                'tool_calls': response.tool_calls,
                'usage': response.usage,
            } if hasattr(response, 'thinking') else {}
        }
    
    def generate_avatar(self, config_id: str, name: str, description: str) -> dict:
        """
        使用 LLM 生成头像（非 Actor 模式）
        
        Args:
            config_id: LLM 配置 ID
            name: 角色名称
            description: 头像描述
            
        Returns:
            {'success': True, 'avatar': 'data:image/png;base64,...'} 或 {'success': False, 'error': '...'}
        """
        # ANSI 颜色码（非 Actor 模式使用蓝色）
        BLUE = '\033[94m'
        RESET = '\033[0m'
        BOLD = '\033[1m'
        
        try:
            config = self.get_config(config_id, include_api_key=True)
            if not config:
                return {'success': False, 'error': 'Config not found'}
            
            provider_type = config['provider']
            model = config.get('model', 'unknown')
            
            print(f"{BLUE}{BOLD}[LLM Service - 非 Actor 模式] ========== 生成头像 =========={RESET}")
            print(f"{BLUE}[LLM Service] Provider: {provider_type}, Model: {model}{RESET}")
            print(f"{BLUE}[LLM Service] 角色名称: {name}{RESET}")
            print(f"{BLUE}[LLM Service] 头像描述: {description}{RESET}")
            
            # 目前只有 Gemini 支持图像生成
            if provider_type not in ['gemini', 'google']:
                return {'success': False, 'error': f'{provider_type} 不支持图像生成，请选择 Gemini 模型'}
            
            api_key = config.get('api_key')
            if not api_key:
                return {'success': False, 'error': 'API key not configured'}

            # 构建系统提示词
            system_prompt = (
                f'你是一个 AI 画师。请为以下角色设计并生成一张头像：\n'
                f'名字：{name}\n'
                f'描述：{description}\n\n'
                '请根据角色的性格和背景，生成一张高质量、符合气质的头像。'
            )
            
            print(f"{BLUE}[LLM Service] SYSTEM 提示词: {system_prompt[:200]}...{RESET}")
            print(f"{BLUE}[LLM Service] USER 提示词: 请为我生成头像。{RESET}")

            # 创建 Provider
            provider = create_provider(
                provider_type=provider_type,
                api_key=api_key,
                api_url=config.get('api_url'),
                model=model,
                **(config.get('metadata') or {})
            )

            # 构建消息
            llm_messages = [
                LLMMessage(role='system', content=system_prompt),
                LLMMessage(role='user', content='请为我生成头像。'),
            ]

            # 调用 Provider
            print(f"{BLUE}[LLM Service] 调用 Provider SDK 生成头像...{RESET}")
            resp = provider.chat(llm_messages)
            media = getattr(resp, 'media', None) or []
            
            # 查找返回的图像数据
            for item in media:
                if (item or {}).get('type') == 'image' and (item or {}).get('data'):
                    mime_type = (item or {}).get('mimeType') or (item or {}).get('mime_type') or 'image/png'
                    data = (item or {}).get('data')
                    print(f"{BLUE}[LLM Service] ✅ 头像生成成功，MIME 类型: {mime_type}{RESET}")
                    print(f"{BLUE}{BOLD}[LLM Service - 非 Actor 模式] ========== 生成头像完成 =========={RESET}\n")
                    return {'success': True, 'avatar': f'data:{mime_type};base64,{data}'}

            print(f"{BLUE}[LLM Service] ❌ 模型未返回图像数据{RESET}")
            print(f"{BLUE}{BOLD}[LLM Service - 非 Actor 模式] ========== 生成头像完成 =========={RESET}\n")
            return {'success': False, 'error': '模型未返回图像数据'}
               
        except Exception as e:
            print(f"{BLUE}[LLM Service] ❌ 生成头像失败: {str(e)}{RESET}")
            print(f"{BLUE}{BOLD}[LLM Service - 非 Actor 模式] ========== 生成头像完成 =========={RESET}\n")
            return {'success': False, 'error': str(e)}
    
    def refine_system_prompt(self, config_id: str, current_prompt: str, instruction: str) -> dict:
        """
        使用 LLM 优化系统提示词（非 Actor 模式）
        
        Args:
            config_id: LLM 配置 ID
            current_prompt: 当前提示词
            instruction: 优化指令（用户输入的优化要求）
            
        Returns:
            {'success': True, 'refined_prompt': '...'} 或 {'success': False, 'error': '...'}
        """
        # ANSI 颜色码（非 Actor 模式使用蓝色）
        BLUE = '\033[94m'
        RESET = '\033[0m'
        BOLD = '\033[1m'
        
        try:
            config = self.get_config(config_id, include_api_key=True)
            if not config:
                return {'success': False, 'error': 'Config not found'}
            
            provider_type = config['provider']
            model = config.get('model', 'unknown')
            
            print(f"{BLUE}{BOLD}[LLM Service - 非 Actor 模式] ========== 优化提示词 =========={RESET}")
            print(f"{BLUE}[LLM Service] Provider: {provider_type}, Model: {model}{RESET}")
            print(f"{BLUE}[LLM Service] 当前提示词长度: {len(current_prompt)} 字符{RESET}")
            print(f"{BLUE}[LLM Service] 优化指令: {instruction}{RESET}")
            
            # 构建优化提示词的消息
            system_message = (
                "你是一个专业的提示词优化助手。你的任务是根据用户的优化指令，改进和完善系统提示词。\n"
                "要求：\n"
                "- 保持原提示词的核心意图和风格\n"
                "- 根据优化指令进行改进\n"
                "- 输出优化后的完整提示词，不要只输出修改部分\n"
                "- 如果优化指令不明确，可以适当扩展和完善提示词"
            )
            
            user_message = (
                f"当前提示词：\n{current_prompt}\n\n"
                f"优化指令：{instruction}\n\n"
                "请根据优化指令，输出优化后的完整提示词。"
            )
            
            # 打印提示词（截断长内容）
            current_prompt_preview = current_prompt[:300] + '...' if len(current_prompt) > 300 else current_prompt
            print(f"{BLUE}[LLM Service] SYSTEM 提示词: {system_message[:200]}...{RESET}")
            print(f"{BLUE}[LLM Service] USER 提示词 (当前提示词预览): {current_prompt_preview}{RESET}")
            print(f"{BLUE}[LLM Service] USER 提示词 (优化指令): {instruction}{RESET}")
            
            # 转换消息格式
            llm_messages = [
                LLMMessage(role='system', content=system_message),
                LLMMessage(role='user', content=user_message),
            ]
            
            # 创建 Provider
            provider = create_provider(
                provider_type=provider_type,
                api_key=config['api_key'],
                api_url=config.get('api_url'),
                model=model,
                **(config.get('metadata') or {})
            )
            
            # 调用 Provider
            print(f"{BLUE}[LLM Service] 调用 Provider SDK 优化提示词...{RESET}")
            response = provider.chat(llm_messages)
            refined_prompt = (response.content or '').strip()
            
            if refined_prompt:
                print(f"{BLUE}[LLM Service] ✅ 提示词优化成功，新提示词长度: {len(refined_prompt)} 字符{RESET}")
                print(f"{BLUE}{BOLD}[LLM Service - 非 Actor 模式] ========== 优化提示词完成 =========={RESET}\n")
                return {'success': True, 'refined_prompt': refined_prompt}
            else:
                print(f"{BLUE}[LLM Service] ❌ 模型未返回优化后的提示词{RESET}")
                print(f"{BLUE}{BOLD}[LLM Service - 非 Actor 模式] ========== 优化提示词完成 =========={RESET}\n")
                return {'success': False, 'error': '模型未返回优化后的提示词'}
                
        except Exception as e:
            print(f"{BLUE}[LLM Service] ❌ 优化提示词失败: {str(e)}{RESET}")
            print(f"{BLUE}{BOLD}[LLM Service - 非 Actor 模式] ========== 优化提示词完成 =========={RESET}\n")
            return {'success': False, 'error': str(e)}


# 全局服务实例（延迟初始化）
llm_service: Optional[LLMService] = None


def init_llm_service(get_connection):
    """初始化 LLM 服务"""
    global llm_service
    llm_service = LLMService(get_connection)
    return llm_service


def get_llm_service() -> LLMService:
    """获取 LLM 服务实例"""
    if llm_service is None:
        raise RuntimeError('LLM service not initialized')
    return llm_service
