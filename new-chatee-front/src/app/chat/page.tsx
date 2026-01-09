'use client';

import { ChatList } from '@/components/chat';

export default function ChatPage() {
  return (
    <div className="h-screen flex">
      {/* Chat List */}
      <div className="w-full lg:w-80 border-r border-dark-200 bg-white">
        <ChatList />
      </div>

      {/* Empty State - Desktop */}
      <div className="hidden lg:flex flex-1 items-center justify-center bg-dark-50">
        <div className="text-center text-dark-400">
          <p className="text-lg">选择一个对话开始聊天</p>
        </div>
      </div>
    </div>
  );
}
