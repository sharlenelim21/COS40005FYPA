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
  PieChart as PieChartIcon,
  TrendingDown,
  Calendar
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
import { CostData } from '@/types/system-monitor';
import {
  LineChart as RechartsLineChart,
  Line,
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

// Cost threshold configuration for insights
const COST_THRESHOLDS = {
  low: { max: 50, label: 'Low spending', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-900/10' },
  moderate: { min: 50, max: 200, label: 'Moderate spending', color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-900/10' },
  high: { min: 200, max: 500, label: 'High spending - review usage', color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/10' },
  critical: { min: 500, label: 'Critical spending - optimize immediately', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/10' }
};

// Function to analyze cost values and provide insights
const analyzeCost = (amount: number) => {
  for (const [level, config] of Object.entries(COST_THRESHOLDS)) {
    const { min = -Infinity, max = Infinity, label, color, bgColor } = config as any;

    if (amount >= min && amount < max) {
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

// Function to format currency
const formatCurrency = (amount: number, unit: string = 'USD') => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: unit === 'USD' ? 'USD' : 'USD', // Default to USD for now
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

interface CostState {
  data: CostData[] | null;
  loading: boolean;
  error: string | null;
}

export default function CostAnalytics() {
  const pathname = usePathname();

  // Cost metrics state
  const [costsByService, setCostsByService] = useState<CostState>({ data: null, loading: true, error: null });
  const [timeRange, setTimeRange] = useState<'1d' | '7d' | '30d'>('30d');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showThresholdInfo, setShowThresholdInfo] = useState(false);

  // Helper function to fetch cost data
  const fetchCostData = async (
    fetchFunction: () => Promise<CostData[] | null>,
    setState: React.Dispatch<React.SetStateAction<CostState>>,
    costName: string
  ) => {
    try {
      const data = await fetchFunction();
      if (data) {
        setState({ data, loading: false, error: null });
      } else {
        setState({ data: null, loading: false, error: `Failed to load ${costName} data` });
      }
    } catch (error) {
      setState({ data: null, loading: false, error: `Failed to load ${costName} data` });
      console.error(`Error fetching ${costName} data:`, error);
    }
  };

  // Chart selection state
  const [activeChart, setActiveChart] = useState<'total' | 'service'>('service');

  useEffect(() => {
    // Fetch cost data by service
    fetchCostData(analyticsApi.getCostsByService, setCostsByService, 'Costs by Service');
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
  const transformTotalCostData = (costData: CostData[] | null) => {
    if (!costData || costData.length === 0) return [];

    // For now, we'll show a single data point for the current month
    // In a real implementation, you'd have historical data
    const totalAmount = costData.reduce((sum, item) => sum + item.amount, 0);
    const now = new Date();

    return [{
      date: now.toLocaleDateString(),
      amount: totalAmount,
      formattedAmount: formatCurrency(totalAmount)
    }];
  };

  const transformServiceCostData = (costData: CostData[] | null) => {
    if (!costData || costData.length === 0) return [];

    // Aggregate duplicate services by summing their amounts
    const aggregatedData = costData.reduce((acc, item) => {
      const existingService = acc.find(service => service.service === item.service);
      if (existingService) {
        existingService.amount += item.amount;
      } else {
        acc.push({ ...item });
      }
      return acc;
    }, [] as CostData[]);

    // Sort by amount descending and filter out zero amounts
    const sortedData = aggregatedData
      .filter(item => item.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    // Assign colors based on sorted order
    return sortedData.map((item, index) => ({
      service: item.service,
      amount: item.amount,
      formattedAmount: formatCurrency(item.amount),
      fill: `hsl(${(index * 137.5) % 360}, 70%, 50%)` // Generate colors
    }));
  };

  const getAggregatedServiceData = (costData: CostData[] | null) => {
    if (!costData || costData.length === 0) return [];

    // Aggregate duplicate services by summing their amounts
    const aggregatedData = costData.reduce((acc, item) => {
      const existingService = acc.find(service => service.service === item.service);
      if (existingService) {
        existingService.amount += item.amount;
      } else {
        acc.push({ ...item });
      }
      return acc;
    }, [] as CostData[]);

    // Sort by amount descending
    return aggregatedData.sort((a, b) => b.amount - a.amount);
  };

  // Calculate summary statistics
  const calculateCostStats = (data: CostData[] | null) => {
    if (!data || data.length === 0) {
      return { total: 0, average: 0, highest: 0, services: 0 };
    }

    const total = data.reduce((sum, item) => sum + item.amount, 0);
    const average = total / data.length;
    const highest = Math.max(...data.map(item => item.amount));
    const services = data.length;

    return { total, average, highest, services };
  };

  const serviceCostStats = calculateCostStats(costsByService.data);

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

  // Custom tooltip for charts
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-gray-900 text-white p-3 rounded-lg shadow-lg border border-gray-700">
          <p className="text-sm font-medium">{`Date: ${label}`}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {`${entry.name}: ${entry.value?.toFixed ? formatCurrency(entry.value) : entry.value}`}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Custom tooltip for pie chart
  const PieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-gray-900 text-white p-3 rounded-lg shadow-lg border border-gray-700">
          <p className="text-sm font-medium">{`Service: ${data.service}`}</p>
          <p className="text-sm" style={{ color: data.fill }}>
            {`Cost: ${data.formattedAmount}`}
          </p>
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
            {/* Service Navigation */}
            <div className="flex items-center mb-6">
              <Activity className="h-5 w-5 text-[#FF9900]" />
              {!sidebarCollapsed && (
                <h2 className="text-lg font-semibold text-white dark:text-gray-100 ml-2">Services</h2>
              )}
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
                    className="w-full pl-10 pr-10 py-2 bg-gray-700 dark:bg-[#2D3748] border border-gray-600 dark:border-[#4A5568] rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#FF9900] focus:border-transparent transition-colors"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Navigation Items */}
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
                    {!sidebarCollapsed && <span className="relative z-10">{item.name}</span>}

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
            {!sidebarCollapsed && (
              <div className="mt-12 space-y-3">
                <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-3">Quick Stats</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">Services Count</span>
                    <span className="text-sm font-medium text-blue-400 group-hover:text-blue-300">
                      {costsByService.loading ? '...' : serviceCostStats.services}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">Total Cost (MTD)</span>
                    <span className="text-sm font-medium text-green-400 group-hover:text-green-300">
                      {costsByService.loading ? '...' : formatCurrency(serviceCostStats.total)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">Avg Cost/Service</span>
                    <span className="text-sm font-medium text-yellow-400 group-hover:text-yellow-300">
                      {costsByService.loading ? '...' : formatCurrency(serviceCostStats.average)}
                    </span>
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
                  <span className="text-gray-600 dark:text-gray-400">Cost Metrics</span>
                </li>
              </ol>
            </nav>

            {/* Header Section */}
            <div className="mb-8 px-4 sm:px-6 lg:px-8">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 transition-colors">Cost Analytics</h1>
              <p className="text-gray-600 dark:text-gray-300 text-lg transition-colors">
                Monitor AWS spending patterns and cost optimization opportunities
              </p>
            </div>

            {/* Threshold Explanation */}
            <div className="mb-8 px-4 sm:px-6 lg:px-8">
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
                      Instead of just showing raw cost data, our system analyzes your AWS spending against industry-standard thresholds to provide actionable insights about cost optimization opportunities.
                    </p>

                    <div className="space-y-2">
                      <h4 className="font-medium text-blue-800 dark:text-blue-200">Cost Thresholds</h4>
                      <ul className="space-y-1 text-xs">
                        <li><span className="inline-block w-3 h-3 bg-green-500 rounded-full mr-2"></span><strong>Low:</strong> &lt;$50 - Low spending</li>
                        <li><span className="inline-block w-3 h-3 bg-blue-500 rounded-full mr-2"></span><strong>Moderate:</strong> $50-$200 - Moderate spending</li>
                        <li><span className="inline-block w-3 h-3 bg-yellow-500 rounded-full mr-2"></span><strong>High:</strong> $200-$500 - High spending, review usage</li>
                        <li><span className="inline-block w-3 h-3 bg-red-500 rounded-full mr-2"></span><strong>Critical:</strong> &gt;$500 - Critical spending, optimize immediately</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Controls Section */}
            <div className="mb-6 px-4 sm:px-6 lg:px-8">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
                {/* Title */}
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Costs by Service</h2>
                  <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                    Breakdown of costs by individual AWS service
                  </p>
                </div>

                {/* Controls */}
                <div className="flex items-center space-x-3">             
                  {/* Refresh Button */}
                  <button
                    onClick={async () => {
                      setIsRefreshing(true);
                      await fetchCostData(analyticsApi.getCostsByService, setCostsByService, 'Costs by Service');
                      setIsRefreshing(false);
                    }}
                    disabled={isRefreshing}
                    className="flex items-center px-4 py-2 bg-[#FF9900] hover:bg-[#FF9900]/90 text-[#232F3E] rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
              </div>
            </div>

            {/* Charts Section */}
            <div className="mb-8 px-4 sm:px-6 lg:px-8">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="mb-4">
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    {activeChart === 'total' ? 'Total AWS Costs' : 'Costs by Service'}
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                    {activeChart === 'total'
                      ? 'Monthly total costs across all AWS services'
                      : 'Breakdown of costs by individual AWS service'
                    }
                  </p>
                </div>

                {/* Chart Container */}
                <div className="h-96">
                  {costsByService.loading ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#FF9900]"></div>
                    </div>
                  ) : costsByService.error ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <AlertTriangle className="mx-auto h-12 w-12 text-red-400" />
                        <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">Error loading data</h3>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{costsByService.error}</p>
                      </div>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPieChart>
                        <Pie
                          data={transformServiceCostData(costsByService.data)}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          outerRadius={160}
                          fill="#8884d8"
                          dataKey="amount"
                        >
                          {transformServiceCostData(costsByService.data).map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Legend */}
                {!costsByService.loading && !costsByService.error && costsByService.data && (
                  <div className="mt-6">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Service Breakdown</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {transformServiceCostData(costsByService.data).map((entry, index) => {
                        const percentage = ((entry.amount / serviceCostStats.total) * 100).toFixed(1);
                        return (
                          <div key={index} className="flex items-center space-x-2">
                            <div
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: entry.fill }}
                            ></div>
                            <div className="flex-1 min-w-0">
                              <span className="text-sm text-gray-700 dark:text-gray-300 truncate block">
                                {entry.service}
                              </span>
                            </div>
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {percentage}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Summary Cards */}
            <div className="mb-8 px-4 sm:px-6 lg:px-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Total Cost Card */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 text-center">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Cost (MTD)</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
                      {costsByService.loading ? '...' : formatCurrency(serviceCostStats.total)}
                    </p>
                  </div>
                  <div className="mt-4">
                    {costsByService.loading ? (
                      <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-50 dark:bg-gray-900/10 text-gray-600 dark:text-gray-400">
                        Analyzing...
                      </div>
                    ) : (
                      (() => {
                        const analysis = analyzeCost(serviceCostStats.total);
                        return (
                          <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${analysis.bgColor} ${analysis.color}`}>
                            {analysis.insight}
                          </div>
                        );
                      })()
                    )}
                  </div>
                </div>

                {/* Services Count Card */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 text-center">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Services Count</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
                      {costsByService.loading ? '...' : serviceCostStats.services}
                    </p>
                  </div>
                  <div className="mt-4">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Active AWS services</span>
                  </div>
                </div>

                {/* Average Cost per Service Card */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 text-center">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Avg Cost/Service</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
                      {costsByService.loading ? '...' : formatCurrency(serviceCostStats.average)}
                    </p>
                  </div>
                  <div className="mt-4">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Per service average</span>
                  </div>
                </div>

                {/* Highest Cost Service Card */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 text-center">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Highest Cost</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
                      {costsByService.loading ? '...' : formatCurrency(serviceCostStats.highest)}
                    </p>
                  </div>
                  <div className="mt-4">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Most expensive service</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Service Breakdown Table */}
            {costsByService.data && getAggregatedServiceData(costsByService.data).length > 0 && (
              <div className="mb-8 px-4 sm:px-6 lg:px-8">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">Service Cost Breakdown</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Detailed cost analysis by AWS service</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                            Service
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                            Cost
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                            Percentage
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {getAggregatedServiceData(costsByService.data)
                          .map((service, index) => {
                            const percentage = ((service.amount / serviceCostStats.total) * 100).toFixed(1);
                            const analysis = analyzeCost(service.amount);
                            return (
                              <tr key={`${service.service}-${index}`} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                                  {service.service}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                  {formatCurrency(service.amount)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                  {percentage}%
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${analysis.bgColor} ${analysis.color}`}>
                                    {analysis.insight}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
