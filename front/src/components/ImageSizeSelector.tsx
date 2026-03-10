/**
 * Image Size Selector Component
 * 宽高比 + 数量选择（分辨率已移除，当前模型不支持）
 */

import React from 'react';
import { Maximize2 } from 'lucide-react';

export interface ImageSizeConfig {
  width: number;
  height: number;
  aspectRatio: string;
  count: number;
}

interface ImageSizeSelectorProps {
  value: ImageSizeConfig;
  onChange: (config: ImageSizeConfig) => void;
  disabled?: boolean;
}

const ASPECT_RATIOS: { label: string; ratio: number; w: number; h: number }[] = [
  { label: '1:1', ratio: 1, w: 56, h: 56 },
  { label: '4:3', ratio: 1.33, w: 64, h: 48 },
  { label: '3:4', ratio: 0.75, w: 48, h: 64 },
  { label: '16:9', ratio: 1.78, w: 72, h: 40 },
  { label: '9:16', ratio: 0.56, w: 40, h: 72 },
];

const DEFAULT_SIZE = 1024;

export const ImageSizeSelector: React.FC<ImageSizeSelectorProps> = ({ value, onChange, disabled }) => {
  const handleAspectRatioChange = (label: string) => {
    const aspectItem = ASPECT_RATIOS.find(a => a.label === label);
    if (!aspectItem) return;
    const newWidth = DEFAULT_SIZE;
    const newHeight = label === '1:1' ? DEFAULT_SIZE : Math.round(newWidth / aspectItem.ratio);
    onChange({ ...value, aspectRatio: label, width: newWidth, height: newHeight });
  };

  const handleCountChange = (count: number) => {
    onChange({ ...value, count });
  };

  return (
    <div className="image-size-block rounded-2xl p-4 border border-[var(--border-default)]">
      <div className="flex items-center gap-2 mb-4">
        <Maximize2 className="w-5 h-5 text-[var(--color-accent)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">图片尺寸</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-start">
        {/* 宽高比：图示在上、文字置底 */}
        <div className="min-w-0">
          <div className="text-xs font-medium text-[var(--text-muted)] mb-2 h-5 flex items-center">宽高比</div>
          <div className="flex flex-wrap gap-2">
            {ASPECT_RATIOS.map((aspect) => {
              const isSelected = value.aspectRatio === aspect.label;
              return (
                <button
                  key={aspect.label}
                  disabled={disabled}
                  onClick={() => handleAspectRatioChange(aspect.label)}
                  className={`
                    flex flex-col items-center min-h-[100px] rounded-xl px-2 py-2 transition-all border w-[88px]
                    ${isSelected ? 'border-[var(--color-accent)] bg-[var(--color-accent-bg)] text-[var(--color-accent)]' : 'border-[var(--border-default)] bg-[var(--surface-primary)] text-[var(--text-secondary)] hover:border-[var(--color-accent)]/50'}
                    ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                  title={aspect.label}
                >
                  <div className="flex-1 flex items-center justify-center min-h-0">
                    <div
                      className="rounded-md border-2 border-current opacity-70 bg-current/10 flex-shrink-0"
                      style={{ width: aspect.w, height: aspect.h }}
                    />
                  </div>
                  <span className="text-[11px] font-medium leading-tight pt-1">{aspect.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 数量 */}
        <div className="min-w-0">
          <div className="text-xs font-medium text-[var(--text-muted)] mb-2 h-5 flex items-center">数量</div>
          <div className="flex gap-2">
            {[1, 2, 3, 4].map((num) => (
              <button
                key={num}
                disabled={disabled}
                onClick={() => handleCountChange(num)}
                className={`
                  w-10 h-10 rounded-xl text-sm font-bold transition-all border
                  ${value.count === num ? 'border-[var(--color-accent)] bg-[var(--color-accent-bg)] text-[var(--color-accent)]' : 'border-[var(--border-default)] bg-[var(--surface-primary)] text-[var(--text-secondary)] hover:border-[var(--color-accent)]/50'}
                  ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                {num}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
