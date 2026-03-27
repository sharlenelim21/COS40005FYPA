'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Cloud,
  Database,
  HardDrive,
  Network,
  TrendingUp,
  DollarSign,
  Activity,
  Server,
  Container,
  Shield,
  Cpu,
  Wifi,
  HardDriveIcon,
  BarChart3,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Info,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Package,
  GitBranch,
  Zap,
  Database as DatabaseIcon,
  Upload,
  Download,
  FileText,
  Archive
} from 'lucide-react';
import {
  ResourceAmazonEC2Instance,
  ArchitectureServiceAmazonElasticContainerRegistry,
  ArchitectureServiceAmazonSimpleStorageService,
  ResourceElasticLoadBalancingApplicationLoadBalancer,
  ArchitectureServiceAWSAutoScaling,
  ArchitectureServiceAWSCostExplorer
} from 'aws-react-icons';
import { analyticsApi } from '@/lib/api';
import { MetricData, S3Metrics } from '@/types/system-monitor';
import {
  LineChart as RechartsLineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Cell,
  Pie
} from 'recharts';

// Threshold-based insights configuration for S3
const S3_THRESHOLDS = {
  bucketSize: {
    low: { max: 1073741824, label: 'Small bucket', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/10' }, // < 1GB
    moderate: { min: 1073741824, max: 10737418240, label: 'Medium bucket', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/10' }, // 1GB - 10GB
    high: { min: 10737418240, max: 107374182400, label: 'Large bucket', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/10' }, // 10GB - 100GB
    critical: { min: 107374182400, label: 'Very large bucket - monitor costs', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/10' } // > 100GB
  },
  objectCount: {
    low: { max: 1000, label: 'Few objects', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/10' },
    moderate: { min: 1000, max: 10000, label: 'Moderate objects', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/10' },
    high: { min: 10000, max: 100000, label: 'Many objects', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/10' },
    critical: { min: 100000, label: 'Massive object count - high storage costs', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/10' }
  },
  requests: {
    low: { max: 1000, label: 'Low activity', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/10' },
    moderate: { min: 1000, max: 10000, label: 'Moderate activity', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/10' },
    high: { min: 10000, max: 100000, label: 'High activity', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/10' },
    critical: { min: 100000, label: 'Very high activity - monitor costs', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/10' }
  }
};

// Function to analyze S3 metric values and provide insights
const analyzeS3Metric = (value: number, type: 'bucketSize' | 'objectCount' | 'requests') => {
  const thresholds = S3_THRESHOLDS[type];

  for (const [level, config] of Object.entries(thresholds)) {
    const { min = -Infinity, max = Infinity, label, color, bgColor } = config as any;

    if (value >= min && value < max) {
      return {
        insight: label,
        color,
        bgColor,
        level: level as 'low' | 'moderate' | 'high' | 'critical'
      };
    }
  }

  // Fallback for edge cases
  return {
    insight: 'Analyzing...',
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-50 dark:bg-gray-900/10',
    level: 'unknown' as const
  };
};

// Function to get S3 metric display value with unit
const getS3MetricDisplayValue = (value: number, type: 'bucketSize' | 'objectCount' | 'requests') => {
  if (type === 'bucketSize') {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  } else if (type === 'objectCount') {
    return value.toLocaleString();
  } else {
    return value.toLocaleString();
  }
};

interface S3MetricState {
  data: S3Metrics | null;
  loading: boolean;
  error: string | null;
}

interface BucketInfo {
  Name: string;
  CreationDate: Date;
}

export default function S3Analytics() {
  const pathname = usePathname();

  // S3 metrics state
  const [s3Metrics, setS3Metrics] = useState<S3MetricState>({ data: null, loading: true, error: null });
  const [buckets, setBuckets] = useState<BucketInfo[]>([]);
  const [bucketsLoading, setBucketsLoading] = useState(true);
  const [selectedBucket, setSelectedBucket] = useState<string>('');
  const [activeChart, setActiveChart] = useState<'storage' | 'requests'>('storage');
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d'>('24h');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showThresholdInfo, setShowThresholdInfo] = useState(false);

  // Helper function to fetch S3 metrics
  const fetchS3Metrics = async (bucketName: string) => {
    try {
      const data = await analyticsApi.getAllS3Metrics(bucketName);
      if (data) {
        setS3Metrics({ data, loading: false, error: null });
      } else {
        setS3Metrics({ data: null, loading: false, error: `Failed to load S3 metrics for bucket ${bucketName}` });
      }
    } catch (error) {
      setS3Metrics({ data: null, loading: false, error: `Failed to load S3 metrics for bucket ${bucketName}` });
      console.error(`Error fetching S3 metrics for ${bucketName}:`, error);
    }
  };

  // Fetch buckets on component mount
  useEffect(() => {
    const fetchBuckets = async () => {
      try {
        const data = await analyticsApi.getS3Buckets();
        if (data && data.buckets) {
          setBuckets(data.buckets);
          // Auto-select first bucket if available
          if (data.buckets.length > 0 && !selectedBucket) {
            setSelectedBucket(data.buckets[0].Name);
            fetchS3Metrics(data.buckets[0].Name);
          }
        }
      } catch (error) {
        console.error('Error fetching S3 buckets:', error);
      } finally {
        setBucketsLoading(false);
      }
    };

    fetchBuckets();
  }, []);

  // Fetch metrics when bucket changes
  useEffect(() => {
    if (selectedBucket) {
      fetchS3Metrics(selectedBucket);
    }
  }, [selectedBucket]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd + B to toggle sidebar
      if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
        event.preventDefault();
        setSidebarCollapsed(!sidebarCollapsed);
      }
      // Ctrl/Cmd + K to focus search
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault();
        const searchInput = document.querySelector('input[placeholder="Search services..."]') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
      }
      // Escape to clear search
      if (event.key === 'Escape' && searchQuery) {
        setSearchQuery('');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sidebarCollapsed, searchQuery]);

  // Transform data for recharts
  const transformDataForChart = (metric: MetricData | null) => {
    if (!metric || !metric.timestamps || !metric.values) return [];

    return metric.timestamps.map((timestamp, index) => ({
      timestamp: new Date(timestamp).toLocaleString(),
      value: metric.values[index] || 0,
      rawTimestamp: timestamp
    }));
  };

  // Transform request data for combined chart
  const transformRequestDataForChart = (allRequests: MetricData | null, getRequests: MetricData | null, putRequests: MetricData | null) => {
    if (!allRequests || !allRequests.timestamps || !getRequests || !putRequests) return [];

    return allRequests.timestamps.map((timestamp, index) => ({
      timestamp: new Date(timestamp).toLocaleString(),
      all: allRequests.values[index] || 0,
      get: getRequests.values[index] || 0,
      put: putRequests.values[index] || 0,
      rawTimestamp: timestamp
    }));
  };

  // Calculate summary statistics
  const calculateStats = (data: MetricData | null) => {
    if (!data || !data.values || data.values.length === 0) {
      return { avg: 0, max: 0, min: 0, current: 0 };
    }

    const values = data.values.filter(v => v !== null && v !== undefined);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const current = values[values.length - 1] || 0;

    return { avg, max, min, current };
  };

  const bucketSizeStats = calculateStats(s3Metrics.data?.bucketSizeBytes || null);
  const objectCountStats = calculateStats(s3Metrics.data?.numberOfObjects || null);
  const allRequestsStats = calculateStats(s3Metrics.data?.allRequests || null);
  const getRequestsStats = calculateStats(s3Metrics.data?.getRequests || null);
  const putRequestsStats = calculateStats(s3Metrics.data?.putRequests || null);

  const navItems = [
    { name: 'EC2', path: '/admin/analytics/ec2', active: pathname === '/admin/analytics/ec2', icon: ResourceAmazonEC2Instance, color: 'text-orange-400' },
    { name: 'ECR', path: '/admin/analytics/ecr', active: pathname === '/admin/analytics/ecr', icon: ArchitectureServiceAmazonElasticContainerRegistry, color: 'text-blue-400' },
    { name: 'S3', path: '/admin/analytics/s3', active: pathname === '/admin/analytics/s3', icon: ArchitectureServiceAmazonSimpleStorageService, color: 'text-green-400' },
    { name: 'ALB', path: '/admin/analytics/alb', active: pathname === '/admin/analytics/alb', icon: ResourceElasticLoadBalancingApplicationLoadBalancer, color: 'text-purple-400' },
    { name: 'ASG', path: '/admin/analytics/asg', active: pathname === '/admin/analytics/asg', icon: ArchitectureServiceAWSAutoScaling, color: 'text-red-400' },
    { name: 'Cost Metrics', path: '/admin/analytics/cost', active: pathname === '/admin/analytics/cost', icon: ArchitectureServiceAWSCostExplorer, color: 'text-yellow-400' },
  ];

  // Filter navigation items based on search query
  const filteredNavItems = navItems.filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Chart tabs
  const chartTabs = [
    { id: 'storage', label: 'Storage Metrics', icon: DatabaseIcon, color: 'text-blue-500' },
    { id: 'requests', label: 'Request Metrics', icon: BarChart3, color: 'text-green-500' }
  ];

  // Custom tooltip for charts
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-gray-900 text-white p-3 rounded-lg shadow-lg border border-gray-700">
          <p className="text-sm font-medium">{`Time: ${label}`}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {`${entry.name}: ${entry.value?.toLocaleString?.() || entry.value}`}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Pie chart data for request breakdown
  const requestBreakdownData = [
    { name: 'GET Requests', value: getRequestsStats.current, color: '#3B82F6' },
    { name: 'PUT Requests', value: putRequestsStats.current, color: '#10B981' },
    { name: 'Other Requests', value: Math.max(0, allRequestsStats.current - getRequestsStats.current - putRequestsStats.current), color: '#F59E0B' }
  ].filter(item => item.value > 0);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
      {/* AWS-style Header */}
      <div className="bg-[#1A202C] dark:bg-[#1A202C] text-white shadow-lg -mt-8 transition-colors border-b border-gray-200 dark:border-[#2D3748]">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <div className="flex items-center space-x-4">
              <Cloud className="h-10 w-10 text-[#FF9900]" />
              <div>
                <h1 className="text-xl font-semibold text-white dark:text-gray-100">Amazon Web Services | Analytics Dashboard</h1>
                <p className="text-sm text-gray-300 dark:text-gray-400">Powered by CloudWatch integration</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex">
        {/* Enhanced Interactive AWS-style Sidebar */}
        <div className={`bg-[#1A202C] dark:bg-[#1A202C] text-white min-h-screen shadow-xl transition-all duration-300 border-r border-gray-200 dark:border-[#2D3748] relative ${
          sidebarCollapsed ? 'w-16' : 'w-64'
        }`}>
          {/* Sidebar Toggle Button */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="absolute -right-3 top-6 bg-[#FF9900] hover:bg-[#FF9900]/80 text-[#232F3E] p-1.5 rounded-full shadow-lg transition-all duration-300 hover:scale-110 z-50"
            title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>

          <div className="p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className={`flex items-center space-x-2 ${sidebarCollapsed ? 'justify-center' : ''}`}>
                <Activity className="h-5 w-5 text-[#FF9900]" />
                {!sidebarCollapsed && (
                  <h2 className="text-lg font-semibold text-white dark:text-gray-100">Services</h2>
                )}
              </div>
            </div>

            {/* Search Bar */}
            {!sidebarCollapsed && (
              <div className="mb-4 relative">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search services..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-8 py-2 bg-gray-800 dark:bg-[#212B36] border border-gray-700 dark:border-[#2D3748] rounded-md text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#FF9900] focus:border-transparent transition-colors"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Navigation */}
            <nav className="space-y-1">
              {filteredNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.name} className="relative">
                    <Link
                      href={item.path}
                      className={`group flex items-center px-3 py-2 text-base font-medium rounded-md transition-all duration-300 relative overflow-hidden ${
                        item.active
                          ? 'bg-[#FF9900] text-[#232F3E] dark:text-[#0F1419] shadow-lg transform scale-[1.02]'
                          : 'text-gray-300 dark:text-gray-300 hover:bg-gray-700 dark:hover:bg-[#2D3748] hover:text-white dark:hover:text-white hover:shadow-md hover:transform hover:translate-x-1'
                      }`}
                      title={`${item.name} Analytics - ${item.active ? 'Currently viewing' : 'Click to navigate'}`}
                    >
                      {/* Hover background effect */}
                      <div className={`absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent transform -translate-x-full group-hover:translate-x-full transition-transform duration-700 ${
                        item.active ? 'opacity-0' : ''
                      }`}></div>

                      <Icon className={`mr-3 h-5 w-5 transition-all duration-300 relative z-10 ${
                        item.active
                          ? 'text-[#232F3E] dark:text-[#0F1419] transform scale-110'
                          : `${item.color} group-hover:transform group-hover:scale-110`
                      }`} />
                      {!sidebarCollapsed && <span className="relative z-10">{item.name}</span>}

                      {/* Active indicator with pulse */}
                      {item.active && (
                        <div className="ml-auto relative">
                          <div className="w-2 h-2 bg-[#232F3E] dark:bg-[#0F1419] rounded-full animate-pulse"></div>
                          <div className="absolute inset-0 w-2 h-2 bg-[#232F3E] dark:bg-[#0F1419] rounded-full animate-ping opacity-75"></div>
                        </div>
                      )}

                      {/* Hover indicator */}
                      {!item.active && !sidebarCollapsed && (
                        <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          <svg className="w-4 h-4 text-gray-400 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      )}
                    </Link>
                  </div>
                );
              })}
            </nav>

            {/* No Results Message */}
            {!sidebarCollapsed && filteredNavItems.length === 0 && searchQuery && (
              <div className="mt-4 p-3 bg-gray-800 dark:bg-[#212B36] rounded-lg border border-gray-700 dark:border-[#2D3748] text-center">
                <Search className="h-8 w-8 text-gray-500 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No services found</p>
                <p className="text-xs text-gray-500 mt-1">Try a different search term</p>
              </div>
            )}

            {/* Quick Stats */}
            {!sidebarCollapsed && (
              <div className="mt-10 space-y-3">
                <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-3">Quick Stats</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">
                      <span className="text-green-400 font-medium">S3</span> | Bucket Size
                    </span>
                    <span className="text-sm font-medium text-green-400 group-hover:text-green-300">{getS3MetricDisplayValue(bucketSizeStats.current, 'bucketSize')}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">
                      <span className="text-blue-400 font-medium">S3</span> | Objects
                    </span>
                    <span className="text-sm font-medium text-blue-400 group-hover:text-blue-300">{getS3MetricDisplayValue(objectCountStats.current, 'objectCount')}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">
                      <span className="text-purple-400 font-medium">S3</span> | Requests
                    </span>
                    <span className="text-sm font-medium text-purple-400 group-hover:text-purple-300">{getS3MetricDisplayValue(allRequestsStats.current, 'requests')}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className={`flex-1 transition-all duration-300 ${sidebarCollapsed ? 'ml-0' : 'ml-0'}`}>
          <div className="w-full">
            {/* Breadcrumb */}
            <nav className="flex mb-6 mt-6 px-4 sm:px-6 lg:px-8" aria-label="Breadcrumb">
              <ol className="flex items-center space-x-2">
                <li>
                  <Link href="/admin" className="text-[#FF9900] hover:text-[#FF9900]/80 transition-colors">
                    Admin
                  </Link>
                </li>
                <li className="flex items-center">
                  <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 mx-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="text-gray-600 dark:text-gray-400">AWS Analytics Dashboard</span>
                </li>
                <li className="flex items-center">
                  <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 mx-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="text-gray-600 dark:text-gray-400">S3</span>
                </li>
              </ol>
            </nav>

            {/* Header Section */}
            <div className="mb-8 px-4 sm:px-6 lg:px-8">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 transition-colors">S3 Analytics</h1>
              <p className="text-gray-600 dark:text-gray-300 text-lg transition-colors mb-4">
                Monitor Amazon S3 bucket storage, object counts, and request patterns with analytical insights.
              </p>

              {/* Bucket Selection */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Select S3 Bucket
                </label>
                {bucketsLoading ? (
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#FF9900]"></div>
                    <span className="text-sm text-gray-500 dark:text-gray-400">Loading buckets...</span>
                  </div>
                ) : (
                  <select
                    value={selectedBucket}
                    onChange={(e) => setSelectedBucket(e.target.value)}
                    className="block w-full max-w-md px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-[#FF9900] focus:border-[#FF9900] bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="">Select a bucket...</option>
                    {buckets.map((bucket) => (
                      <option key={bucket.Name} value={bucket.Name}>
                        {bucket.Name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Threshold Explanation */}
              <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <button
                  onClick={() => setShowThresholdInfo(!showThresholdInfo)}
                  className="flex items-center justify-between w-full text-left"
                >
                  <div className="flex items-center gap-2">
                    <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                      Understanding S3 Storage and Request Insights
                    </span>
                  </div>
                  {showThresholdInfo ? (
                    <ChevronUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  )}
                </button>

                {showThresholdInfo && (
                  <div className="mt-4 space-y-4 text-sm text-blue-700 dark:text-blue-300">
                    <p>
                      <strong>What are S3 insights?</strong> These metrics help you understand your storage usage patterns, object counts, and request activity to optimize costs and performance.
                    </p>

                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <h4 className="font-semibold text-blue-800 dark:text-blue-200 mb-2 flex items-center gap-2">
                          <DatabaseIcon className="h-4 w-4 text-blue-600" />
                          Storage Size Thresholds
                        </h4>
                        <ul className="space-y-1 text-xs">
                          <li><span className="font-medium text-blue-600">Small bucket (≤1GB):</span> Minimal storage usage</li>
                          <li><span className="font-medium text-green-600">Medium bucket (1-10GB):</span> Standard storage needs</li>
                          <li><span className="font-medium text-yellow-600">Large bucket (10-100GB):</span> Significant storage - monitor costs</li>
                          <li><span className="font-medium text-red-600">Very large bucket (≥100GB):</span> High storage costs - optimize or archive</li>
                        </ul>
                      </div>

                      <div>
                        <h4 className="font-semibold text-blue-800 dark:text-blue-200 mb-2 flex items-center gap-2">
                          <FileText className="h-4 w-4 text-blue-600" />
                          Object Count Thresholds
                        </h4>
                        <ul className="space-y-1 text-xs">
                          <li><span className="font-medium text-blue-600">Few objects (≤1K):</span> Small dataset</li>
                          <li><span className="font-medium text-green-600">Moderate objects (1K-10K):</span> Growing dataset</li>
                          <li><span className="font-medium text-yellow-600">Many objects (10K-100K):</span> Large dataset - consider organization</li>
                          <li><span className="font-medium text-red-600">Massive count (≥100K):</span> Very large dataset - high management costs</li>
                        </ul>
                      </div>

                      <div>
                        <h4 className="font-semibold text-blue-800 dark:text-blue-200 mb-2 flex items-center gap-2">
                          <BarChart3 className="h-4 w-4 text-blue-600" />
                          Request Activity Thresholds
                        </h4>
                        <ul className="space-y-1 text-xs">
                          <li><span className="font-medium text-blue-600">Low activity (≤1K requests):</span> Minimal usage</li>
                          <li><span className="font-medium text-green-600">Moderate activity (1K-10K):</span> Standard usage</li>
                          <li><span className="font-medium text-yellow-600">High activity (10K-100K):</span> Frequent access - monitor costs</li>
                          <li><span className="font-medium text-red-600">Very high activity (≥100K):</span> Heavy usage - significant costs</li>
                        </ul>
                      </div>
                    </div>

                    <div className="bg-blue-100 dark:bg-blue-900/20 p-3 rounded-md">
                      <p className="text-xs">
                        <strong>Why monitor S3 metrics?</strong> S3 charges for storage, requests, and data transfer. Understanding usage patterns helps optimize costs and performance.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="mb-6 px-4 sm:px-6 lg:px-8">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="flex gap-2">
                  {chartTabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveChart(tab.id as any)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                          activeChart === tab.id
                            ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!selectedBucket) return;
                      setIsRefreshing(true);
                      try {
                        await fetchS3Metrics(selectedBucket);
                      } catch (error) {
                        console.error('Error refreshing S3 metrics:', error);
                      } finally {
                        setIsRefreshing(false);
                      }
                    }}
                    disabled={isRefreshing || !selectedBucket}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                      isRefreshing || !selectedBucket
                        ? 'bg-blue-400 cursor-not-allowed opacity-75'
                        : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
                    } text-white`}
                  >
                    <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                    {isRefreshing ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
              </div>
            </div>

            {/* Charts Section */}
            <div className="px-4 sm:px-6 lg:px-8">
              {/* Storage Metrics Chart */}
              {activeChart === 'storage' && selectedBucket && (
                <div className="space-y-6">
                  {/* Bucket Size Chart */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Bucket Size Over Time</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Storage size for bucket: {selectedBucket}</p>
                      </div>
                      <div className="text-right">
                        <div className={`text-2xl font-bold ${analyzeS3Metric(bucketSizeStats.current, 'bucketSize').color}`}>
                          {getS3MetricDisplayValue(bucketSizeStats.current, 'bucketSize')}
                        </div>
                        <div className={`text-sm ${analyzeS3Metric(bucketSizeStats.current, 'bucketSize').color}`}>
                          {analyzeS3Metric(bucketSizeStats.current, 'bucketSize').insight}
                        </div>
                      </div>
                    </div>

                    {s3Metrics.loading ? (
                      <div className="h-80 flex items-center justify-center">
                        <div className="text-gray-500 dark:text-gray-400">Loading storage metrics...</div>
                      </div>
                    ) : s3Metrics.error ? (
                      <div className="h-80 flex items-center justify-center">
                        <div className="text-red-500 dark:text-red-400">{s3Metrics.error}</div>
                      </div>
                    ) : (
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={transformDataForChart(s3Metrics.data?.bucketSizeBytes || null)}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis
                              dataKey="timestamp"
                              stroke="#6B7280"
                              fontSize={12}
                              tickFormatter={(value) => new Date(value).toLocaleTimeString()}
                            />
                            <YAxis
                              stroke="#6B7280"
                              fontSize={12}
                              tickFormatter={(value) => {
                                const units = ['B', 'KB', 'MB', 'GB', 'TB'];
                                let size = value;
                                let unitIndex = 0;
                                while (size >= 1024 && unitIndex < units.length - 1) {
                                  size /= 1024;
                                  unitIndex++;
                                }
                                return `${size.toFixed(0)}${units[unitIndex]}`;
                              }}
                              label={{ value: 'Size', angle: -90, position: 'insideLeft' }}
                            />
                            <Tooltip
                              content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                  return (
                                    <div className="bg-gray-900 text-white p-3 rounded-lg shadow-lg border border-gray-700">
                                      <p className="text-sm font-medium">{`Time: ${label}`}</p>
                                      <p className="text-sm" style={{ color: '#3B82F6' }}>
                                        {`Size: ${getS3MetricDisplayValue(payload[0].value as number, 'bucketSize')}`}
                                      </p>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            <Area
                              type="monotone"
                              dataKey="value"
                              stroke="#3B82F6"
                              fill="#93C5FD"
                              fillOpacity={0.3}
                              strokeWidth={2}
                              name="Bucket Size"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* Bucket Size Stats Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                      <div className={`p-4 rounded-lg text-center ${analyzeS3Metric(bucketSizeStats.avg, 'bucketSize').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Average Size</div>
                        <div className={`text-xl font-bold ${analyzeS3Metric(bucketSizeStats.avg, 'bucketSize').color}`}>
                          {getS3MetricDisplayValue(bucketSizeStats.avg, 'bucketSize')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeS3Metric(bucketSizeStats.avg, 'bucketSize').color}`}>
                          {analyzeS3Metric(bucketSizeStats.avg, 'bucketSize').insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeS3Metric(bucketSizeStats.max, 'bucketSize').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Peak Size</div>
                        <div className={`text-xl font-bold ${analyzeS3Metric(bucketSizeStats.max, 'bucketSize').color}`}>
                          {getS3MetricDisplayValue(bucketSizeStats.max, 'bucketSize')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeS3Metric(bucketSizeStats.max, 'bucketSize').color}`}>
                          {analyzeS3Metric(bucketSizeStats.max, 'bucketSize').insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeS3Metric(objectCountStats.current, 'objectCount').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Total Objects</div>
                        <div className={`text-xl font-bold ${analyzeS3Metric(objectCountStats.current, 'objectCount').color}`}>
                          {getS3MetricDisplayValue(objectCountStats.current, 'objectCount')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeS3Metric(objectCountStats.current, 'objectCount').color}`}>
                          {analyzeS3Metric(objectCountStats.current, 'objectCount').insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeS3Metric(bucketSizeStats.current, 'bucketSize').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Current Size</div>
                        <div className={`text-xl font-bold ${analyzeS3Metric(bucketSizeStats.current, 'bucketSize').color}`}>
                          {getS3MetricDisplayValue(bucketSizeStats.current, 'bucketSize')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeS3Metric(bucketSizeStats.current, 'bucketSize').color}`}>
                          {analyzeS3Metric(bucketSizeStats.current, 'bucketSize').insight}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Request Metrics Chart */}
              {activeChart === 'requests' && selectedBucket && (
                <div className="space-y-6">
                  {/* Request Activity Chart */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Request Activity Over Time</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Request patterns for bucket: {selectedBucket}</p>
                      </div>
                      <div className="text-right">
                        <div className={`text-2xl font-bold ${analyzeS3Metric(allRequestsStats.current, 'requests').color}`}>
                          {getS3MetricDisplayValue(allRequestsStats.current, 'requests')}
                        </div>
                        <div className={`text-sm ${analyzeS3Metric(allRequestsStats.current, 'requests').color}`}>
                          {analyzeS3Metric(allRequestsStats.current, 'requests').insight}
                        </div>
                      </div>
                    </div>

                    {s3Metrics.loading ? (
                      <div className="h-80 flex items-center justify-center">
                        <div className="text-gray-500 dark:text-gray-400">Loading request metrics...</div>
                      </div>
                    ) : s3Metrics.error ? (
                      <div className="h-80 flex items-center justify-center">
                        <div className="text-red-500 dark:text-red-400">{s3Metrics.error}</div>
                      </div>
                    ) : (
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={transformRequestDataForChart(
                            s3Metrics.data?.allRequests || null,
                            s3Metrics.data?.getRequests || null,
                            s3Metrics.data?.putRequests || null
                          )}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis
                              dataKey="timestamp"
                              stroke="#6B7280"
                              fontSize={12}
                              tickFormatter={(value) => new Date(value).toLocaleTimeString()}
                            />
                            <YAxis
                              stroke="#6B7280"
                              fontSize={12}
                              label={{ value: 'Requests', angle: -90, position: 'insideLeft' }}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Area
                              type="monotone"
                              dataKey="get"
                              stackId="1"
                              stroke="#3B82F6"
                              fill="#3B82F6"
                              fillOpacity={0.6}
                              strokeWidth={2}
                              name="GET Requests"
                            />
                            <Area
                              type="monotone"
                              dataKey="put"
                              stackId="1"
                              stroke="#10B981"
                              fill="#10B981"
                              fillOpacity={0.6}
                              strokeWidth={2}
                              name="PUT Requests"
                            />
                            <Area
                              type="monotone"
                              dataKey="all"
                              stackId="2"
                              stroke="#F59E0B"
                              fill="#F59E0B"
                              fillOpacity={0.3}
                              strokeWidth={2}
                              name="Total Requests"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* Request Stats Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                      <div className={`p-4 rounded-lg text-center ${analyzeS3Metric(allRequestsStats.avg, 'requests').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Average Requests</div>
                        <div className={`text-xl font-bold ${analyzeS3Metric(allRequestsStats.avg, 'requests').color}`}>
                          {getS3MetricDisplayValue(allRequestsStats.avg, 'requests')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeS3Metric(allRequestsStats.avg, 'requests').color}`}>
                          {analyzeS3Metric(allRequestsStats.avg, 'requests').insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeS3Metric(allRequestsStats.max, 'requests').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Peak Requests</div>
                        <div className={`text-xl font-bold ${analyzeS3Metric(allRequestsStats.max, 'requests').color}`}>
                          {getS3MetricDisplayValue(allRequestsStats.max, 'requests')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeS3Metric(allRequestsStats.max, 'requests').color}`}>
                          {analyzeS3Metric(allRequestsStats.max, 'requests').insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeS3Metric(getRequestsStats.current, 'requests').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">GET Requests</div>
                        <div className={`text-xl font-bold ${analyzeS3Metric(getRequestsStats.current, 'requests').color}`}>
                          {getS3MetricDisplayValue(getRequestsStats.current, 'requests')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeS3Metric(getRequestsStats.current, 'requests').color}`}>
                          Current GET activity
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeS3Metric(putRequestsStats.current, 'requests').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">PUT Requests</div>
                        <div className={`text-xl font-bold ${analyzeS3Metric(putRequestsStats.current, 'requests').color}`}>
                          {getS3MetricDisplayValue(putRequestsStats.current, 'requests')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeS3Metric(putRequestsStats.current, 'requests').color}`}>
                          Current PUT activity
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Request Breakdown Pie Chart */}
                  {requestBreakdownData.length > 0 && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Request Type Breakdown</h3>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Distribution of request types for the current period</p>
                        </div>
                      </div>

                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <RechartsPieChart>
                            <Pie
                              data={requestBreakdownData}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              label={({ name, percent }) => `${name} ${((percent as number) * 100).toFixed(0)}%`}
                              outerRadius={80}
                              fill="#8884d8"
                              dataKey="value"
                            >
                              {requestBreakdownData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip />
                          </RechartsPieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* No bucket selected message */}
              {!selectedBucket && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
                  <DatabaseIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No Bucket Selected</h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    Please select an S3 bucket from the dropdown above to view analytics and metrics.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}