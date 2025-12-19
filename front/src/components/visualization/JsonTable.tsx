
import React from 'react';
import { FileText } from 'lucide-react';

interface JsonTableProps {
  data: any[];
}

export const JsonTable: React.FC<JsonTableProps> = ({ data }) => {
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg">
        No data to display in table
      </div>
    );
  }

  // Collect all unique keys from all objects to form columns
  const allKeys = Array.from(
    new Set(
      data.reduce((keys: string[], item: any) => {
        if (typeof item === 'object' && item !== null) {
          return [...keys, ...Object.keys(item)];
        }
        return keys;
      }, [])
    )
  );

  // If plain array of primitives, handle differently
  const isPrimitiveArray = data.every(item => typeof item !== 'object' || item === null);

  if (isPrimitiveArray) {
    return (
       <div className="overflow-auto max-h-full border border-gray-200 dark:border-gray-700 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Value
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            {data.map((item, idx) => (
              <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="px-3 py-1.5 whitespace-nowrap text-xs text-gray-900 dark:text-gray-100">
                  {String(item)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const renderCell = (value: any) => {
    if (value === null || value === undefined) return <span className="text-gray-400">-</span>;
    if (typeof value === 'object') {
        // Simple object preview or stringify
        return (
            <div className="group relative">
                <span className="cursor-help underline decoration-dotted text-gray-500 dark:text-gray-400">
                    {Array.isArray(value) ? `Array(${value.length})` : 'Object'}
                </span>
                <div className="hidden group-hover:block absolute z-50 left-0 top-full mt-1 p-2 bg-gray-800 text-white text-[10px] rounded shadow-lg whitespace-pre max-w-xs overflow-auto">
                    {JSON.stringify(value, null, 2)}
                </div>
            </div>
        );
    }
    // Truncate long text
    const str = String(value);
    if (str.length > 100) {
         return <span title={str}>{str.substring(0, 100)}...</span>;
    }
    return str;
  };

  return (
    <div className="overflow-auto h-full border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
          <tr>
            <th className="w-8 px-2 py-1.5 text-center text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              #
            </th>
            {allKeys.map((key) => (
              <th
                key={key}
                className="px-3 py-1.5 text-left text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap"
              >
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
          {data.map((row, idx) => (
            <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
              <td className="px-2 py-1.5 whitespace-nowrap text-[10px] text-gray-400 text-center">
                {idx + 1}
              </td>
              {allKeys.map((key) => (
                <td key={`${idx}-${key}`} className="px-3 py-1.5 whitespace-nowrap text-xs text-gray-900 dark:text-gray-100">
                  {renderCell(row[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
