import React, { useMemo } from 'react';
import { detectDataType, tryParseJson, extractUrl, isValidUrl } from '../../utils/dataParser';
import { JsonTable } from './JsonTable';
import { JsonCard } from './JsonCard';
import { UrlView } from './UrlView';
import { AlertCircle, Code } from 'lucide-react';

interface DataVisualizerProps {
  data: string;
  type?: 'json-object' | 'json-array' | 'weblink'; // User-configured type
}

export const DataVisualizer: React.FC<DataVisualizerProps> = ({ data, type }) => {
  const visualizationContent = useMemo(() => {
    if (!data) return null;

    const cleanData = data.trim();

    // Explicit type handling
    if (type === 'weblink') {
      const url = extractUrl(cleanData);
      if (url) {
        return <UrlView url={url} />;
      }
      return null; // Failed to extract URL for weblink type
    }

    if (type === 'json-object') {
      const json = tryParseJson(cleanData);
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        return <JsonCard data={json} />;
      }
      return null; // Failed to parse as JSON Object
    }

    if (type === 'json-array') {
      const json = tryParseJson(cleanData);
      if (json && Array.isArray(json)) {
        return <JsonTable data={json} />;
      }
      return null; // Failed to parse as JSON Array
    }

    // Auto detection if no specific type is forced
    const detectedType = detectDataType(cleanData);
    
    if (detectedType === 'weblink') {
      const url = extractUrl(cleanData);
      return url ? <UrlView url={url} /> : null;
    }

    if (detectedType === 'json-array') {
      const json = tryParseJson(cleanData);
      return json ? <JsonTable data={json} /> : null;
    }

    if (detectedType === 'json-object') {
      const json = tryParseJson(cleanData);
      return json ? <JsonCard data={json} /> : null;
    }

    return null;
  }, [data, type]);

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center p-4 text-gray-400 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 h-full">
        <div className="text-xs">等待数据...</div>
      </div>
    );
  }

  if (visualizationContent) {
    return visualizationContent;
  }

  // Fallback to raw text if no visualization could be rendered for the given type or auto-detection failed
  return (
    <div className="bg-gray-50 dark:bg-gray-900 p-2 rounded-lg border border-gray-200 dark:border-gray-700 overflow-auto h-full">
        <div className="flex items-center text-[10px] text-gray-500 mb-1">
            <Code className="w-3 h-3 mr-1" />
            <span>原始文本输出 (无法按指定格式解析)</span>
        </div>
        <pre className="text-[10px] font-mono whitespace-pre-wrap text-gray-700 dark:text-gray-300">
            {data}
        </pre>
    </div>
  );
};