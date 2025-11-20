import React, { createContext, useContext, useRef, useCallback } from 'react';

interface TerminalContextType {
  executeCommand: (command: string) => void;
  setTerminalRef: (ref: { executeCommand: (command: string) => void } | null) => void;
}

const TerminalContext = createContext<TerminalContextType | null>(null);

export const TerminalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const terminalRef = useRef<{ executeCommand: (command: string) => void } | null>(null);

  const executeCommand = useCallback((command: string) => {
    if (terminalRef.current) {
      terminalRef.current.executeCommand(command);
    }
  }, []);

  const setTerminalRef = useCallback((ref: { executeCommand: (command: string) => void } | null) => {
    terminalRef.current = ref;
  }, []);

  return (
    <TerminalContext.Provider value={{ executeCommand, setTerminalRef }}>
      {children}
    </TerminalContext.Provider>
  );
};

export const useTerminal = () => {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within TerminalProvider');
  }
  return context;
};









