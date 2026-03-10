import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/utils/cn';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold tracking-[0.01em] font-[var(--font-display)] transition-colors',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ringToken',
    'disabled:pointer-events-none disabled:opacity-50',
    'select-none',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-primaryToken text-primaryToken-foreground hover:bg-primaryToken/90',
        secondary:
          'bg-secondaryToken text-secondaryToken-foreground border border-borderToken hover:bg-secondaryToken/80',
        outline:
          'border border-borderToken bg-background text-foreground hover:bg-mutedToken',
        ghost: 'bg-transparent text-foreground hover:bg-mutedToken',
        destructive:
          'bg-destructiveToken text-destructiveToken-foreground hover:bg-destructiveToken/90',
      },
      size: {
        sm: 'h-10 min-h-[40px] px-4 text-[16px]',
        default: 'h-11 min-h-[44px] px-5 text-[17px]',
        lg: 'h-12 min-h-[48px] px-6 text-[18px]',
        icon: 'h-10 w-10 min-h-[44px] min-w-[44px]',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type={type ?? 'button'}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };

