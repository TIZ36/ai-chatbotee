"""
工作流 API 路由
"""

from flask import Blueprint, request, jsonify
import uuid

from models.workflow import Workflow, WorkflowRepository

# 创建 Blueprint
workflow_bp = Blueprint('workflow', __name__)

# 工作流仓库实例（延迟初始化）
_workflow_repo = None


def init_workflow_api(get_connection):
    """初始化工作流 API"""
    global _workflow_repo
    _workflow_repo = WorkflowRepository(get_connection)


def get_workflow_repo() -> WorkflowRepository:
    """获取工作流仓库"""
    if _workflow_repo is None:
        raise RuntimeError('Workflow API not initialized')
    return _workflow_repo


@workflow_bp.route('', methods=['GET'])
def get_workflows():
    """获取所有工作流"""
    try:
        repo = get_workflow_repo()
        workflows = repo.find_all()
        return jsonify([w.to_dict() for w in workflows])
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@workflow_bp.route('/<workflow_id>', methods=['GET'])
def get_workflow(workflow_id):
    """获取单个工作流"""
    try:
        repo = get_workflow_repo()
        workflow = repo.find_by_id(workflow_id)
        if workflow:
            return jsonify(workflow.to_dict())
        return jsonify({'error': 'Workflow not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@workflow_bp.route('', methods=['POST'])
def create_workflow():
    """创建工作流"""
    try:
        repo = get_workflow_repo()
        data = request.get_json()
        
        if not data.get('name'):
            return jsonify({'error': 'Name is required'}), 400
        
        workflow_id = data.get('workflow_id') or f"wf_{uuid.uuid4().hex[:8]}"
        
        workflow = Workflow(
            workflow_id=workflow_id,
            name=data['name'],
            description=data.get('description'),
            config=data.get('config'),
        )
        
        if repo.save(workflow):
            return jsonify(workflow.to_dict()), 201
        return jsonify({'error': 'Failed to save workflow'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@workflow_bp.route('/<workflow_id>', methods=['PUT'])
def update_workflow(workflow_id):
    """更新工作流"""
    try:
        repo = get_workflow_repo()
        existing = repo.find_by_id(workflow_id)
        
        if not existing:
            return jsonify({'error': 'Workflow not found'}), 404
        
        data = request.get_json()
        
        if 'name' in data:
            existing.name = data['name']
        if 'description' in data:
            existing.description = data['description']
        if 'config' in data:
            existing.config = data['config']
        
        if repo.save(existing):
            return jsonify(existing.to_dict())
        return jsonify({'error': 'Failed to update workflow'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@workflow_bp.route('/<workflow_id>', methods=['DELETE'])
def delete_workflow(workflow_id):
    """删除工作流"""
    try:
        repo = get_workflow_repo()
        if repo.delete(workflow_id):
            return jsonify({'success': True})
        return jsonify({'error': 'Workflow not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500
