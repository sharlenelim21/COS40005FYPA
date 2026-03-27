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
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Info,
  Zap,
  AlertTriangle,
  CheckCircle,
  RefreshCw
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
import { MetricData, CostData } from '@/types/system-monitor';

export default function AnalyticsDashboard() {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const [showQuickActions, setShowQuickActions] = useState(false);

  // Quick stats state
  const [cpuMetrics, setCpuMetrics] = useState<MetricData | null>(null);
  const [ecrFrontendImageCount, setEcrFrontendImageCount] = useState<MetricData | null>(null);
  const [ecrBackendImageCount, setEcrBackendImageCount] = useState<MetricData | null>(null);
  const [s3StorageSize, setS3StorageSize] = useState<MetricData | null>(null);
  const [albRequestCount, setAlbRequestCount] = useState<MetricData | null>(null);
  const [asgHealthyInstances, setAsgHealthyInstances] = useState<MetricData | null>(null);
  const [totalCosts, setTotalCosts] = useState<CostData[] | null>(null);
  const [quickStatsLoading, setQuickStatsLoading] = useState(true);

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

  // Fetch quick stats data
  useEffect(() => {
    const fetchQuickStats = async () => {
      setQuickStatsLoading(true);
      try {
        // Fetch all metrics in parallel
        const [
          cpuData,
          ecrFrontendImageData,
          ecrBackendImageData,
          albRequestData,
          asgHealthyData,
          costData
        ] = await Promise.all([
          analyticsApi.getCpuMetrics(),
          analyticsApi.getEcrFrontendImageCountMetrics(),
          analyticsApi.getEcrBackendImageCountMetrics(),
          analyticsApi.getALBRequestCountMetrics(),
          analyticsApi.getASGGroupInServiceInstancesMetrics(),
          analyticsApi.getTotalCosts()
        ]);

        setCpuMetrics(cpuData);
        setEcrFrontendImageCount(ecrFrontendImageData);
        setEcrBackendImageCount(ecrBackendImageData);
        setAlbRequestCount(albRequestData);
        setAsgHealthyInstances(asgHealthyData);
        setTotalCosts(costData);
      } catch (error) {
        console.error('Failed to fetch quick stats:', error);
      } finally {
        setQuickStatsLoading(false);
      }
    };

    fetchQuickStats();
  }, []);

  // Helper functions to format data
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getLatestValue = (data: MetricData | null): number => {
    if (!data || !data.values || data.values.length === 0) return 0;
    return data.values[data.values.length - 1] || 0;
  };

  const getTotalEcrImages = (): number => {
    const frontendCount = getLatestValue(ecrFrontendImageCount);
    const backendCount = getLatestValue(ecrBackendImageCount);
    return frontendCount + backendCount;
  };

  const getTotalCost = (costData: CostData[] | null): number => {
    if (!costData || costData.length === 0) return 0;
    return costData.reduce((sum, item) => sum + item.amount, 0);
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

  const serviceCards = [
    {
      title: 'Elastic Compute Cloud | EC2',
      description: 'Monitor CPU utilization, network traffic, and disk I/O for your EC2 instances',
      path: '/admin/analytics/ec2',
      icon: ResourceAmazonEC2Instance,
      color: 'from-gray-200 to-gray-300',
      bgColor: 'bg-orange-50',
      borderColor: 'border-orange-200',
      textColor: 'text-orange-800',
      metrics: ['CPU Utilization', 'Network In/Out', 'Disk Read/Write']
    },
    {
      title: 'Elastic Container Registry | ECR',
      description: 'Track repository pull counts and image deployment metrics',
      path: '/admin/analytics/ecr',
      icon: ArchitectureServiceAmazonElasticContainerRegistry,
      color: 'from-gray-200 to-gray-300',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
      textColor: 'text-blue-800',
      metrics: ['Repository Size', 'Image Counts']
    },
    {
      title: 'S3 Storage | S3',
      description: 'Analyze bucket size, object counts, and data transfer patterns',
      path: '/admin/analytics/s3',
      icon: ArchitectureServiceAmazonSimpleStorageService,
      color: 'from-gray-200 to-gray-300',
      bgColor: 'bg-green-50',
      borderColor: 'border-green-200',
      textColor: 'text-green-800',
      metrics: ['Bucket Size', 'Object Count', 'Request Count']
    },
    {
      title: 'Application Load Balancers | ALB',
      description: 'Monitor ALB performance, request counts, and response times',
      path: '/admin/analytics/alb',
      icon: ResourceElasticLoadBalancingApplicationLoadBalancer,
      color: 'from-gray-200 to-gray-300',
      bgColor: 'bg-purple-50',
      borderColor: 'border-purple-200',
      textColor: 'text-purple-800',
      metrics: ['Request Count', 'Response Time', 'Healthy/Unhealthy Hosts']
    },
    {
      title: 'Auto Scaling Groups | ASG',
      description: 'Track ASG scaling activities and instance lifecycle metrics',
      path: '/admin/analytics/asg',
      icon: ArchitectureServiceAWSAutoScaling,
      color: 'from-gray-200 to-gray-300',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200',
      textColor: 'text-red-800',
      metrics: ['Group Size', 'Scaling Events']
    },
    {
      title: 'Cost Analytics/Metrics',
      description: 'Monitor AWS spending patterns and cost optimization opportunities',
      path: '/admin/analytics/cost',
      icon: ArchitectureServiceAWSCostExplorer,
      color: 'from-gray-200 to-gray-300',
      bgColor: 'bg-yellow-50',
      borderColor: 'border-yellow-200',
      textColor: 'text-yellow-800',
      metrics: ['Service Costs', 'Total Billing', 'Budget Alerts']
    }
  ];

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
            {/* Header with Quick Actions */}
            <div className="flex items-center justify-between mb-6">
              <div className={`flex items-center space-x-2 ${sidebarCollapsed ? 'justify-center' : ''}`}>
                <Activity className="h-5 w-5 text-[#FF9900]" />
                {!sidebarCollapsed && (
                  <h2 className="text-lg font-semibold text-white dark:text-gray-100">Services</h2>
                )}
              </div>
              {!sidebarCollapsed && (
                <button
                  onClick={() => setShowQuickActions(!showQuickActions)}
                  className="p-1.5 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors"
                  title="Quick Actions"
                >
                  <Zap className="h-4 w-4 text-[#FF9900]" />
                </button>
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
                      onMouseEnter={() => setActiveTooltip(item.name)}
                      onMouseLeave={() => setActiveTooltip(null)}
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

                    {/* Enhanced Tooltip */}
                    {activeTooltip === item.name && !sidebarCollapsed && (
                      <div className="absolute left-full ml-2 top-0 z-50 bg-gray-900 text-white text-sm rounded-md px-3 py-2 shadow-lg border border-gray-700 max-w-xs">
                        <div className="font-medium">{item.name} Analytics</div>
                        <div className="text-gray-300 text-xs mt-1">
                          Monitor and analyze {item.name.toLowerCase()} performance metrics
                        </div>
                        <div className="absolute -left-1 top-2 w-2 h-2 bg-gray-900 border-l border-t border-gray-700 transform rotate-45"></div>
                      </div>
                    )}
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
                <div className="flex items-center justify-between px-3">
                  <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Quick Stats</h3>
                  <button
                    onClick={async () => {
                      setQuickStatsLoading(true);
                      try {
                        const [
                          cpuData,
                          ecrFrontendImageData,
                          ecrBackendImageData,
                          albRequestData,
                          asgHealthyData,
                          costData
                        ] = await Promise.all([
                          analyticsApi.getCpuMetrics(),
                          analyticsApi.getEcrFrontendImageCountMetrics(),
                          analyticsApi.getEcrBackendImageCountMetrics(),
                          analyticsApi.getALBRequestCountMetrics(),
                          analyticsApi.getASGGroupInServiceInstancesMetrics(),
                          analyticsApi.getTotalCosts()
                        ]);

                        setCpuMetrics(cpuData);
                        setEcrFrontendImageCount(ecrFrontendImageData);
                        setEcrBackendImageCount(ecrBackendImageData);
                        setAlbRequestCount(albRequestData);
                        setAsgHealthyInstances(asgHealthyData);
                        setTotalCosts(costData);
                      } catch (error) {
                        console.error('Failed to refresh quick stats:', error);
                      } finally {
                        setQuickStatsLoading(false);
                      }
                    }}
                    disabled={quickStatsLoading}
                    className="text-gray-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Refresh quick stats"
                  >
                    <RefreshCw className={`h-3 w-3 ${quickStatsLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                <div className="space-y-2">
                  {/* EC2 Stats */}
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">
                      <span className="text-orange-400 font-medium">EC2</span> | CPU Utilization
                    </span>
                    <span className="text-sm font-medium text-orange-400 group-hover:text-orange-300">
                      {quickStatsLoading ? '...' : `${getLatestValue(cpuMetrics).toFixed(1)}%`}
                    </span>
                  </div>

                  {/* ECR Stats */}
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">
                      <span className="text-blue-400 font-medium">ECR</span> | Images
                    </span>
                    <span className="text-sm font-medium text-blue-400 group-hover:text-blue-300">
                      {quickStatsLoading ? '...' : Math.round(getTotalEcrImages())}
                    </span>
                  </div>

                  {/* S3 Stats */}
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">
                      <span className="text-green-400 font-medium">S3</span> | Storage Used
                    </span>
                    <span className="text-sm font-medium text-green-400 group-hover:text-green-300">
                      {quickStatsLoading ? '...' : 'N/A'}
                    </span>
                  </div>

                  {/* ALB Stats */}
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">
                      <span className="text-purple-400 font-medium">ALB</span> | Requests/min
                    </span>
                    <span className="text-sm font-medium text-purple-400 group-hover:text-purple-300">
                      {quickStatsLoading ? '...' : `${(getLatestValue(albRequestCount) / 60).toFixed(1)}K`}
                    </span>
                  </div>

                  {/* ASG Stats */}
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">
                      <span className="text-red-400 font-medium">ASG</span> | Healthy Instances
                    </span>
                    <span className="text-sm font-medium text-red-400 group-hover:text-red-300">
                      {quickStatsLoading ? '...' : Math.round(getLatestValue(asgHealthyInstances))}
                    </span>
                  </div>

                  {/* Cost Stats */}
                  <div className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-[#2D3748] transition-colors cursor-pointer group">
                    <span className="text-sm text-gray-300 dark:text-gray-300 group-hover:text-white">
                      <span className="text-yellow-400 font-medium">Cost</span> | Monthly Bill
                    </span>
                    <span className="text-sm font-medium text-yellow-400 group-hover:text-yellow-300">
                      {quickStatsLoading ? '...' : `$${getTotalCost(totalCosts).toFixed(0)}`}
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
              </ol>
            </nav>

            {/* Header Section */}
            <div className="mb-8 px-4 sm:px-6 lg:px-8">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 transition-colors">AWS Analytics Dashboard</h1>
              <p className="text-gray-600 dark:text-gray-300 text-lg transition-colors">
                Monitoring and analytics for the AWS infrastructure and services
              </p>
            </div>

            {/* Service Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 px-4 sm:px-6 lg:px-8 mb-8">
              {serviceCards.map((service) => {
                const Icon = service.icon;
                return (
                  <Link
                    key={service.title}
                    href={service.path}
                    className="group block bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
                  >
                    <div className="p-6">
                      {/* Service Header */}
                      <div className="flex items-center justify-between mb-4">
                        <div className={`p-4 rounded-lg bg-gradient-to-r ${service.color} shadow-lg`}>
                          <Icon className="h-12 w-12 text-white" />
                        </div>
                      </div>

                      {/* Service Content */}
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 group-hover:text-[#FF9900] transition-colors">
                        {service.title}
                      </h3>
                      <p className="text-gray-600 dark:text-gray-300 text-sm mb-4 leading-relaxed transition-colors">
                        {service.description}
                      </p>

                      {/* Metrics Preview */}
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Key Metrics</p>
                        <div className="flex flex-wrap gap-1">
                          {service.metrics.map((metric) => (
                            <span
                              key={metric}
                              className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                            >
                              {metric}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Action Indicator */}
                      <div className="mt-4 flex items-center text-[#FF9900] group-hover:text-[#FF9900]/80 transition-colors">
                        <span className="text-sm font-medium">View Details</span>
                        <svg className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}