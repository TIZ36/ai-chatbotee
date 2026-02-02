/**
 * 浮岛输入框共享样式
 * 用于统一 Workflow 等组件的输入框样式
 * 
 * 边框风格统一使用 Niho 弱化边框：rgba(0, 255, 136, 0.12~0.18)
 */

// 浮岛输入框外层容器样式 - 与聊天界面宽度保持一致
export const floatingComposerContainerClass = "absolute left-2 right-2 sm:left-4 sm:right-4 bottom-3 z-10 pointer-events-none";

// 浮岛输入框内层容器样式 - Niho 风格弱化边框，深色毛玻璃
export const floatingComposerInnerClass = "pointer-events-auto rounded-2xl bg-white/70 dark:bg-[#0a0a0a]/85 backdrop-blur-xl shadow-lg border border-gray-200/40 dark:border-[rgba(0,255,136,0.12)] p-0 w-full";

