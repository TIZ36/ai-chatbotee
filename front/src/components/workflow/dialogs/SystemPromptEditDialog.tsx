import React from 'react';
import { X, FileText } from 'lucide-react';

export interface SystemPromptEditDialogProps {
  open: boolean;
  onClose: () => void;
  draft: string;
  setDraft: (value: string) => void;
  onSave: () => Promise<void>;
  onClear: () => Promise<void>;
}

export const SystemPromptEditDialog: React.FC<SystemPromptEditDialogProps> = ({
  open,
  onClose,
  draft,
  setDraft,
  onSave,
  onClear,
}) => {
  if (!open) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" 
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-[#2d2d2d] rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center space-x-2">
            <FileText className="w-5 h-5 text-indigo-500" />
            <span>设置人设</span>
          </h3>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">
          <p className="text-sm text-gray-500 dark:text-[#b0b0b0] mb-3">
            人设是 AI 的角色设定，会影响所有对话的回复风格和内容。
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="例如：你是一个专业的产品经理，擅长分析用户需求和产品设计..."
            className="w-full h-40 px-3 py-2 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#363636] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            autoFocus
          />
        </div>
        <div className="px-5 py-4 bg-gray-50 dark:bg-[#363636] flex items-center justify-between">
          <button
            onClick={onClear}
            className="text-sm text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
          >
            清除人设
          </button>
          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-[#ffffff] hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              取消
            </button>
            <button
              onClick={onSave}
              className="px-4 py-2 text-sm bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
