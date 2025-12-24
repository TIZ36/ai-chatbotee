import React, { useState, useRef, useCallback } from 'react';
import { calculateCursorPosition } from './utils';

export interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  handleSend: () => void;
  showBatchItemSelector: boolean;
  showModuleSelector: boolean;
  setShowModuleSelector: (show: boolean) => void;
  showAtSelector: boolean;
  setShowAtSelector: (show: boolean) => void;
  handleSelectComponent: (component: any) => void;
  getSelectableComponents: () => any[];
  selectedComponentIndex: number;
  setSelectedComponentIndex: React.Dispatch<React.SetStateAction<number>>;
}

export const useChatInput = ({
  input,
  setInput,
  inputRef,
  handleSend,
  showBatchItemSelector,
  showModuleSelector,
  setShowModuleSelector,
  showAtSelector,
  setShowAtSelector,
  handleSelectComponent,
  getSelectableComponents,
  selectedComponentIndex,
  setSelectedComponentIndex,
}: ChatInputProps) => {
  const [moduleSelectorIndex, setModuleSelectorIndex] = useState(-1);
  const [moduleSelectorQuery, setModuleSelectorQuery] = useState('');
  const [moduleSelectorPosition, setModuleSelectorPosition] = useState({ bottom: 0, left: 0, maxHeight: 0 });
  
  const [atSelectorIndex, setAtSelectorIndex] = useState(-1);
  const [atSelectorQuery, setAtSelectorQuery] = useState('');
  const [atSelectorPosition, setAtSelectorPosition] = useState({ bottom: 0, left: 0, maxHeight: 0 });
  
  const isComposingRef = useRef(false);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    
    const cursorPosition = e.target.selectionStart || 0;
    const textBeforeCursor = value.substring(0, cursorPosition);
    
    // Detect / command
    const lastSlashIndex = textBeforeCursor.lastIndexOf('/');
    if (lastSlashIndex !== -1) {
      const textAfterSlash = textBeforeCursor.substring(lastSlashIndex + 1);
      const hasSpaceOrNewline = textAfterSlash.includes(' ') || textAfterSlash.includes('\n');
      const textBeforeSlash = textBeforeCursor.substring(0, lastSlashIndex);
      const isAtLineStart = textBeforeSlash.length === 0 || textBeforeSlash.endsWith('\n') || textBeforeSlash.endsWith(' ');
      
      if (!hasSpaceOrNewline && isAtLineStart) {
        const query = textAfterSlash.toLowerCase();
        setModuleSelectorIndex(lastSlashIndex);
        setModuleSelectorQuery(query);
        setShowAtSelector(false);
        
        if (inputRef.current) {
          const { x, y } = calculateCursorPosition(inputRef.current, textBeforeCursor);
          
          const selectorMaxHeight = 256;
          const selectorWidth = 320;
          const viewportWidth = window.innerWidth;
          
          let left = x + 8;
          if (left + selectorWidth > viewportWidth - 10) {
            left = x - selectorWidth - 8;
            if (left < 10) left = x + 8;
          }
          if (left < 10) left = 10;
          
          const bottom = window.innerHeight - y + 5;
          const availableHeightAbove = y - 20;
          const actualMaxHeight = Math.min(selectorMaxHeight, availableHeightAbove);
          
          setModuleSelectorPosition({ bottom, left, maxHeight: actualMaxHeight });
          setShowModuleSelector(true);
        }
        return;
      } else {
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
      }
    } else {
      if (showModuleSelector) {
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
      }
    }
    
    // Detect @ symbol
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      const hasSpaceOrNewline = textAfterAt.includes(' ') || textAfterAt.includes('\n');
      
      if (!hasSpaceOrNewline) {
        const query = textAfterAt.toLowerCase();
        setAtSelectorIndex(lastAtIndex);
        setAtSelectorQuery(query);
        setShowModuleSelector(false);
        
        if (inputRef.current) {
          const { x, y } = calculateCursorPosition(inputRef.current, textBeforeCursor);
          
          const selectorMaxHeight = 256;
          const selectorWidth = 280;
          const viewportWidth = window.innerWidth;
          
          let left = x + 8;
          if (left + selectorWidth > viewportWidth - 10) {
            left = x - selectorWidth - 8;
            if (left < 10) left = x + 8;
          }
          if (left < 10) left = 10;
          
          const bottom = window.innerHeight - y + 5;
          const availableHeightAbove = y - 20;
          const actualMaxHeight = Math.min(selectorMaxHeight, availableHeightAbove);
          
          setAtSelectorPosition({ bottom, left, maxHeight: actualMaxHeight });
          setShowAtSelector(true);
          setSelectedComponentIndex(0);
        }
        return;
      } else {
        setShowAtSelector(false);
        setAtSelectorIndex(-1);
      }
    } else {
      if (showAtSelector) {
        setShowAtSelector(false);
        setAtSelectorIndex(-1);
      }
    }
  }, [inputRef, setInput, setShowAtSelector, setShowModuleSelector, setSelectedComponentIndex, showAtSelector, showModuleSelector]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (isComposingRef.current || (e.nativeEvent as any)?.isComposing) return;
    if (showBatchItemSelector || showModuleSelector || showAtSelector) return;
    if (e.shiftKey) return;
    
    e.preventDefault();
    handleSend();
  }, [handleSend, showAtSelector, showBatchItemSelector, showModuleSelector]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    handleKeyPress(e);
    if (e.defaultPrevented) return;
    
    if (showBatchItemSelector || showModuleSelector) return;
    
    if (showAtSelector) {
      const selectableComponentsList = getSelectableComponents();
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedComponentIndex(prev => 
          prev < selectableComponentsList.length - 1 ? prev + 1 : prev
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedComponentIndex(prev => prev > 0 ? prev - 1 : 0);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectableComponentsList[selectedComponentIndex]) {
          handleSelectComponent(selectableComponentsList[selectedComponentIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowAtSelector(false);
      }
    }
  }, [getSelectableComponents, handleKeyPress, handleSelectComponent, selectedComponentIndex, setSelectedComponentIndex, setShowAtSelector, showAtSelector, showBatchItemSelector, showModuleSelector]);

  return {
    moduleSelectorIndex,
    setModuleSelectorIndex,
    moduleSelectorQuery,
    setModuleSelectorQuery,
    moduleSelectorPosition,
    atSelectorIndex,
    setAtSelectorIndex,
    atSelectorQuery,
    setAtSelectorQuery,
    atSelectorPosition,
    isComposingRef,
    handleInputChange,
    handleKeyPress,
    handleKeyDown,
  };
};
