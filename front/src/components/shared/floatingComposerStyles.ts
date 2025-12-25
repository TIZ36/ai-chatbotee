/**
 * 浮岛输入框共享样式
 * 用于统一 RoundTablePanel、Workflow、ResearchPanel 等组件的输入框样式
 */

// 浮岛输入框外层容器样式
export const floatingComposerContainerClass = "absolute left-4 right-4 bottom-2 z-10 pointer-events-none";

// 浮岛输入框内层容器样式 - 移除 max-w-2xl 限制，让输入框更宽
export const floatingComposerInnerClass = "pointer-events-auto rounded-xl bg-white/35 dark:bg-[#262626]/35 backdrop-blur-md shadow-lg p-0 w-full max-w-4xl mx-auto";

