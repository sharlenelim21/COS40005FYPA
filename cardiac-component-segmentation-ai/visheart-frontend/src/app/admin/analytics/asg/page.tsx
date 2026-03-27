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
  Users,
  Settings,
  Zap,
  Clock,
  AlertCircle,
  Heart,
  HeartHandshake
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

// Custom tick component for X-axis with date above time
const CustomXAxisTick = (props: any) => {
  const { x, y, payload } = props;
  const date = new Date(payload.value);

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={10}
        textAnchor="middle"
        className="text-xs fill-gray-600 dark:fill-gray-400"
      >
        {date.toLocaleDateString()}
      </text>
      <text
        x={0}
        y={30}
        textAnchor="middle"
        className="text-xs fill-gray-500 dark:fill-gray-500"
      >
        {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </text>
    </g>
  );
};

// Threshold-based insights configuration for ASG
const ASG_THRESHOLDS = {
  capacity: {
    low: { max: 2, label: 'Low capacity - consider increasing min size', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/10' },
    optimal: { min: 2, max: 10, label: 'Optimal capacity range', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/10' },
    high: { min: 10, max: 20, label: 'High capacity - monitor scaling policies', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/10' },
    critical: { min: 20, label: 'Very high capacity - review scaling configuration', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/10' }
  },
  instances: {
    low: { max: 1, label: 'Minimal instances running', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/10' },
    healthy: { min: 1, max: 5, label: 'Healthy instance count', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/10' },
    busy: { min: 5, max: 15, label: 'High instance utilization', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/10' },
    overloaded: { min: 15, label: 'Overloaded - scale out immediately', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/10' }
  },
  pending: {
    none: { max: 0, label: 'No pending instances', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/10' },
    scaling: { min: 1, max: 3, label: 'Active scaling in progress', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/10' },
    high: { min: 3, max: 5, label: 'High pending count - monitor closely', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/10' },
    critical: { min: 5, label: 'Critical pending count - investigate scaling issues', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/10' }
  }
};

// Function to analyze metric values and provide insights
const analyzeMetric = (value: number, metricType: 'capacity' | 'instances' | 'pending') => {
  const thresholds = ASG_THRESHOLDS[metricType];

  for (const [level, config] of Object.entries(thresholds)) {
    const { min = -Infinity, max = Infinity, label, color, bgColor } = config as any;

    if (value >= min && value < max) {
      return {
        insight: label,
        color,
        bgColor,
        level: level as 'low' | 'optimal' | 'high' | 'critical' | 'healthy' | 'busy' | 'overloaded' | 'none' | 'scaling'
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
const getMetricDisplayValue = (value: number, metricType: 'capacity' | 'instances' | 'pending') => {
  switch (metricType) {
    case 'capacity':
    case 'instances':
    case 'pending':
      return `${value.toFixed(0)} instances`;
    default:
      return value.toString();
  }
};

interface MetricState {
  data: MetricData | null;
  loading: boolean;
  error: string | null;
}

export default function ASGAnalytics() {
  const pathname = usePathname();

  // ASG metrics state
  const [minSizeMetrics, setMinSizeMetrics] = useState<MetricState>({ data: null, loading: true, error: null });
  const [maxSizeMetrics, setMaxSizeMetrics] = useState<MetricState>({ data: null, loading: true, error: null });
  const [desiredCapacityMetrics, setDesiredCapacityMetrics] = useState<MetricState>({ data: null, loading: true, error: null });
  const [inServiceMetrics, setInServiceMetrics] = useState<MetricState>({ data: null, loading: true, error: null });
  const [pendingMetrics, setPendingMetrics] = useState<MetricState>({ data: null, loading: true, error: null });
  const [totalMetrics, setTotalMetrics] = useState<MetricState>({ data: null, loading: true, error: null });
  const [activeChart, setActiveChart] = useState<'capacity' | 'instances' | 'scaling'>('capacity');
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
    // Fetch all ASG metrics
    fetchMetric(analyticsApi.getASGGroupMinSizeMetrics, setMinSizeMetrics, 'Min Size');
    fetchMetric(analyticsApi.getASGGroupMaxSizeMetrics, setMaxSizeMetrics, 'Max Size');
    fetchMetric(analyticsApi.getASGGroupDesiredCapacityMetrics, setDesiredCapacityMetrics, 'Desired Capacity');
    fetchMetric(analyticsApi.getASGGroupInServiceInstancesMetrics, setInServiceMetrics, 'In Service Instances');
    fetchMetric(analyticsApi.getASGGroupPendingInstancesMetrics, setPendingMetrics, 'Pending Instances');
    fetchMetric(analyticsApi.getASGGroupTotalInstancesMetrics, setTotalMetrics, 'Total Instances');
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
      date: new Date(timestamp).toLocaleDateString(),
      time: new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value: metric.values[index] || 0,
      rawTimestamp: timestamp
    }));
  };

  // Transform data for combined capacity chart
  const transformCapacityData = (minSize: MetricData | null, maxSize: MetricData | null, desired: MetricData | null) => {
    if (!minSize || !minSize.timestamps) return [];

    return minSize.timestamps.map((timestamp, index) => ({
      timestamp: new Date(timestamp).toLocaleString(),
      date: new Date(timestamp).toLocaleDateString(),
      time: new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      minSize: minSize.values[index] || 0,
      maxSize: maxSize?.values[index] || 0,
      desiredCapacity: desired?.values[index] || 0,
      rawTimestamp: timestamp
    }));
  };

  // Transform data for combined instances chart
  const transformInstancesData = (inService: MetricData | null, pending: MetricData | null, total: MetricData | null) => {
    if (!inService || !inService.timestamps) return [];

    return inService.timestamps.map((timestamp, index) => ({
      timestamp: new Date(timestamp).toLocaleString(),
      date: new Date(timestamp).toLocaleDateString(),
      time: new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      inService: inService.values[index] || 0,
      pending: pending?.values[index] || 0,
      total: total?.values[index] || 0,
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

  const minSizeStats = calculateStats(minSizeMetrics.data);
  const maxSizeStats = calculateStats(maxSizeMetrics.data);
  const desiredCapacityStats = calculateStats(desiredCapacityMetrics.data);
  const inServiceStats = calculateStats(inServiceMetrics.data);
  const pendingStats = calculateStats(pendingMetrics.data);
  const totalStats = calculateStats(totalMetrics.data);

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
    { id: 'capacity', label: 'Capacity Configuration', icon: Settings, color: 'text-blue-500' },
    { id: 'instances', label: 'Instance Lifecycle', icon: Users, color: 'text-green-500' },
    { id: 'scaling', label: 'Scaling Activity', icon: TrendingUp, color: 'text-purple-500' }
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
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 hover:text-gray-300"
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
                    title={`Navigate to ${item.name} Analytics`}
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
                    <span className="relative z-10">{item.name}</span>

                    {/* Active indicator with pulse */}
                    {item.active && (
                      <div className="ml-auto relative">
                        <div className="w-2 h-2 bg-[#232F3E] dark:bg-[#0F1419] rounded-full animate-pulse"></div>
                        <div className="absolute inset-0 w-2 h-2 bg-[#232F3E] dark:bg-[#0F1419] rounded-full animate-ping opacity-75"></div>
                      </div>
                    )}

                    {/* Hover indicator */}
                    {!item.active && (
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
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">Desired Capacity</span>
                    <span className="text-sm font-medium text-[#FF9900] group-hover:text-[#FF9900]/80">{desiredCapacityStats.current.toFixed(0)}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">Max Size</span>
                    <span className="text-sm font-medium text-red-400 group-hover:text-red-300">{maxSizeStats.current.toFixed(0)}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">In Service</span>
                    <span className="text-sm font-medium text-green-400 group-hover:text-green-300">{inServiceStats.current.toFixed(0)}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">Pending</span>
                    <span className="text-sm font-medium text-yellow-400 group-hover:text-yellow-300">{pendingStats.current.toFixed(0)}</span>
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
                  <span className="text-gray-600 dark:text-gray-400">ASG</span>
                </li>
              </ol>
            </nav>

            {/* Header Section */}
            <div className="mb-8 px-4 sm:px-6 lg:px-8">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 transition-colors">Auto Scaling Group Analytics</h1>
              <p className="text-gray-600 dark:text-gray-300 text-lg transition-colors mb-4">
                Monitor ASG capacity, instance lifecycle, and scaling activities with real-time insights.
              </p>

              {/* Info Banner */}
              <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex">
                  <Info className="h-5 w-5 text-blue-400" />
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">
                      Auto Scaling Insights
                    </h3>
                    <div className="mt-2 text-sm text-blue-700 dark:text-blue-300">
                      <p>
                        Track your Auto Scaling Group's capacity configuration, monitor instance lifecycle states,
                        and analyze scaling activities. Use these metrics to optimize your scaling policies and ensure
                        your application can handle varying loads effectively.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="mb-6 px-4 sm:px-6 lg:px-8">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                {/* Chart Type Selector */}
                <div className="flex flex-wrap gap-2">
                  {chartTabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveChart(tab.id as any)}
                        className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                          activeChart === tab.id
                            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700'
                            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        <Icon className={`mr-2 h-4 w-4 ${tab.color}`} />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Time Range and Refresh */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setIsRefreshing(true);
                      // Re-fetch all metrics
                      fetchMetric(analyticsApi.getASGGroupMinSizeMetrics, setMinSizeMetrics, 'Min Size');
                      fetchMetric(analyticsApi.getASGGroupMaxSizeMetrics, setMaxSizeMetrics, 'Max Size');
                      fetchMetric(analyticsApi.getASGGroupDesiredCapacityMetrics, setDesiredCapacityMetrics, 'Desired Capacity');
                      fetchMetric(analyticsApi.getASGGroupInServiceInstancesMetrics, setInServiceMetrics, 'In Service Instances');
                      fetchMetric(analyticsApi.getASGGroupPendingInstancesMetrics, setPendingMetrics, 'Pending Instances');
                      fetchMetric(analyticsApi.getASGGroupTotalInstancesMetrics, setTotalMetrics, 'Total Instances');
                      setTimeout(() => setIsRefreshing(false), 1000);
                    }}
                    disabled={isRefreshing}
                    className="flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-md text-sm font-medium transition-colors duration-200"
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
              </div>
            </div>

            {/* Charts Section */}
            <div className="px-4 sm:px-6 lg:px-8">
              {/* Capacity Configuration Charts */}
              {activeChart === 'capacity' && (
                <>
                  {/* Capacity Overview */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors mb-6">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Capacity Configuration</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Min, Max, and Desired capacity over time</p>
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="flex items-center space-x-2">
                          <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                          <span className="text-sm text-gray-600 dark:text-gray-400">Min Size</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                          <span className="text-sm text-gray-600 dark:text-gray-400">Max Size</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                          <span className="text-sm text-gray-600 dark:text-gray-400">Desired</span>
                        </div>
                      </div>
                    </div>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <RechartsLineChart data={transformCapacityData(minSizeMetrics.data, maxSizeMetrics.data, desiredCapacityMetrics.data)}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis
                            dataKey="rawTimestamp"
                            stroke="#6B7280"
                            fontSize={12}
                            tick={<CustomXAxisTick />}
                            height={50}
                          />
                          <YAxis
                            stroke="#6B7280"
                            fontSize={12}
                            tick={{ fill: '#6B7280' }}
                          />
                          <Tooltip content={<CustomTooltip />} />
                          <Legend />
                          <Line
                            type="monotone"
                            dataKey="minSize"
                            stroke="#3B82F6"
                            strokeWidth={2}
                            name="Min Size"
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="maxSize"
                            stroke="#EF4444"
                            strokeWidth={2}
                            name="Max Size"
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="desiredCapacity"
                            stroke="#10B981"
                            strokeWidth={3}
                            name="Desired Capacity"
                            dot={false}
                          />
                        </RechartsLineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Capacity Insights */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors text-center">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Desired Capacity</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{getMetricDisplayValue(desiredCapacityStats.current, 'capacity')}</p>
                      <div className="mt-4">
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${analyzeMetric(desiredCapacityStats.current, 'capacity').bgColor} ${analyzeMetric(desiredCapacityStats.current, 'capacity').color}`}>
                          {analyzeMetric(desiredCapacityStats.current, 'capacity').insight}
                        </div>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors text-center">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Min Size</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{getMetricDisplayValue(minSizeStats.current, 'capacity')}</p>
                      <div className="mt-4">
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${analyzeMetric(minSizeStats.current, 'capacity').bgColor} ${analyzeMetric(minSizeStats.current, 'capacity').color}`}>
                          {analyzeMetric(minSizeStats.current, 'capacity').insight}
                        </div>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors text-center">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Max Size</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{getMetricDisplayValue(maxSizeStats.current, 'capacity')}</p>
                      <div className="mt-4">
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${analyzeMetric(maxSizeStats.current, 'capacity').bgColor} ${analyzeMetric(maxSizeStats.current, 'capacity').color}`}>
                          {analyzeMetric(maxSizeStats.current, 'capacity').insight}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Instance Lifecycle Charts */}
              {activeChart === 'instances' && (
                <>
                  {/* Instance Lifecycle Overview */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors mb-6">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Instance Lifecycle</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">In-service, pending, and total instances over time</p>
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="flex items-center space-x-2">
                          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                          <span className="text-sm text-gray-600 dark:text-gray-400">In Service</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                          <span className="text-sm text-gray-600 dark:text-gray-400">Pending</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                          <span className="text-sm text-gray-600 dark:text-gray-400">Total</span>
                        </div>
                      </div>
                    </div>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={transformInstancesData(inServiceMetrics.data, pendingMetrics.data, totalMetrics.data)}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis
                            dataKey="rawTimestamp"
                            stroke="#6B7280"
                            fontSize={12}
                            tick={<CustomXAxisTick />}
                            height={50}
                          />
                          <YAxis
                            stroke="#6B7280"
                            fontSize={12}
                            tick={{ fill: '#6B7280' }}
                          />
                          <Tooltip content={<CustomTooltip />} />
                          <Legend />
                          <Area
                            type="monotone"
                            dataKey="inService"
                            stackId="1"
                            stroke="#10B981"
                            fill="#10B981"
                            fillOpacity={0.6}
                            name="In Service"
                          />
                          <Area
                            type="monotone"
                            dataKey="pending"
                            stackId="1"
                            stroke="#F59E0B"
                            fill="#F59E0B"
                            fillOpacity={0.6}
                            name="Pending"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Instance Insights */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors text-center">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">In Service</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{getMetricDisplayValue(inServiceStats.current, 'instances')}</p>
                      <div className="mt-4">
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${analyzeMetric(inServiceStats.current, 'instances').bgColor} ${analyzeMetric(inServiceStats.current, 'instances').color}`}>
                          {analyzeMetric(inServiceStats.current, 'instances').insight}
                        </div>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors text-center">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Pending</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{getMetricDisplayValue(pendingStats.current, 'pending')}</p>
                      <div className="mt-4">
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${analyzeMetric(pendingStats.current, 'pending').bgColor} ${analyzeMetric(pendingStats.current, 'pending').color}`}>
                          {analyzeMetric(pendingStats.current, 'pending').insight}
                        </div>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors text-center">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Instances</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{getMetricDisplayValue(totalStats.current, 'instances')}</p>
                      <div className="mt-4">
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${analyzeMetric(totalStats.current, 'instances').bgColor} ${analyzeMetric(totalStats.current, 'instances').color}`}>
                          {analyzeMetric(totalStats.current, 'instances').insight}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Scaling Activity Charts */}
              {activeChart === 'scaling' && (
                <>
                  {/* Scaling Activity Overview */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors mb-6">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Scaling Activity</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Monitor scaling events and capacity changes</p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Zap className="h-5 w-5 text-purple-500" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">Activity Timeline</span>
                      </div>
                    </div>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={transformDataForChart(desiredCapacityMetrics.data)}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis
                            dataKey="rawTimestamp"
                            stroke="#6B7280"
                            fontSize={12}
                            tick={<CustomXAxisTick />}
                            height={50}
                          />
                          <YAxis
                            stroke="#6B7280"
                            fontSize={12}
                            tick={{ fill: '#6B7280' }}
                          />
                          <Tooltip content={<CustomTooltip />} />
                          <Bar
                            dataKey="value"
                            fill="#8B5CF6"
                            name="Desired Capacity"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Scaling Insights */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors text-center">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Capacity Changes</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{desiredCapacityStats.max - desiredCapacityStats.min > 0 ? '+' : ''}{(desiredCapacityStats.max - desiredCapacityStats.min).toFixed(0)} instances</p>
                      <div className="mt-4">
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Range: {desiredCapacityStats.min.toFixed(0)} - {desiredCapacityStats.max.toFixed(0)} instances
                        </p>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors text-center">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Scaling Efficiency</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{((inServiceStats.avg / desiredCapacityStats.avg) * 100).toFixed(1)}%</p>
                      <div className="mt-4">
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          In-service vs desired capacity ratio
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
