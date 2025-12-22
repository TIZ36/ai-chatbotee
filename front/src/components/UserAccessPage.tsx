/**
 * 用户访问列表管理页面
 * 管理员可以查看和管理所有用户的访问权限
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Shield, ShieldCheck, Ban, Edit2, Trash2, RefreshCw } from 'lucide-react';
import PageLayout, { Card, ListItem, Badge, EmptyState } from './ui/PageLayout';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import { Switch } from './ui/Switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { toast } from './ui/use-toast';
import { listUserAccess, updateUserAccess, deleteUserAccess, getUserAccess, type UserAccess } from '../services/userAccessApi';

const UserAccessPage: React.FC = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserAccess[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserAccess | null>(null);
  const [editingUser, setEditingUser] = useState<UserAccess | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserAccess | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editNickname, setEditNickname] = useState('');
  const [editIsEnabled, setEditIsEnabled] = useState(true);
  const [editIsAdmin, setEditIsAdmin] = useState(false);

  // 检查当前用户权限
  useEffect(() => {
    const checkPermission = async () => {
      try {
        const user = await getUserAccess();
        setCurrentUser(user);
        
        if (!user.is_owner && !user.is_admin) {
          toast({
            title: '权限不足',
            description: '只有管理员可以访问此页面',
            variant: 'destructive',
          });
          navigate('/');
          return;
        }
        
        loadUsers();
      } catch (error) {
        console.error('[UserAccessPage] Failed to check permission:', error);
        toast({
          title: '获取用户信息失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          variant: 'destructive',
        });
      }
    };
    
    checkPermission();
  }, [navigate]);

  // 加载用户列表
  const loadUsers = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await listUserAccess();
      setUsers(result.users);
    } catch (error) {
      console.error('[UserAccessPage] Failed to load users:', error);
      toast({
        title: '加载失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 打开编辑对话框
  const handleEdit = (user: UserAccess) => {
    setEditingUser(user);
    setEditNickname(user.nickname || '');
    setEditIsEnabled(user.is_enabled);
    setEditIsAdmin(user.is_admin || false);
    setShowEditDialog(true);
  };

  // 保存编辑
  const handleSaveEdit = async () => {
    if (!editingUser) return;
    
    try {
      await updateUserAccess(editingUser.ip_address, {
        nickname: editNickname.trim() || null,
        is_enabled: editIsEnabled,
        is_admin: editIsAdmin,
      });
      
      toast({
        title: '更新成功',
        variant: 'success',
      });
      
      setShowEditDialog(false);
      setEditingUser(null);
      await loadUsers();
    } catch (error) {
      console.error('[UserAccessPage] Failed to update user:', error);
      toast({
        title: '更新失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        variant: 'destructive',
      });
    }
  };

  // 删除用户
  const handleDelete = async () => {
    if (!deleteTarget) return;
    
    try {
      await deleteUserAccess(deleteTarget.ip_address);
      
      toast({
        title: '删除成功',
        variant: 'success',
      });
      
      setDeleteTarget(null);
      await loadUsers();
    } catch (error) {
      console.error('[UserAccessPage] Failed to delete user:', error);
      toast({
        title: '删除失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        variant: 'destructive',
      });
    }
  };

  return (
    <PageLayout
      title="用户访问管理"
      description="管理用户访问权限和管理员设置"
      headerActions={
        <Button variant="ghost" size="icon" onClick={loadUsers} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      }
    >
      {isLoading ? (
        <Card>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
          </div>
        </Card>
      ) : users.length === 0 ? (
        <EmptyState
          icon={Users}
          title="暂无用户"
          description="还没有任何用户访问记录"
        />
      ) : (
        <Card>
          <div className="space-y-2">
            {users.map((user) => (
              <ListItem
                key={user.ip_address}
                active={false}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex-shrink-0">
                    {user.is_admin ? (
                      <ShieldCheck className="w-5 h-5 text-primary-600" />
                    ) : (
                      <Users className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">
                        {user.nickname || user.ip_address}
                      </span>
                      {user.is_admin && (
                        <Badge variant="success">管理员</Badge>
                      )}
                      {!user.is_enabled && (
                        <Badge variant="error">已禁用</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {user.ip_address}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      最后访问: {user.last_access_at ? new Date(user.last_access_at).toLocaleString() : '未知'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleEdit(user)}
                    title="编辑"
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteTarget(user)}
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </ListItem>
            ))}
          </div>
        </Card>
      )}

      {/* 编辑对话框 */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑用户</DialogTitle>
            <DialogDescription>
              修改用户昵称、访问权限和管理员设置
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="edit-ip">IP地址</Label>
              <Input
                id="edit-ip"
                value={editingUser?.ip_address || ''}
                disabled
                className="bg-muted"
              />
            </div>
            <div>
              <Label htmlFor="edit-nickname">昵称</Label>
              <Input
                id="edit-nickname"
                value={editNickname}
                onChange={(e) => setEditNickname(e.target.value)}
                placeholder="请输入昵称"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-enabled">启用访问</Label>
              <Switch
                id="edit-enabled"
                checked={editIsEnabled}
                onCheckedChange={setEditIsEnabled}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label htmlFor="edit-admin">管理员</Label>
                <Shield className="w-4 h-4 text-muted-foreground" />
              </div>
              <Switch
                id="edit-admin"
                checked={editIsAdmin}
                onCheckedChange={setEditIsAdmin}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowEditDialog(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleSaveEdit}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除用户"
        description={`确定要删除用户「${deleteTarget?.nickname || deleteTarget?.ip_address}」吗？此操作不可恢复。`}
        variant="destructive"
        onConfirm={handleDelete}
      />
    </PageLayout>
  );
};

export default UserAccessPage;

