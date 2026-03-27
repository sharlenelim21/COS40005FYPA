// File: src/lib/format-utils.ts
// Description: Utility functions for formatting data

/**
 * Format bytes into human-readable format (KB, MB, GB)
 * @param bytes - Number of bytes
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted string with appropriate unit
 */
export function formatBytes(bytes: number, decimals: number = 1): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Format percentage values with proper color coding class names
 * @param value - Percentage value
 * @returns CSS class name for color coding
 */
export function getCpuColorClass(value: number): string {
  if (value > 80) return 'text-red-600';
  if (value > 60) return 'text-yellow-600';
  return 'text-green-600';
}

/**
 * Format network/disk values for display
 * @param value - Value in bytes
 * @returns Formatted string with appropriate unit
 */
export function formatMetricValue(value: number, unit: 'bytes' | 'percentage' = 'bytes'): string {
  if (unit === 'percentage') {
    return `${value}%`;
  }
  return formatBytes(value);
}