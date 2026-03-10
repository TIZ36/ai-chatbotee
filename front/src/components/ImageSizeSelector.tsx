/**
 * Image Size & Resolution Selector Component
 * 
 * Unified control for:
 * - Resolution quality (SD/HD/FHD/2K/4K)
 * - Aspect ratio (5 common presets)
 * - Number of images (1-4)
 * - Live size display (WIDTHxHEIGHT)
 */

import React from 'react';
import { Maximize2, Copy } from 'lucide-react';

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

const RESOLUTION_PRESETS = [
  { label: 'SD', size: 512, color: 'text-blue-400' },
  { label: 'HD', size: 768, color: 'text-cyan-400' },
  { label: 'FHD', size: 1024, color: 'text-green-400' },
  { label: '2K', size: 1536, color: 'text-amber-400' },
  { label: '4K', size: 2048, color: 'text-rose-400' },
];

const ASPECT_RATIOS = [
  { label: '1:1', ratio: 1, icon: '■' },
  { label: '4:3', ratio: 1.33, icon: '▭' },
  { label: '3:4', ratio: 0.75, icon: '▬' },
  { label: '16:9', ratio: 1.78, icon: '▬' },
  { label: '9:16', ratio: 0.56, icon: '▬' },
];

export const ImageSizeSelector: React.FC<ImageSizeSelectorProps> = ({ value, onChange, disabled }) => {
  const handleResolutionChange = (size: number) => {
    let newWidth = size;
    let newHeight = size;

    // Apply aspect ratio to calculate height
    if (value.aspectRatio !== '1:1') {
      const ratio = ASPECT_RATIOS.find(a => a.label === value.aspectRatio)?.ratio || 1;
      newHeight = Math.round(newWidth / ratio);
    }

    onChange({ ...value, width: newWidth, height: newHeight });
  };

  const handleAspectRatioChange = (label: string) => {
    let newWidth = value.width;
    let newHeight = value.width;

    const aspectItem = ASPECT_RATIOS.find(a => a.label === label);
    if (aspectItem && label !== '1:1') {
      newHeight = Math.round(newWidth / aspectItem.ratio);
    }

    onChange({ ...value, aspectRatio: label, height: newHeight });
  };

  const handleCountChange = (count: number) => {
    onChange({ ...value, count });
  };

  return (
    <div className="space-y-3 p-3 rounded-lg bg-white/5 border border-white/10">
      {/* Resolution Quality Selector */}
      <div className="space-y-2">
        <label className="text-[11px] font-semibold text-white/70 flex items-center gap-1.5">
          <Maximize2 className="w-3 h-3" />
          分辨率
        </label>
        <div className="flex gap-1.5 flex-wrap">
          {RESOLUTION_PRESETS.map((preset) => (
            <button
              key={preset.label}
              disabled={disabled}
              onClick={() => handleResolutionChange(preset.size)}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all
                ${value.width === preset.size
                  ? `${preset.color} bg-white/10 ring-1 ring-white/30 shadow-lg`
                  : 'text-white/50 hover:text-white/70 bg-white/5'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/10 cursor-pointer'}
              `}
              title={`${preset.size}px - ${preset.label}`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Aspect Ratio Selector */}
      <div className="space-y-2">
        <label className="text-[11px] font-semibold text-white/70">宽高比</label>
        <div className="flex gap-1.5 flex-wrap">
          {ASPECT_RATIOS.map((aspect) => (
            <button
              key={aspect.label}
              disabled={disabled}
              onClick={() => handleAspectRatioChange(aspect.label)}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all
                ${value.aspectRatio === aspect.label
                  ? 'text-blue-400 bg-blue-400/15 ring-1 ring-blue-400/50 shadow-md'
                  : 'text-white/50 hover:text-white/70 bg-white/5'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/10 cursor-pointer'}
              `}
              title={aspect.label}
            >
              {aspect.label}
            </button>
          ))}
        </div>
      </div>

      {/* Number of Images Selector */}
      <div className="space-y-2">
        <label className="text-[11px] font-semibold text-white/70">生成数量</label>
        <div className="flex gap-1 items-center">
          {[1, 2, 3, 4].map((num) => (
            <button
              key={num}
              disabled={disabled}
              onClick={() => handleCountChange(num)}
              className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-all
                ${value.count === num
                  ? 'text-purple-400 bg-purple-400/15 ring-1 ring-purple-400/50'
                  : 'text-white/50 hover:text-white/70 bg-white/5'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/10 cursor-pointer'}
              `}
            >
              {num}
            </button>
          ))}
        </div>
      </div>

      {/* Size Display */}
      <div className="flex items-center justify-between px-2 py-2 rounded bg-black/30 border border-white/10">
        <div className="flex items-center gap-2">
          <Copy className="w-3 h-3 text-white/40" />
          <span className="text-[10px] text-white/60">大小：</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] font-semibold text-cyan-400">
            {value.width} × {value.height}
          </span>
          <span className="text-[9px] text-white/40">px</span>
        </div>
      </div>
    </div>
  );
};
