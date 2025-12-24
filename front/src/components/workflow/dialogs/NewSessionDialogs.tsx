/**
 * 新建会议/研究任务对话框
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

export interface NewMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingName: string;
  setMeetingName: (name: string) => void;
  isCreating: boolean;
  onCreate: () => Promise<void>;
}

export const NewMeetingDialog: React.FC<NewMeetingDialogProps> = ({
  open,
  onOpenChange,
  meetingName,
  setMeetingName,
  isCreating,
  onCreate,
}) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setMeetingName('');
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新建会议</DialogTitle>
          <DialogDescription>输入会议名称并创建</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <InputField
            label="会议名称"
            required
            inputProps={{
              id: 'meeting-name',
              value: meetingName,
              onChange: (e) => setMeetingName(e.target.value),
              placeholder: '例如：项目讨论会',
              disabled: isCreating,
              onKeyDown: (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onCreate();
                }
              },
            }}
          />
        </div>
        <DialogFooter>
          <Button 
            variant="secondary" 
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
          >
            取消
          </Button>
          <Button
            variant="primary"
            onClick={onCreate}
            disabled={isCreating || !meetingName.trim()}
          >
            {isCreating ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                创建中...
              </>
            ) : (
              '创建'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export interface NewResearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  researchName: string;
  setResearchName: (name: string) => void;
  isCreating: boolean;
  onCreate: () => Promise<void>;
}

export const NewResearchDialog: React.FC<NewResearchDialogProps> = ({
  open,
  onOpenChange,
  researchName,
  setResearchName,
  isCreating,
  onCreate,
}) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setResearchName('');
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新建研究任务</DialogTitle>
          <DialogDescription>输入研究任务名称并创建</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <InputField
            label="任务名称"
            required
            inputProps={{
              id: 'research-name',
              value: researchName,
              onChange: (e) => setResearchName(e.target.value),
              placeholder: '例如：市场分析',
              disabled: isCreating,
              onKeyDown: (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onCreate();
                }
              },
            }}
          />
        </div>
        <DialogFooter>
          <Button 
            variant="secondary" 
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
          >
            取消
          </Button>
          <Button
            variant="primary"
            onClick={onCreate}
            disabled={isCreating || !researchName.trim()}
          >
            {isCreating ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                创建中...
              </>
            ) : (
              '创建'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
