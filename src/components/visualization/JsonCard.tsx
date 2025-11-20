
import React from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface JsonCardProps {
  data: any;
}

const JsonTree: React.FC<{ data: any; level?: number; label?: string }> = ({ data, level = 0, label }) => {
  const [isExpanded, setIsExpanded] = React.useState(level < 2); // Expand first 2 levels by default

  if (data === null || data === undefined) {
    return (
      <div className="flex items-start py-0.5 text-xs">
        {label && <span className="font-medium text-gray-600 dark:text-gray-400 mr-1.5">{label}:</span>}
        <span className="text-gray-400 italic">null</span>
      </div>
    );
  }

  if (typeof data !== 'object') {
     return (
      <div className="flex items-start py-0.5 text-xs">
        {label && <span className="font-medium text-gray-600 dark:text-gray-400 mr-1.5">{label}:</span>}
        <span className="text-gray-900 dark:text-gray-100 break-all">{String(data)}</span>
      </div>
    );
  }

  const isArray = Array.isArray(data);
  const keys = Object.keys(data);
  const isEmpty = keys.length === 0;

  return (
    <div className="py-0.5 text-xs">
      <div 
        className={`flex items-center cursor-pointer hover:text-primary-600 transition-colors ${level === 0 ? 'mb-1' : ''}`}
        onClick={() => !isEmpty && setIsExpanded(!isExpanded)}
      >
        {!isEmpty ? (
             isExpanded ? <ChevronDown className="w-3 h-3 mr-1 text-gray-400" /> : <ChevronRight className="w-3 h-3 mr-1 text-gray-400" />
        ) : <span className="w-3 h-3 mr-1" />}
        
        {label && <span className="font-medium text-gray-700 dark:text-gray-300 mr-1.5">{label}:</span>}
        
        <span className="text-[10px] text-gray-500 bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded leading-none">
            {isArray ? `Array(${keys.length})` : `Object{${keys.length}}`}
        </span>
      </div>

      {isExpanded && !isEmpty && (
        <div className="ml-1.5 pl-2 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
          {keys.map((key) => (
            <JsonTree 
                key={key} 
                data={data[key]} 
                level={level + 1} 
                label={isArray ? `[${key}]` : key} 
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const JsonCard: React.FC<JsonCardProps> = ({ data }) => {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 shadow-sm overflow-auto h-full text-xs">
      <JsonTree data={data} />
    </div>
  );
};
