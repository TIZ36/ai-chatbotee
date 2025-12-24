/**
 * 首次访问昵称输入对话框
 */

import React from 'react';
import { Loader } from 'lucide-react';
import { Button } from '../../ui/Button';
import { InputField } from '../../ui/FormField';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../ui/Dialog';
import type { UserAccess } from '../../../services/userAccessApi';

export interface NicknameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nicknameInput: string;
  setNicknameInput: (nickname: string) => void;
  isSubmitting: boolean;
  userAccess: UserAccess | null;
  onSubmit: () => Promise<void>;
}

export const NicknameDialog: React.FC<NicknameDialogProps> = ({
  open,
  onOpenChange,
  nicknameInput,
  setNicknameInput,
  isSubmitting,
  userAccess,
  onSubmit,
}) => {
  const handleOpenChange = (newOpen: boolean) => {
    // 如果用户未填写昵称，不允许关闭对话框
    if (!newOpen && (!userAccess?.nickname || userAccess?.needs_nickname)) {
      return;
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>欢迎使用</DialogTitle>
          <DialogDescription>
            {userAccess?.is_enabled === false 
              ? '您的访问已被禁用，请联系管理员。'
              : '首次访问，请填写您的昵称以便我们识别您。'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <InputField
            label="昵称"
            required
            inputProps={{
              id: 'nickname',
              value: nicknameInput,
              onChange: (e) => setNicknameInput(e.target.value),
              placeholder: '请输入您的昵称',
              disabled: isSubmitting || userAccess?.is_enabled === false,
              onKeyDown: (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit();
                }
              },
            }}
          />
          {userAccess?.ip_address && (
            <p className="text-xs text-muted-foreground">
              您的IP地址: {userAccess.ip_address}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={isSubmitting || !nicknameInput.trim() || userAccess?.is_enabled === false}
          >
            {isSubmitting ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                保存中...
              </>
            ) : (
              '保存'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
