import * as React from 'react';

import { cn } from '@/utils/cn';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          [
            'flex h-9 w-full rounded-md border border-inputToken bg-background px-3 py-2 text-sm text-foreground',
            'placeholder:text-mutedToken-foreground',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ringToken',
            'disabled:cursor-not-allowed disabled:opacity-50',
          ].join(' '),
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

