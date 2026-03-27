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
  Zap
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

// Threshold-based insights configuration for ECR
const ECR_THRESHOLDS = {
  pullCount: {
    low: { max: 10, label: 'Low activity', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/10' },
    moderate: { min: 10, max: 100, label: 'Moderate activity', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/10' },
    high: { min: 100, max: 500, label: 'High activity', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/10' },
    critical: { min: 500, label: 'Critical activity - high usage', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/10' }
  }
};

// Function to analyze ECR metric values and provide insights
const analyzeEcrMetric = (value: number) => {
  const thresholds = ECR_THRESHOLDS.pullCount;

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

// Function to get ECR metric display value with unit
const getEcrMetricDisplayValue = (value: number) => {
  return `${value.toLocaleString()}`;
};

interface MetricState {
  data: MetricData | null;
  loading: boolean;
  error: string | null;
}

export default function ECRAnalytics() {
  const pathname = usePathname();

  // ECR metrics state
  const [ecrBackendPullCountMetrics, setEcrBackendPullCountMetrics] = useState<MetricState>({ data: null, loading: true, error: null });
  const [ecrFrontendPullCountMetrics, setEcrFrontendPullCountMetrics] = useState<MetricState>({ data: null, loading: true, error: null });
  const [activeChart, setActiveChart] = useState<'backend' | 'frontend'>('backend');
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
    // Fetch all ECR metrics
    fetchMetric(analyticsApi.getEcrBackendRepositoryPullCountMetrics, setEcrBackendPullCountMetrics, 'ECR Backend Repository Pull Count');
    fetchMetric(analyticsApi.getEcrFrontendRepositoryPullCountMetrics, setEcrFrontendPullCountMetrics, 'ECR Frontend Repository Pull Count');
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

  const backendStats = calculateStats(ecrBackendPullCountMetrics.data);
  const frontendStats = calculateStats(ecrFrontendPullCountMetrics.data);

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
    { id: 'backend', label: 'Backend Repository', icon: Server, color: 'text-blue-500' },
    { id: 'frontend', label: 'Frontend Repository', icon: Package, color: 'text-green-500' }
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
                      <span className="text-blue-400 font-medium">ECR</span> | Backend Pulls
                    </span>
                    <span className="text-sm font-medium text-blue-400 group-hover:text-blue-300">{backendStats.current?.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">
                      <span className="text-green-400 font-medium">ECR</span> | Frontend Pulls
                    </span>
                    <span className="text-sm font-medium text-green-400 group-hover:text-green-300">{frontendStats.current?.toLocaleString()}</span>
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
                  <span className="text-gray-600 dark:text-gray-400">ECR</span>
                </li>
              </ol>
            </nav>

            {/* Header Section */}
            <div className="mb-8 px-4 sm:px-6 lg:px-8">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 transition-colors">ECR Analytics</h1>
              <p className="text-gray-600 dark:text-gray-300 text-lg transition-colors mb-4">
                Monitor repository pull counts and image deployment metrics with analytical insights.
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
                      Understanding ECR Pull Count Insights
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
                      <strong>What are ECR pull count insights?</strong> These metrics show how often your container images are being pulled from ECR repositories, indicating deployment frequency and usage patterns.
                    </p>

                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <h4 className="font-semibold text-blue-800 dark:text-blue-200 mb-2 flex items-center gap-2">
                          <Package className="h-4 w-4 text-blue-600" />
                          Pull Count Thresholds
                        </h4>
                        <ul className="space-y-1 text-xs">
                          <li><span className="font-medium text-blue-600">Low activity (≤10 pulls):</span> Minimal deployments or development environment</li>
                          <li><span className="font-medium text-green-600">Moderate activity (10-100 pulls):</span> Standard application usage</li>
                          <li><span className="font-medium text-yellow-600">High activity (100-500 pulls):</span> Frequent deployments or high-traffic service</li>
                          <li><span className="font-medium text-red-600">Critical activity (≥500 pulls):</span> Very high deployment frequency - monitor costs</li>
                        </ul>
                      </div>
                    </div>

                    <div className="bg-blue-100 dark:bg-blue-900/20 p-3 rounded-md">
                      <p className="text-xs">
                        <strong>Why monitor pull counts?</strong> ECR charges based on data transfer and storage. High pull counts may indicate inefficient deployment strategies or increased infrastructure costs.
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
                      setIsRefreshing(true);
                      try {
                        // Refresh all metrics
                        await Promise.all([
                          fetchMetric(analyticsApi.getEcrBackendRepositoryPullCountMetrics, setEcrBackendPullCountMetrics, 'ECR Backend Repository Pull Count'),
                          fetchMetric(analyticsApi.getEcrFrontendRepositoryPullCountMetrics, setEcrFrontendPullCountMetrics, 'ECR Frontend Repository Pull Count')
                        ]);
                      } catch (error) {
                        console.error('Error refreshing ECR metrics:', error);
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
              {/* Backend Repository Chart */}
              {activeChart === 'backend' && (
                <div className="space-y-6">
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Backend Repository Pull Count</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Number of image pulls from the backend ECR repository</p>
                      </div>
                      <div className="text-right">
                        <div className={`text-2xl font-bold ${analyzeEcrMetric(backendStats.current).color}`}>
                          {getEcrMetricDisplayValue(backendStats.current)}
                        </div>
                        <div className={`text-sm ${analyzeEcrMetric(backendStats.current).color}`}>
                          {analyzeEcrMetric(backendStats.current).insight}
                        </div>
                      </div>
                    </div>

                    {ecrBackendPullCountMetrics.loading ? (
                      <div className="h-80 flex items-center justify-center">
                        <div className="text-gray-500 dark:text-gray-400">Loading backend ECR metrics...</div>
                      </div>
                    ) : ecrBackendPullCountMetrics.error ? (
                      <div className="h-80 flex items-center justify-center">
                        <div className="text-red-500 dark:text-red-400">{ecrBackendPullCountMetrics.error}</div>
                      </div>
                    ) : (
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={transformDataForChart(ecrBackendPullCountMetrics.data)}>
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
                              label={{ value: 'Pull Count', angle: -90, position: 'insideLeft' }}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Area
                              type="monotone"
                              dataKey="value"
                              stroke="#3B82F6"
                              fill="#93C5FD"
                              fillOpacity={0.3}
                              strokeWidth={2}
                              name="Backend Pull Count"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* Backend Stats Cards with Insights */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                      <div className={`p-4 rounded-lg text-center ${analyzeEcrMetric(backendStats.avg).bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Average Pulls</div>
                        <div className={`text-xl font-bold ${analyzeEcrMetric(backendStats.avg).color}`}>
                          {getEcrMetricDisplayValue(backendStats.avg)}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeEcrMetric(backendStats.avg).color}`}>
                          {analyzeEcrMetric(backendStats.avg).insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeEcrMetric(backendStats.max).bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Peak Pulls</div>
                        <div className={`text-xl font-bold ${analyzeEcrMetric(backendStats.max).color}`}>
                          {getEcrMetricDisplayValue(backendStats.max)}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeEcrMetric(backendStats.max).color}`}>
                          {analyzeEcrMetric(backendStats.max).insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeEcrMetric(backendStats.min).bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Minimum Pulls</div>
                        <div className={`text-xl font-bold ${analyzeEcrMetric(backendStats.min).color}`}>
                          {getEcrMetricDisplayValue(backendStats.min)}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeEcrMetric(backendStats.min).color}`}>
                          {analyzeEcrMetric(backendStats.min).insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeEcrMetric(backendStats.current).bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Current Pulls</div>
                        <div className={`text-xl font-bold ${analyzeEcrMetric(backendStats.current).color}`}>
                          {getEcrMetricDisplayValue(backendStats.current)}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeEcrMetric(backendStats.current).color}`}>
                          {analyzeEcrMetric(backendStats.current).insight}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Frontend Repository Chart */}
              {activeChart === 'frontend' && (
                <div className="space-y-6">
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Frontend Repository Pull Count</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Number of image pulls from the frontend ECR repository</p>
                      </div>
                      <div className="text-right">
                        <div className={`text-2xl font-bold ${analyzeEcrMetric(frontendStats.current).color}`}>
                          {getEcrMetricDisplayValue(frontendStats.current)}
                        </div>
                        <div className={`text-sm ${analyzeEcrMetric(frontendStats.current).color}`}>
                          {analyzeEcrMetric(frontendStats.current).insight}
                        </div>
                      </div>
                    </div>

                    {ecrFrontendPullCountMetrics.loading ? (
                      <div className="h-80 flex items-center justify-center">
                        <div className="text-gray-500 dark:text-gray-400">Loading frontend ECR metrics...</div>
                      </div>
                    ) : ecrFrontendPullCountMetrics.error ? (
                      <div className="h-80 flex items-center justify-center">
                        <div className="text-red-500 dark:text-red-400">{ecrFrontendPullCountMetrics.error}</div>
                      </div>
                    ) : (
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={transformDataForChart(ecrFrontendPullCountMetrics.data)}>
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
                              label={{ value: 'Pull Count', angle: -90, position: 'insideLeft' }}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Area
                              type="monotone"
                              dataKey="value"
                              stroke="#10B981"
                              fill="#6EE7B7"
                              fillOpacity={0.3}
                              strokeWidth={2}
                              name="Frontend Pull Count"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* Frontend Stats Cards with Insights */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                      <div className={`p-4 rounded-lg text-center ${analyzeEcrMetric(frontendStats.avg).bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Average Pulls</div>
                        <div className={`text-xl font-bold ${analyzeEcrMetric(frontendStats.avg).color}`}>
                          {getEcrMetricDisplayValue(frontendStats.avg)}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeEcrMetric(frontendStats.avg).color}`}>
                          {analyzeEcrMetric(frontendStats.avg).insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeEcrMetric(frontendStats.max).bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Peak Pulls</div>
                        <div className={`text-xl font-bold ${analyzeEcrMetric(frontendStats.max).color}`}>
                          {getEcrMetricDisplayValue(frontendStats.max)}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeEcrMetric(frontendStats.max).color}`}>
                          {analyzeEcrMetric(frontendStats.max).insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeEcrMetric(frontendStats.min).bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Minimum Pulls</div>
                        <div className={`text-xl font-bold ${analyzeEcrMetric(frontendStats.min).color}`}>
                          {getEcrMetricDisplayValue(frontendStats.min)}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeEcrMetric(frontendStats.min).color}`}>
                          {analyzeEcrMetric(frontendStats.min).insight}
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg text-center ${analyzeEcrMetric(frontendStats.current).bgColor}`}>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Current Pulls</div>
                        <div className={`text-xl font-bold ${analyzeEcrMetric(frontendStats.current).color}`}>
                          {getEcrMetricDisplayValue(frontendStats.current)}
                        </div>
                        <div className={`text-xs mt-1 ${analyzeEcrMetric(frontendStats.current).color}`}>
                          {analyzeEcrMetric(frontendStats.current).insight}
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