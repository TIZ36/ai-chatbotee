/**
 * 表单字段组件 - 封装 Label + Input/Textarea + 错误提示的模式
 * 用于替代重复的表单字段布局代码
 */

import React from 'react';
import { Label } from './Label';
import { Input, InputProps } from './Input';
import { Textarea, TextareaProps } from './Textarea';
import { cn } from '@/utils/cn';

export interface FormFieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
}

/**
 * 输入框字段 - 封装 Label + Input + 错误提示
 */
export interface InputFieldProps extends FormFieldProps {
  inputProps: InputProps;
}

export const InputField: React.FC<InputFieldProps> = ({
  label,
  error,
  hint,
  required,
  className,
  inputProps,
}) => {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={inputProps.id}>
        {label}
        {required && <span className="text-destructiveToken ml-1">*</span>}
      </Label>
      <Input
        {...inputProps}
        className={cn(error && 'border-destructiveToken', inputProps.className)}
      />
      {error && (
        <p className="text-xs text-destructiveToken">{error}</p>
      )}
      {hint && !error && (
        <p className="text-xs text-mutedToken-foreground">{hint}</p>
      )}
    </div>
  );
};

/**
 * 文本域字段 - 封装 Label + Textarea + 错误提示
 */
export interface TextareaFieldProps extends FormFieldProps {
  textareaProps: TextareaProps;
}

export const TextareaField: React.FC<TextareaFieldProps> = ({
  label,
  error,
  hint,
  required,
  className,
  textareaProps,
}) => {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={textareaProps.id}>
        {label}
        {required && <span className="text-destructiveToken ml-1">*</span>}
      </Label>
      <Textarea
        {...textareaProps}
        className={cn(error && 'border-destructiveToken', textareaProps.className)}
      />
      {error && (
        <p className="text-xs text-destructiveToken">{error}</p>
      )}
      {hint && !error && (
        <p className="text-xs text-mutedToken-foreground">{hint}</p>
      )}
    </div>
  );
};

/**
 * 表单字段组 - 用于组织多个表单字段
 */
export interface FormFieldGroupProps {
  children: React.ReactNode;
  className?: string;
  spacing?: 'compact' | 'default' | 'relaxed';
}

export const FormFieldGroup: React.FC<FormFieldGroupProps> = ({
  children,
  className,
  spacing = 'default',
}) => {
  const spacingClasses = {
    compact: 'space-y-3',
    default: 'space-y-4',
    relaxed: 'space-y-5',
  };

  return (
    <div className={cn(spacingClasses[spacing], className)}>
      {children}
    </div>
  );
};

