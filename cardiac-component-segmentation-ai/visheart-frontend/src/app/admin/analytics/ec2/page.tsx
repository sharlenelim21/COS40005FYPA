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
  ChevronUp
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
import { MetricData } from '@/types/system-monitor';
import { formatBytes } from '@/lib/format-utils';
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

// Threshold-based insights configuration
const METRIC_THRESHOLDS = {
  cpu: {
    low: { max: 30, label: 'Low utilization', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/10' },
    healthy: { min: 30, max: 70, label: 'Healthy performance', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/10' },
    moderate: { min: 70, max: 90, label: 'Moderate load', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/10' },
    high: { min: 90, label: 'High load - consider scaling', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/10' }
  },
  network: {
    low: { max: 1000000, label: 'Light traffic', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/10' }, // 1MB/s
    moderate: { min: 1000000, max: 10000000, label: 'Moderate traffic', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/10' }, // 1-10MB/s
    high: { min: 10000000, max: 50000000, label: 'Heavy traffic', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/10' }, // 10-50MB/s
    critical: { min: 50000000, label: 'Critical traffic - optimize network', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/10' } // >50MB/s
  },
  disk: {
    low: { max: 1000000, label: 'Low I/O activity', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/10' }, // 1MB/s
    moderate: { min: 1000000, max: 10000000, label: 'Moderate I/O activity', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/10' }, // 1-10MB/s
    high: { min: 10000000, max: 50000000, label: 'High I/O activity', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/10' }, // 10-50MB/s
    critical: { min: 50000000, label: 'Critical I/O - consider storage optimization', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/10' } // >50MB/s
  }
};

// Function to analyze metric values and provide insights
const analyzeMetric = (value: number, metricType: 'cpu' | 'network' | 'disk') => {
  const thresholds = METRIC_THRESHOLDS[metricType];

  for (const [level, config] of Object.entries(thresholds)) {
    const { min = -Infinity, max = Infinity, label, color, bgColor } = config as any;

    if (value >= min && value < max) {
      return {
        insight: label,
        color,
        bgColor,
        level: level as 'low' | 'healthy' | 'moderate' | 'high' | 'critical'
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

// Function to get metric display value with unit
const getMetricDisplayValue = (value: number, metricType: 'cpu' | 'network' | 'disk') => {
  switch (metricType) {
    case 'cpu':
      return `${value.toFixed(1)}%`;
    case 'network':
    case 'disk':
      return formatBytes(value);
    default:
      return value.toString();
  }
};

interface MetricState {
  data: MetricData | null;
  loading: boolean;
  error: string | null;
}

export default function EC2Analytics() {
  const pathname = usePathname();

  // EC2 metrics state
  const [cpuMetrics, setCpuMetrics] = useState<MetricState>({ data: null, loading: true, error: null });
  const [networkInMetrics, setNetworkInMetrics] = useState<MetricState>({ data: null, loading: true, error: null });
  const [networkOutMetrics, setNetworkOutMetrics] = useState<MetricState>({ data: null, loading: true, error: null });
  const [diskReadMetrics, setDiskReadMetrics] = useState<MetricState>({ data: null, loading: true, error: null });
  const [diskWriteMetrics, setDiskWriteMetrics] = useState<MetricState>({ data: null, loading: true, error: null });
  const [activeChart, setActiveChart] = useState<'cpu' | 'network' | 'disk'>('cpu');
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d'>('24h');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showThresholdInfo, setShowThresholdInfo] = useState(false);

  // Helper function to fetch metrics
  const fetchMetric = async (
    fetchFunction: () => Promise<MetricData | null>,
    setState: React.Dispatch<React.SetStateAction<MetricState>>,
    metricName: string
  ) => {
    try {
      const data = await fetchFunction();
      if (data) {
        setState({ data, loading: false, error: null });
      } else {
        setState({ data: null, loading: false, error: `Failed to load ${metricName} metrics` });
      }
    } catch (error) {
      setState({ data: null, loading: false, error: `Failed to load ${metricName} metrics` });
      console.error(`Error fetching ${metricName} metrics:`, error);
    }
  };

  useEffect(() => {
    // Fetch all EC2 metrics
    fetchMetric(analyticsApi.getCpuMetrics, setCpuMetrics, 'CPU Utilization');
    fetchMetric(analyticsApi.getNetworkInMetrics, setNetworkInMetrics, 'Network In');
    fetchMetric(analyticsApi.getNetworkOutMetrics, setNetworkOutMetrics, 'Network Out');
    fetchMetric(analyticsApi.getDiskReadMetrics, setDiskReadMetrics, 'Disk Read');
    fetchMetric(analyticsApi.getDiskWriteMetrics, setDiskWriteMetrics, 'Disk Write');
  }, []);

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

  const cpuStats = calculateStats(cpuMetrics.data);
  const networkInStats = calculateStats(networkInMetrics.data);
  const networkOutStats = calculateStats(networkOutMetrics.data);
  const diskReadStats = calculateStats(diskReadMetrics.data);
  const diskWriteStats = calculateStats(diskWriteMetrics.data);
  // Transform data for combined disk chart
  const transformCombinedDiskData = (readData: MetricData | null, writeData: MetricData | null) => {
    if (!readData || !readData.timestamps || !readData.values) return [];

    return readData.timestamps.map((timestamp, index) => ({
      timestamp: new Date(timestamp).toLocaleString(),
      diskRead: readData.values[index] || 0,
      diskWrite: writeData?.values[index] || 0,
      rawTimestamp: timestamp
    }));
  };

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
    { id: 'cpu', label: 'CPU Utilization', icon: Cpu, color: 'text-orange-500' },
    { id: 'network', label: 'Network Traffic', icon: Wifi, color: 'text-blue-500' },
    { id: 'disk', label: 'Disk I/O', icon: HardDriveIcon, color: 'text-green-500' }
  ];

  // Custom tooltip for charts
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-gray-900 text-white p-3 rounded-lg shadow-lg border border-gray-700">
          <p className="text-sm font-medium">{`Time: ${label}`}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {`${entry.name}: ${entry.value?.toFixed ? entry.value.toFixed(2) : entry.value}${entry.unit || ''}`}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

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
                  <Link
                    key={item.name}
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
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">CPU Utilization</span>
                    <span className="text-sm font-medium text-[#FF9900] group-hover:text-[#FF9900]/80">{cpuStats.current?.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">Network In</span>
                    <span className="text-sm font-medium text-green-400 group-hover:text-green-300">{formatBytes(networkInStats.current)}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">Network Out</span>
                    <span className="text-sm font-medium text-blue-400 group-hover:text-blue-300">{formatBytes(networkOutStats.current)}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">Disk Read</span>
                    <span className="text-sm font-medium text-purple-400 group-hover:text-purple-300">{formatBytes(diskReadStats.current)}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">Disk Write</span>
                    <span className="text-sm font-medium text-red-400 group-hover:text-red-300">{formatBytes(diskWriteStats.current)}</span>
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
                  <span className="text-gray-600 dark:text-gray-400">EC2</span>
                </li>
              </ol>
            </nav>

            {/* Header Section */}
            <div className="mb-8 px-4 sm:px-6 lg:px-8">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 transition-colors">EC2 Analytics</h1>
              <p className="text-gray-600 dark:text-gray-300 text-lg transition-colors mb-4">
                Monitor CPU utilization, network traffic, and disk I/O for EC2 instances with analytical insights.
              </p>

              {/* Threshold Explanation */}
              <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <button
                  onClick={() => setShowThresholdInfo(!showThresholdInfo)}
                  className="flex items-center justify-between w-full text-left"
                >
                  <div className="flex items-center gap-2">
                    <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                      Understanding Threshold-Based Insights
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
                      <strong>What are threshold-based insights?</strong> Instead of just showing raw metrics, our system analyzes your EC2 performance data against industry-standard thresholds to provide actionable insights about system health.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <h4 className="font-semibold text-blue-800 dark:text-blue-200 mb-2 flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-green-600" />
                          CPU Utilization Thresholds
                        </h4>
                        <ul className="space-y-1 text-xs">
                          <li><span className="font-medium text-blue-600">Low (≤30%):</span> Underutilized - consider rightsizing</li>
                          <li><span className="font-medium text-green-600">Healthy (30-70%):</span> Optimal performance range</li>
                          <li><span className="font-medium text-yellow-600">Moderate (70-90%):</span> Approaching capacity limits</li>
                          <li><span className="font-medium text-red-600">High (≥90%):</span> Critical - consider scaling up</li>
                        </ul>
                      </div>

                      <div>
                        <h4 className="font-semibold text-blue-800 dark:text-blue-200 mb-2 flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-blue-600" />
                          Network & Disk I/O Thresholds
                        </h4>
                        <ul className="space-y-1 text-xs">
                          <li><span className="font-medium text-blue-600">Light (≤1MB/s):</span> Normal background traffic</li>
                          <li><span className="font-medium text-green-600">Moderate (1-10MB/s):</span> Standard operational load</li>
                          <li><span className="font-medium text-yellow-600">Heavy (10-50MB/s):</span> High activity - monitor closely</li>
                          <li><span className="font-medium text-red-600">Critical (≥50MB/s):</span> Peak load - optimize or scale</li>
                        </ul>
                      </div>
                    </div>

                    <div className="bg-blue-100 dark:bg-blue-900/20 p-3 rounded-md">
                      <p className="text-xs">
                        <strong>Why these thresholds?</strong> Based on AWS best practices and industry standards. CPU thresholds follow AWS recommendations for EC2 instance utilization.
                        Network and disk thresholds are calibrated for typical web applications and data processing workloads.
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
                            ? 'bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800'
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
                      setIsRefreshing(true);
                      try {
                        // Refresh all metrics
                        await Promise.all([
                          fetchMetric(analyticsApi.getCpuMetrics, setCpuMetrics, 'CPU Utilization'),
                          fetchMetric(analyticsApi.getNetworkInMetrics, setNetworkInMetrics, 'Network In'),
                          fetchMetric(analyticsApi.getNetworkOutMetrics, setNetworkOutMetrics, 'Network Out'),
                          fetchMetric(analyticsApi.getDiskReadMetrics, setDiskReadMetrics, 'Disk Read'),
                          fetchMetric(analyticsApi.getDiskWriteMetrics, setDiskWriteMetrics, 'Disk Write')
                        ]);
                      } catch (error) {
                        console.error('Error refreshing metrics:', error);
                      } finally {
                        setIsRefreshing(false);
                      }
                    }}
                    disabled={isRefreshing}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                      isRefreshing
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
              {/* CPU Utilization Chart */}
              {activeChart === 'cpu' && (
                <div className="space-y-6">
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">CPU Utilization</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Percentage of CPU capacity being used</p>
                      </div>
                      <div className="text-right">
                        <div className={`text-2xl font-bold ${analyzeMetric(cpuStats.current, 'cpu').color}`}>
                          {getMetricDisplayValue(cpuStats.current, 'cpu')}
                        </div>
                        <div className={`text-sm ${analyzeMetric(cpuStats.current, 'cpu').color}`}>
                          {analyzeMetric(cpuStats.current, 'cpu').insight}
                        </div>
                      </div>
                    </div>

                    {cpuMetrics.loading ? (
                      <div className="h-80 flex items-center justify-center">
                        <div className="text-gray-500 dark:text-gray-400">Loading CPU metrics...</div>
                      </div>
                    ) : cpuMetrics.error ? (
                      <div className="h-80 flex items-center justify-center">
                        <div className="text-red-500 dark:text-red-400">{cpuMetrics.error}</div>
                      </div>
                    ) : (
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={transformDataForChart(cpuMetrics.data)}>
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
                              label={{ value: 'CPU %', angle: -90, position: 'insideLeft' }}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Area
                              type="monotone"
                              dataKey="value"
                              stroke="#F97316"
                              fill="#FED7AA"
                              fillOpacity={0.3}
                              strokeWidth={2}
                              name="CPU Utilization"
                              unit="%"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* CPU Stats Cards with Insights */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                      <div className={`p-4 rounded-lg text-center ${analyzeMetric(cpuStats.avg, 'cpu').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Average CPU</div>
                        <div className={`text-xl font-bold ${analyzeMetric(cpuStats.avg, 'cpu').color}`}>
                          {getMetricDisplayValue(cpuStats.avg, 'cpu')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeMetric(cpuStats.avg, 'cpu').color}`}>
                          {analyzeMetric(cpuStats.avg, 'cpu').insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeMetric(cpuStats.max, 'cpu').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Peak CPU</div>
                        <div className={`text-xl font-bold ${analyzeMetric(cpuStats.max, 'cpu').color}`}>
                          {getMetricDisplayValue(cpuStats.max, 'cpu')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeMetric(cpuStats.max, 'cpu').color}`}>
                          {analyzeMetric(cpuStats.max, 'cpu').insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeMetric(cpuStats.min, 'cpu').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Minimum CPU</div>
                        <div className={`text-xl font-bold ${analyzeMetric(cpuStats.min, 'cpu').color}`}>
                          {getMetricDisplayValue(cpuStats.min, 'cpu')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeMetric(cpuStats.min, 'cpu').color}`}>
                          {analyzeMetric(cpuStats.min, 'cpu').insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeMetric(cpuStats.current, 'cpu').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Current CPU</div>
                        <div className={`text-xl font-bold ${analyzeMetric(cpuStats.current, 'cpu').color}`}>
                          {getMetricDisplayValue(cpuStats.current, 'cpu')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeMetric(cpuStats.current, 'cpu').color}`}>
                          {analyzeMetric(cpuStats.current, 'cpu').insight}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Network Traffic Chart */}
              {activeChart === 'network' && (
                <div className="space-y-6">
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Network Traffic</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Inbound and outbound network traffic</p>
                      </div>
                    </div>

                    {networkInMetrics.loading || networkOutMetrics.loading ? (
                      <div className="h-80 flex items-center justify-center">
                        <div className="text-gray-500 dark:text-gray-400">Loading network metrics...</div>
                      </div>
                    ) : networkInMetrics.error || networkOutMetrics.error ? (
                      <div className="h-80 flex items-center justify-center">
                        <div className="text-red-500 dark:text-red-400">
                          {networkInMetrics.error || networkOutMetrics.error}
                        </div>
                      </div>
                    ) : (
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <RechartsLineChart data={transformDataForChart(networkInMetrics.data)}>
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
                              tickFormatter={(value) => formatBytes(value)}
                              label={{ value: 'Bytes', angle: -90, position: 'insideLeft' }}
                            />
                            <Tooltip
                              content={<CustomTooltip />}
                              formatter={(value: any) => [formatBytes(value), '']}
                            />
                            <Legend />
                            <Line
                              type="monotone"
                              dataKey="value"
                              stroke="#10B981"
                              strokeWidth={2}
                              name="Network In"
                              dot={false}
                            />
                            {/* Add Network Out data */}
                            {networkOutMetrics.data && (
                              <Line
                                type="monotone"
                                data={transformDataForChart(networkOutMetrics.data)}
                                dataKey="value"
                                stroke="#3B82F6"
                                strokeWidth={2}
                                name="Network Out"
                                dot={false}
                              />
                            )}
                          </RechartsLineChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* Network Stats Cards with Insights */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                      <div className={`p-4 rounded-lg text-center ${analyzeMetric(networkInStats.avg, 'network').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Network In (Avg)</div>
                        <div className={`text-xl font-bold ${analyzeMetric(networkInStats.avg, 'network').color}`}>
                          {getMetricDisplayValue(networkInStats.avg, 'network')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeMetric(networkInStats.avg, 'network').color}`}>
                          {analyzeMetric(networkInStats.avg, 'network').insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeMetric(networkOutStats.avg, 'network').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Network Out (Avg)</div>
                        <div className={`text-xl font-bold ${analyzeMetric(networkOutStats.avg, 'network').color}`}>
                          {getMetricDisplayValue(networkOutStats.avg, 'network')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeMetric(networkOutStats.avg, 'network').color}`}>
                          {analyzeMetric(networkOutStats.avg, 'network').insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeMetric(networkInStats.current, 'network').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Network In (Current)</div>
                        <div className={`text-xl font-bold ${analyzeMetric(networkInStats.current, 'network').color}`}>
                          {getMetricDisplayValue(networkInStats.current, 'network')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeMetric(networkInStats.current, 'network').color}`}>
                          {analyzeMetric(networkInStats.current, 'network').insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeMetric(networkOutStats.current, 'network').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Network Out (Current)</div>
                        <div className={`text-xl font-bold ${analyzeMetric(networkOutStats.current, 'network').color}`}>
                          {getMetricDisplayValue(networkOutStats.current, 'network')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeMetric(networkOutStats.current, 'network').color}`}>
                          {analyzeMetric(networkOutStats.current, 'network').insight}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Disk I/O Chart */}
              {activeChart === 'disk' && (
                <div className="space-y-6">
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Disk I/O Operations</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Read and write operations on disk</p>
                      </div>
                    </div>

                    {diskReadMetrics.loading || diskWriteMetrics.loading ? (
                      <div className="h-80 flex items-center justify-center">
                        <div className="text-gray-500 dark:text-gray-400">Loading disk metrics...</div>
                      </div>
                    ) : diskReadMetrics.error || diskWriteMetrics.error ? (
                      <div className="h-80 flex items-center justify-center">
                        <div className="text-red-500 dark:text-red-400">
                          {diskReadMetrics.error || diskWriteMetrics.error}
                        </div>
                      </div>
                    ) : (
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={transformCombinedDiskData(diskReadMetrics.data, diskWriteMetrics.data)}>
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
                              tickFormatter={(value) => formatBytes(value)}
                              label={{ value: 'Bytes', angle: -90, position: 'insideLeft' }}
                            />
                            <Tooltip
                              content={<CustomTooltip />}
                              formatter={(value: any) => [formatBytes(value), '']}
                            />
                            <Legend />
                            <Bar
                              dataKey="diskRead"
                              fill="#10B981"
                              name="Disk Read"
                              radius={[2, 2, 0, 0]}
                            />
                            <Bar
                              dataKey="diskWrite"
                              fill="#EF4444"
                              name="Disk Write"
                              radius={[2, 2, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* Disk Stats Cards with Insights */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                      <div className={`p-4 rounded-lg text-center ${analyzeMetric(diskReadStats.avg, 'disk').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Disk Read (Avg)</div>
                        <div className={`text-xl font-bold ${analyzeMetric(diskReadStats.avg, 'disk').color}`}>
                          {getMetricDisplayValue(diskReadStats.avg, 'disk')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeMetric(diskReadStats.avg, 'disk').color}`}>
                          {analyzeMetric(diskReadStats.avg, 'disk').insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeMetric(diskWriteStats.avg, 'disk').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Disk Write (Avg)</div>
                        <div className={`text-xl font-bold ${analyzeMetric(diskWriteStats.avg, 'disk').color}`}>
                          {getMetricDisplayValue(diskWriteStats.avg, 'disk')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeMetric(diskWriteStats.avg, 'disk').color}`}>
                          {analyzeMetric(diskWriteStats.avg, 'disk').insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeMetric(diskReadStats.current, 'disk').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Disk Read (Current)</div>
                        <div className={`text-xl font-bold ${analyzeMetric(diskReadStats.current, 'disk').color}`}>
                          {getMetricDisplayValue(diskReadStats.current, 'disk')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeMetric(diskReadStats.current, 'disk').color}`}>
                          {analyzeMetric(diskReadStats.current, 'disk').insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeMetric(diskWriteStats.current, 'disk').bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Disk Write (Current)</div>
                        <div className={`text-xl font-bold ${analyzeMetric(diskWriteStats.current, 'disk').color}`}>
                          {getMetricDisplayValue(diskWriteStats.current, 'disk')}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeMetric(diskWriteStats.current, 'disk').color}`}>
                          {analyzeMetric(diskWriteStats.current, 'disk').insight}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
