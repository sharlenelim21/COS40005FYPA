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
  Globe,
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
  LineChart,
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
        y={5}
        textAnchor="middle"
        className="text-xs fill-gray-600 dark:fill-gray-400"
      >
        {date.toLocaleDateString()}
      </text>
      <text
        x={0}
        y={20}
        textAnchor="middle"
        className="text-xs fill-gray-500 dark:fill-gray-500"
      >
        {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </text>
    </g>
  );
};

// Threshold-based insights configuration for ALB
const ALB_THRESHOLDS = {
  requestCount: {
    low: { max: 1000, label: 'Low traffic', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/10' },
    moderate: { min: 1000, max: 10000, label: 'Moderate traffic', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/10' },
    high: { min: 10000, max: 50000, label: 'High traffic', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/10' },
    critical: { min: 50000, label: 'Very high traffic - monitor performance', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/10' }
  },
  responseTime: {
    excellent: { max: 0.1, label: 'Excellent response time', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/10' }, // < 100ms
    good: { min: 0.1, max: 0.5, label: 'Good response time', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/10' }, // 100ms - 500ms
    moderate: { min: 0.5, max: 1.0, label: 'Moderate response time', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/10' }, // 500ms - 1s
    slow: { min: 1.0, label: 'Slow response time - investigate', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/10' } // > 1s
  },
  errorRate: {
    excellent: { max: 0.001, label: 'Excellent error rate', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/10' }, // < 0.1%
    good: { min: 0.001, max: 0.01, label: 'Good error rate', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/10' }, // 0.1% - 1%
    moderate: { min: 0.01, max: 0.05, label: 'Moderate error rate', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/10' }, // 1% - 5%
    high: { min: 0.05, label: 'High error rate - investigate issues', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/10' } // > 5%
  },
  healthyHosts: {
    excellent: { min: 2, label: 'All hosts healthy', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/10' },
    good: { min: 1, max: 2, label: 'Most hosts healthy', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/10' },
    warning: { max: 1, label: 'Limited healthy hosts - monitor', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/10' }
  }
};

// Function to analyze ALB metric values and provide insights
const analyzeALBMetric = (value: number, type: 'requestCount' | 'responseTime' | 'errorRate' | 'healthyHosts') => {
  const thresholds = ALB_THRESHOLDS[type];

  for (const [level, config] of Object.entries(thresholds)) {
    const { min = -Infinity, max = Infinity, label, color, bgColor } = config as any;

    if (value >= min && value < max) {
      return {
        insight: label,
        color,
        bgColor,
        level: level as 'excellent' | 'good' | 'moderate' | 'high' | 'critical' | 'slow' | 'warning'
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

// Function to get ALB metric display value with unit
const getALBMetricDisplayValue = (value: number, type: 'requestCount' | 'responseTime' | 'errorRate' | 'healthyHosts') => {
  if (type === 'responseTime') {
    return `${(value * 1000).toFixed(1)} ms`;
  } else if (type === 'errorRate') {
    return `${(value * 100).toFixed(2)}%`;
  } else if (type === 'requestCount') {
    return value.toLocaleString();
  } else {
    return value.toString();
  }
};

interface ALBMetricState {
  requestCount: MetricData | null;
  targetResponseTime: MetricData | null;
  http4xxELB: MetricData | null;
  http4xxTarget: MetricData | null;
  healthyHosts: MetricData | null;
  unhealthyHosts: MetricData | null;
  loading: boolean;
  error: string | null;
}

export default function ALBAnalytics() {
  const pathname = usePathname();

  // ALB metrics state
  const [albMetrics, setAlbMetrics] = useState<ALBMetricState>({
    requestCount: null,
    targetResponseTime: null,
    http4xxELB: null,
    http4xxTarget: null,
    healthyHosts: null,
    unhealthyHosts: null,
    loading: true,
    error: null
  });
  const [activeChart, setActiveChart] = useState<'traffic' | 'performance' | 'errors' | 'health'>('traffic');
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d'>('24h');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showThresholdInfo, setShowThresholdInfo] = useState(false);

  // Helper function to fetch ALB metrics
  const fetchALBMetrics = async () => {
    try {
      setAlbMetrics(prev => ({ ...prev, loading: true, error: null }));

      // Fetch all ALB metrics in parallel
      const [
        requestCount,
        targetResponseTime,
        http4xxELB,
        http4xxTarget,
        healthyHosts,
        unhealthyHosts
      ] = await Promise.all([
        analyticsApi.getALBRequestCountMetrics(),
        analyticsApi.getALBTargetResponseTimeMetrics(),
        analyticsApi.getALBHTTP4XXELBMetrics(),
        analyticsApi.getALBHTTP4XXTargetMetrics(),
        analyticsApi.getALBHealthyHostCountMetrics(),
        analyticsApi.getALBUnhealthyHostCountMetrics()
      ]); 

      setAlbMetrics({
        requestCount,
        targetResponseTime,
        http4xxELB,
        http4xxTarget,
        healthyHosts,
        unhealthyHosts,
        loading: false,
        error: null
      });
    } catch (error) {
      setAlbMetrics(prev => ({
        ...prev,
        loading: false,
        error: 'Failed to load ALB metrics'
      }));
      console.error('Error fetching ALB metrics:', error);
    }
  };

  // Fetch metrics on component mount
  useEffect(() => {
    fetchALBMetrics();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) {
        switch (event.key) {
          case 'r':
            event.preventDefault();
            handleRefresh();
            break;
          case '1':
            event.preventDefault();
            setActiveChart('traffic');
            break;
          case '2':
            event.preventDefault();
            setActiveChart('performance');
            break;
          case '3':
            event.preventDefault();
            setActiveChart('errors');
            break;
          case '4':
            event.preventDefault();
            setActiveChart('health');
            break;
        }
      }

      if (event.key === 'Escape') {
        setSidebarCollapsed(!sidebarCollapsed);
      }

      if (event.key === '/' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        // Focus search input (would need ref)
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sidebarCollapsed]);

  // Transform data for recharts
  const transformDataForChart = (metric: MetricData | null) => {
    if (!metric || !metric.timestamps || !metric.values) return [];

    return metric.timestamps.map((timestamp, index) => {
      const date = new Date(timestamp);
      return {
        timestamp: date.toLocaleString(),
        date: date.toLocaleDateString(),
        time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        value: metric.values[index] || 0,
        rawTimestamp: timestamp
      };
    });
  };

  // Transform error data for combined chart
  const transformErrorDataForChart = (elbErrors: MetricData | null, targetErrors: MetricData | null) => {
    if (!elbErrors || !targetErrors || !elbErrors.timestamps) return [];

    return elbErrors.timestamps.map((timestamp, index) => {
      const date = new Date(timestamp);
      return {
        timestamp: date.toLocaleString(),
        date: date.toLocaleDateString(),
        time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        elb: elbErrors.values[index] || 0,
        target: targetErrors.values[index] || 0,
        total: (elbErrors.values[index] || 0) + (targetErrors.values[index] || 0),
        rawTimestamp: timestamp
      };
    });
  };

  // Transform health data for combined chart
  const transformHealthDataForChart = (healthy: MetricData | null, unhealthy: MetricData | null) => {
    if (!healthy || !unhealthy || !healthy.timestamps) return [];

    return healthy.timestamps.map((timestamp, index) => {
      const date = new Date(timestamp);
      return {
        timestamp: date.toLocaleString(),
        date: date.toLocaleDateString(),
        time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        healthy: healthy.values[index] || 0,
        unhealthy: unhealthy.values[index] || 0,
        total: (healthy.values[index] || 0) + (unhealthy.values[index] || 0),
        rawTimestamp: timestamp
      };
    });
  };

  // Calculate summary statistics
  const calculateStats = (data: MetricData | null) => {
    if (!data || !data.values || data.values.length === 0) {
      return { current: 0, average: 0, max: 0, min: 0 };
    }

    const values = data.values;
    const current = values[values.length - 1] || 0;
    const average = values.reduce((sum, val) => sum + val, 0) / values.length;
    const max = Math.max(...values);
    const min = Math.min(...values);

    return {
      current: Number(current.toFixed(2)),
      average: Number(average.toFixed(2)),
      max: Number(max.toFixed(2)),
      min: Number(min.toFixed(2))
    };
  };

  const requestCountStats = calculateStats(albMetrics.requestCount);
  const responseTimeStats = calculateStats(albMetrics.targetResponseTime);
  const elbErrorStats = calculateStats(albMetrics.http4xxELB);
  const targetErrorStats = calculateStats(albMetrics.http4xxTarget);
  const healthyHostStats = calculateStats(albMetrics.healthyHosts);
  const unhealthyHostStats = calculateStats(albMetrics.unhealthyHosts);

  // Calculate error rate
  const calculateErrorRate = () => {
    if (!albMetrics.requestCount || !albMetrics.http4xxELB || !albMetrics.http4xxTarget) return 0;

    const latestRequests = albMetrics.requestCount.values[albMetrics.requestCount.values.length - 1] || 0;
    const latestELBErrors = albMetrics.http4xxELB.values[albMetrics.http4xxELB.values.length - 1] || 0;
    const latestTargetErrors = albMetrics.http4xxTarget.values[albMetrics.http4xxTarget.values.length - 1] || 0;

    if (latestRequests === 0) return 0;

    return (latestELBErrors + latestTargetErrors) / latestRequests;
  };

  const errorRate = calculateErrorRate();

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
    { id: 'traffic', label: 'Traffic Metrics', icon: TrendingUp, color: 'text-blue-500' },
    { id: 'performance', label: 'Performance Metrics', icon: Zap, color: 'text-green-500' },
    { id: 'errors', label: 'Error Metrics', icon: AlertCircle, color: 'text-red-500' },
    { id: 'health', label: 'Health Metrics', icon: Heart, color: 'text-purple-500' }
  ];

  // Handle refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchALBMetrics();
    setIsRefreshing(false);
  };

  // Custom tooltip for charts
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{`Time: ${label}`}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {`${entry.name}: ${entry.value}`}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Pie chart data for error breakdown
  const errorBreakdownData = [
    { name: 'ELB Errors', value: elbErrorStats.current, color: '#EF4444' },
    { name: 'Target Errors', value: targetErrorStats.current, color: '#F59E0B' }
  ].filter(item => item.value > 0);

  // Pie chart data for host health
  const healthBreakdownData = [
    { name: 'Healthy Hosts', value: healthyHostStats.current, color: '#10B981' },
    { name: 'Unhealthy Hosts', value: unhealthyHostStats.current, color: '#EF4444' }
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
        {/* AWS-style Sidebar */}
        <div className={`bg-[#1A202C] dark:bg-[#1A202C] text-white min-h-screen shadow-xl transition-all duration-300 border-r border-gray-200 dark:border-[#2D3748] relative ${
          sidebarCollapsed ? 'w-16' : 'w-56'
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

            {!sidebarCollapsed && (
              <>
                {/* Search */}
                <div className="mb-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search services..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-gray-700 dark:bg-[#2D3748] border border-gray-600 dark:border-[#4A5568] rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#FF9900] focus:border-transparent"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2"
                      >
                        <X className="h-4 w-4 text-gray-400 hover:text-white" />
                      </button>
                    )}
                  </div>
                </div>

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

                {/* Quick Stats */}
                <div className="mt-10 space-y-3">
                  <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-3">Quick Stats</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                      <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">Avg Requests/Daily</span>
                      <span className="text-sm font-medium text-[#FF9900] group-hover:text-[#FF9900]/80">
                        {Math.round(requestCountStats.average)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                      <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">Avg Response Time</span>
                      <span className="text-sm font-medium text-green-400 group-hover:text-green-300">
                        {(responseTimeStats.current * 1000).toFixed(0)}ms
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                      <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">Error Rate</span>
                      <span className="text-sm font-medium text-red-400 group-hover:text-red-300">
                        {(errorRate * 100).toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                      <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">Healthy Hosts</span>
                      <span className="text-sm font-medium text-green-400 group-hover:text-green-300">
                        {healthyHostStats.current}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1">
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
                  <span className="text-gray-600 dark:text-gray-400">ALB</span>
                </li>
              </ol>
            </nav>

            {/* Header Section */}
            <div className="mb-8 px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 transition-colors">ALB Analytics</h1>
                  <p className="text-gray-600 dark:text-gray-300 text-lg transition-colors">
                    Application Load Balancer performance metrics and monitoring with analytical insights.
                  </p>
                </div>
                <div className="flex items-center space-x-4">

                  {/* Refresh Button */}
                  <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className="flex items-center space-x-2 px-4 py-2 bg-[#FF9900] text-[#232F3E] rounded-md hover:bg-[#FF9900]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {/* Threshold Explanation */}
              <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mt-4">
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
                      Instead of just showing raw metrics, our system analyzes your ALB performance data against industry-standard thresholds to provide actionable insights about system health and potential issues.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">Request Count Thresholds:</h4>
                        <ul className="space-y-1 text-xs">
                          <li className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/10 text-blue-600 dark:text-blue-400">
                              Low
                            </span>
                            &lt; 1,000 requests
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-50 dark:bg-green-900/10 text-green-600 dark:text-green-400">
                              Moderate
                            </span>
                            1,000 - 10,000 requests
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-50 dark:bg-yellow-900/10 text-yellow-600 dark:text-yellow-400">
                              High
                            </span>
                            10,000 - 50,000 requests
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400">
                              Critical
                            </span>
                            &gt; 50,000 requests
                          </li>
                        </ul>
                      </div>

                      <div>
                        <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">Response Time Thresholds:</h4>
                        <ul className="space-y-1 text-xs">
                          <li className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-50 dark:bg-green-900/10 text-green-600 dark:text-green-400">
                              Excellent
                            </span>
                            &lt; 100ms
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/10 text-blue-600 dark:text-blue-400">
                              Good
                            </span>
                            100ms - 500ms
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-50 dark:bg-yellow-900/10 text-yellow-600 dark:text-yellow-400">
                              Moderate
                            </span>
                            500ms - 1s
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400">
                              Slow
                            </span>
                            &gt; 1s
                          </li>
                        </ul>
                      </div>

                      <div>
                        <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">Error Rate Thresholds:</h4>
                        <ul className="space-y-1 text-xs">
                          <li className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-50 dark:bg-green-900/10 text-green-600 dark:text-green-400">
                              Excellent
                            </span>
                            &lt; 0.1%
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/10 text-blue-600 dark:text-blue-400">
                              Good
                            </span>
                            0.1% - 1%
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-50 dark:bg-yellow-900/10 text-yellow-600 dark:text-yellow-400">
                              Moderate
                            </span>
                            1% - 5%
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400">
                              High
                            </span>
                            &gt; 5%
                          </li>
                        </ul>
                      </div>

                      <div>
                        <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">Healthy Hosts Thresholds:</h4>
                        <ul className="space-y-1 text-xs">
                          <li className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-50 dark:bg-green-900/10 text-green-600 dark:text-green-400">
                              Excellent
                            </span>
                            ≥ 2 healthy hosts
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/10 text-blue-600 dark:text-blue-400">
                              Good
                            </span>
                            1-2 healthy hosts
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-50 dark:bg-yellow-900/10 text-yellow-600 dark:text-yellow-400">
                              Warning
                            </span>
                            ≤ 1 healthy host
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Chart Tabs */}
            <div className="mb-6 px-4 sm:px-6 lg:px-8">
              <div className="flex space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                {chartTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveChart(tab.id as any)}
                      className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                        activeChart === tab.id
                          ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Charts Section */}
            <div className="px-4 sm:px-6 lg:px-8">
              {albMetrics.loading ? (
                <div className="flex items-center justify-center h-96">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#FF9900]"></div>
                </div>
              ) : albMetrics.error ? (
                <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-6">
                  <div className="flex items-center">
                    <AlertTriangle className="h-5 w-5 text-red-400 mr-3" />
                    <div>
                      <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error Loading Metrics</h3>
                      <p className="text-sm text-red-700 dark:text-red-300 mt-1">{albMetrics.error}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  {/* Traffic Metrics */}
                  {activeChart === 'traffic' && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Request Traffic</h3>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Total requests handled by the ALB over time</p>
                        </div>
                      </div>
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={transformDataForChart(albMetrics.requestCount)}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis
                              dataKey="rawTimestamp"
                              stroke="#6B7280"
                              fontSize={12}
                              tick={<CustomXAxisTick />}
                              height={40}
                            />
                            <YAxis
                              stroke="#6B7280"
                              fontSize={12}
                              tick={{ fill: '#6B7280' }}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Area
                              type="monotone"
                              dataKey="value"
                              stroke="#3B82F6"
                              fill="#3B82F6"
                              fillOpacity={0.1}
                              name="Requests"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Performance Metrics */}
                  {activeChart === 'performance' && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Response Time Performance</h3>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Average time taken by targets to respond to requests</p>
                        </div>
                      </div>
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={transformDataForChart(albMetrics.targetResponseTime)}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis
                              dataKey="rawTimestamp"
                              stroke="#6B7280"
                              fontSize={12}
                              tick={<CustomXAxisTick />}
                              height={40}
                            />
                            <YAxis
                              stroke="#6B7280"
                              fontSize={12}
                              tick={{ fill: '#6B7280' }}
                              tickFormatter={(value) => `${(value * 1000).toFixed(0)}ms`}
                            />
                            <Tooltip
                              content={<CustomTooltip />}
                              formatter={(value: any) => [`${(value * 1000).toFixed(1)}ms`, 'Response Time']}
                            />
                            <Line
                              type="monotone"
                              dataKey="value"
                              stroke="#10B981"
                              strokeWidth={2}
                              dot={{ fill: '#10B981', strokeWidth: 2, r: 4 }}
                              name="Response Time"
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Error Metrics */}
                  {activeChart === 'errors' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Error Breakdown Chart */}
                      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors">
                        <div className="flex items-center justify-between mb-6">
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Error Breakdown</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400">Distribution of 4xx errors</p>
                          </div>
                        </div>
                        <div className="h-80">
                          <ResponsiveContainer width="100%" height="100%">
                            <RechartsPieChart>
                              <Pie
                                data={errorBreakdownData}
                                cx="50%"
                                cy="50%"
                                outerRadius={80}
                                fill="#8884d8"
                                dataKey="value"
                                label={({ name, percent }) => `${name} ${((percent as number) * 100).toFixed(0)}%`}
                              >
                                {errorBreakdownData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                              </Pie>
                              <Tooltip />
                            </RechartsPieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* Error Timeline */}
                      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors">
                        <div className="flex items-center justify-between mb-6">
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Error Timeline</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400">ELB vs Target errors over time</p>
                          </div>
                        </div>
                        <div className="h-80">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={transformErrorDataForChart(albMetrics.http4xxELB, albMetrics.http4xxTarget)}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                              <XAxis
                                dataKey="rawTimestamp"
                                stroke="#6B7280"
                                fontSize={12}
                                tick={<CustomXAxisTick />}
                                height={40}
                              />
                              <YAxis
                                stroke="#6B7280"
                                fontSize={12}
                                tick={{ fill: '#6B7280' }}
                              />
                              <Tooltip content={<CustomTooltip />} />
                              <Area
                                type="monotone"
                                dataKey="elb"
                                stackId="1"
                                stroke="#EF4444"
                                fill="#EF4444"
                                name="ELB Errors"
                              />
                              <Area
                                type="monotone"
                                dataKey="target"
                                stackId="1"
                                stroke="#F59E0B"
                                fill="#F59E0B"
                                name="Target Errors"
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Health Metrics */}
                  {activeChart === 'health' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Host Health Chart */}
                      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors">
                        <div className="flex items-center justify-between mb-6">
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Host Health Status</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400">Healthy vs unhealthy target distribution</p>
                          </div>
                        </div>
                        <div className="h-80">
                          <ResponsiveContainer width="100%" height="100%">
                            <RechartsPieChart>
                              <Pie
                                data={healthBreakdownData}
                                cx="50%"
                                cy="50%"
                                outerRadius={80}
                                fill="#8884d8"
                                dataKey="value"
                                label={({ name, percent }) => `${name} ${((percent as number) * 100).toFixed(0)}%`}
                              >
                                {healthBreakdownData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                              </Pie>
                              <Tooltip />
                            </RechartsPieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* Health Timeline */}
                      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-colors">
                        <div className="flex items-center justify-between mb-6">
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Host Health Timeline</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400">Healthy and unhealthy hosts over time</p>
                          </div>
                        </div>
                        <div className="h-80">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={transformHealthDataForChart(albMetrics.healthyHosts, albMetrics.unhealthyHosts)}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                              <XAxis
                                dataKey="rawTimestamp"
                                stroke="#6B7280"
                                fontSize={12}
                                tick={<CustomXAxisTick />}
                                height={40}
                              />
                              <YAxis
                                stroke="#6B7280"
                                fontSize={12}
                                tick={{ fill: '#6B7280' }}
                              />
                              <Tooltip content={<CustomTooltip />} />
                              <Bar dataKey="healthy" fill="#10B981" name="Healthy Hosts" />
                              <Bar dataKey="unhealthy" fill="#EF4444" name="Unhealthy Hosts" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Metric Cards - Horizontal Layout */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-8">
                    {/* Total Requests Card */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 px-6 pb-8 pt-6 transition-colors">
                      <div className="text-center">
                        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Avg Daily Requests</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
                          {requestCountStats.average.toLocaleString()}
                        </p>
                      </div>
                      <div className="mt-4 text-center">
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${analyzeALBMetric(requestCountStats.average, 'requestCount').bgColor} ${analyzeALBMetric(requestCountStats.average, 'requestCount').color}`}>
                          {analyzeALBMetric(requestCountStats.average, 'requestCount').insight}
                        </div>
                      </div>
                    </div>

                    {/* Avg Response Time Card */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 px-6 pb-8 pt-6 transition-colors">
                      <div className="text-center">
                        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Avg Response Time</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
                          {(responseTimeStats.current * 1000).toFixed(1)}ms
                        </p>
                      </div>
                      <div className="mt-4 text-center">
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${analyzeALBMetric(responseTimeStats.current, 'responseTime').bgColor} ${analyzeALBMetric(responseTimeStats.current, 'responseTime').color}`}>
                          {analyzeALBMetric(responseTimeStats.current, 'responseTime').insight}
                        </div>
                      </div>
                    </div>

                    {/* Error Rate Card */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 px-6 pb-8 pt-6 transition-colors">
                      <div className="text-center">
                        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Error Rate</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
                          {(errorRate * 100).toFixed(2)}%
                        </p>
                      </div>
                      <div className="mt-4 text-center">
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${analyzeALBMetric(errorRate, 'errorRate').bgColor} ${analyzeALBMetric(errorRate, 'errorRate').color}`}>
                          {analyzeALBMetric(errorRate, 'errorRate').insight}
                        </div>
                      </div>
                    </div>

                    {/* Healthy Hosts Card */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 px-6 pb-8 pt-6 transition-colors">
                      <div className="text-center">
                        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Healthy Hosts</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
                          {healthyHostStats.current}
                        </p>
                      </div>
                      <div className="mt-4 text-center">
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${analyzeALBMetric(healthyHostStats.current, 'healthyHosts').bgColor} ${analyzeALBMetric(healthyHostStats.current, 'healthyHosts').color}`}>
                          {analyzeALBMetric(healthyHostStats.current, 'healthyHosts').insight}
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