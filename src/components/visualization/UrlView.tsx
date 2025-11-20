
import React from 'react';
import { ExternalLink, Globe } from 'lucide-react';

interface UrlViewProps {
  url: string;
  title?: string;
}

export const UrlView: React.FC<UrlViewProps> = ({ url, title }) => {
  // Ensure URL has protocol
  const safeUrl = url.startsWith('http') ? url : `https://${url}`;

  return (
    <div className="flex flex-col h-full w-full border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between px-2 py-1 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-1.5 text-xs text-gray-600 dark:text-gray-300 truncate">
          <Globe className="w-3 h-3" />
          <span className="truncate max-w-[250px]" title={safeUrl}>{title || safeUrl}</span>
        </div>
        <a 
          href={safeUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 transition-colors"
          title="Open in new tab"
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      <div className="flex-1 bg-gray-100 dark:bg-gray-900 relative">
        <iframe
          src={safeUrl}
          className="absolute inset-0 w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          loading="lazy"
          title={title || "Embedded Content"}
        />
      </div>
    </div>
  );
};
