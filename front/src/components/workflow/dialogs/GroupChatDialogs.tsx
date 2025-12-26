/**
 * 群聊/研究任务相关对话框
 */

import React from 'react';
import { Bot, UserPlus, ListTodo, CheckSquare, Square } from 'lucide-react';
import { Button } from '../../ui/Button';
import { ScrollArea } from '../../ui/ScrollArea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../ui/Dialog';
import type { Session } from '../../../services/sessionApi';
import type { RoundTableParticipant } from '../../../services/roundTableApi';

export interface AddParticipantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: Session[];
  participants: RoundTableParticipant[];
  onAdd: (agent: Session) => Promise<void>;
}

export const AddParticipantDialog: React.FC<AddParticipantDialogProps> = ({
  open,
  onOpenChange,
  agents,
  participants,
  onAdd,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>邀请智能体加入群聊</DialogTitle>
          <DialogDescription>
            添加其他智能体到当前对话中，开启多智能体协作模式。
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[300px] pr-4">
          <div className="space-y-2 py-2">
            {agents.filter(a => !participants.some(p => p.session_id === a.session_id)).map(agent => (
              <div 
                key={agent.session_id}
                className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] cursor-pointer transition-colors"
                onClick={() => onAdd(agent)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center overflow-hidden">
                    {agent.avatar ? (
                      <img src={agent.avatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Bot className="w-5 h-5 text-primary-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{agent.name || agent.title}</div>
                    <div className="text-xs text-gray-500 truncate">{agent.system_prompt}</div>
                  </div>
                </div>
                <Button size="sm" variant="ghost">邀请</Button>
              </div>
            ))}
            {agents.length === 0 && (
              <div className="text-center py-4 text-gray-500 text-sm">暂无可用智能体</div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export interface ResearchTodoConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  todos: {id: string, text: string, checked: boolean}[];
  setTodos: React.Dispatch<React.SetStateAction<{id: string, text: string, checked: boolean}[]>>;
  onConfirm: (tasks: string[]) => Promise<void>;
  onCancel: () => void;
}

export const ResearchTodoConfirmDialog: React.FC<ResearchTodoConfirmDialogProps> = ({
  open,
  onOpenChange,
  todos,
  setTodos,
  onConfirm,
  onCancel,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListTodo className="w-5 h-5 text-primary-500" />
            确认研究任务
          </DialogTitle>
          <DialogDescription>
            AI 整理了以下研究计划，请确认需要执行的任务：
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {todos.map(todo => (
            <div 
              key={todo.id} 
              className="flex items-start gap-3 p-2.5 rounded-lg border border-gray-100 dark:border-[#404040] hover:bg-gray-50 dark:hover:bg-[#363636] transition-colors cursor-pointer"
              onClick={() => {
                setTodos(prev => prev.map(t => 
                  t.id === todo.id ? { ...t, checked: !t.checked } : t
                ));
              }}
            >
              <div className="mt-0.5">
                {todo.checked ? (
                  <CheckSquare className="w-4 h-4 text-primary-500" />
                ) : (
                  <Square className="w-4 h-4 text-gray-400" />
                )}
              </div>
              <div className="text-sm leading-relaxed">{todo.text}</div>
            </div>
          ))}
        </div>
        <DialogFooter className="flex gap-2">
          <Button 
            variant="secondary" 
            className="flex-1"
            onClick={onCancel}
          >
            仅作为回复
          </Button>
          <Button 
            variant="primary" 
            className="flex-1"
            onClick={() => {
              const selectedTasks = todos.filter(t => t.checked).map(t => t.text);
              onConfirm(selectedTasks);
            }}
          >
            确认并启动异步研究
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

