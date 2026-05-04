"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BookOpen, Zap, Info, Users, Play, Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface DocImageProps {
  src: string;
  alt: string;
  className?: string;
}

const DocImage: React.FC<DocImageProps> = ({ src, alt, className }) => {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div
        className={`flex items-center justify-center bg-muted/50 rounded-md border text-muted-foreground text-sm ${className ?? ""}`}
        style={{ minHeight: 120 }}
        aria-label={alt}
      >
        <span className="px-4 py-6 text-center">{alt}</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setErrored(true)}
    />
  );
};

// ---------------------------------------------------------------------------
// DocPage
// ---------------------------------------------------------------------------
const DocPage = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [faqSearch, setFaqSearch] = useState("");
  const [activeTab, setActiveTab] = useState("introduction");

  const navigationItems = [
    { value: "introduction", icon: Info, label: "Introduction" },
    { value: "getting-started", icon: BookOpen, label: "Getting Started" },
    { value: "accounts", icon: Users, label: "Accounts" },
    { value: "how-it-works", icon: Play, label: "How Segmentation Works" },
    {
      value: "reconstruction",
      icon: Zap,
      label: "How Reconstruction Works",
    },
  ];

  const docSearchData = [
    {
      tab: "introduction",
      title: "Introduction to VisHeart",
      keywords: [
        "introduction",
        "visheart",
        "ai-powered analysis",
        "3d visualization",
        "fast processing",
      ],
    },
    {
      tab: "getting-started",
      title: "Getting Started with VisHeart",
      keywords: [
        "getting started",
        "quick start",
        "create account",
        "upload medical images",
        "run segmentation",
        "view results",
        "nifti",
        "system requirements",
      ],
    },
    {
      tab: "accounts",
      title: "Account Types",
      keywords: [
        "accounts",
        "guest account",
        "user account",
        "feature comparison",
        "file upload",
        "cloud storage",
        "project management",
      ],
    },
    {
      tab: "how-it-works",
      title: "How the Segmentation System Works",
      keywords: [
        "segmentation",
        "mri viewer",
        "segmentation viewer",
        "manual editing",
        "upload",
        "project overview",
        "workflow summary",
      ],
    },
    {
      tab: "reconstruction",
      title: "3D/4D Reconstruction",
      keywords: [
        "reconstruction",
        "3d",
        "4d",
        "reference frame",
        "download results",
        "gpu inference",
      ],
    },
  ];

  const filteredDocs = docSearchData.filter((item) => {
    const query = docSearch.toLowerCase();
    return (
      item.title.toLowerCase().includes(query) ||
      item.keywords.some((keyword) => keyword.toLowerCase().includes(query))
    );
  });

  const faqData = [
    {
      question: "What file format is supported?",
      answer: "The system supports NIfTI (.nii.gz) files.",
    },
    {
      question: "What does segmentation do?",
      answer: "Segmentation identifies cardiac structures from MRI images.",
    },
    {
      question: "How do I start?",
      answer:
        "Create a project, upload MRI file, select model, and run segmentation.",
    },
  ];

  const filteredFAQ = faqData.filter((item) =>
    item.question.toLowerCase().includes(faqSearch.toLowerCase()) ||
    item.answer.toLowerCase().includes(faqSearch.toLowerCase())
  );

  const NavigationContent = ({
    onItemClick,
  }: {
    onItemClick?: () => void;
  }) => (
    <>
      <div className="p-4 md:p-6 border-b">
        <h2 className="font-semibold text-lg">Documentation</h2>
        <p className="text-sm text-muted-foreground">VisHeart Platform Guide</p>
      </div>
      <ScrollArea className="flex-1">
        <TabsList className="flex flex-col h-auto w-full bg-transparent p-4 space-y-1 items-stretch">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            return (
              <TabsTrigger
                key={item.value}
                value={item.value}
                onClick={onItemClick}
                className="w-full justify-start text-left h-auto py-2 px-3 data-[state=active]:bg-secondary"
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4" />
                  <span className="text-sm">{item.label}</span>
                </div>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </ScrollArea>
    </>
  );

  return (
    <div className="flex flex-col md:flex-row h-screen">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        orientation="vertical"
        className="w-full flex flex-col md:flex-row"
      >
        {/* Mobile Header with Menu Button */}
        <div className="md:hidden border-b bg-background sticky top-0 z-50">
          <div className="flex items-center justify-between p-4">
            <div>
              <h2 className="font-semibold text-lg">Documentation</h2>
              <p className="text-sm text-muted-foreground">
                VisHeart Platform Guide
              </p>
            </div>
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <NavigationContent
                  onItemClick={() => setMobileMenuOpen(false)}
                />
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* Desktop Navigation Sidebar */}
        <div className="hidden md:flex w-80 border-r bg-muted/30 flex-col flex-shrink-0">
          <NavigationContent />
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-background">
            <Input
              placeholder="Search help..."
              value={docSearch}
              onChange={(e) => setDocSearch(e.target.value)}
            />
          </div>

          {docSearch.trim() && (
            <div className="p-4 border-b bg-background space-y-2">
              <p className="text-sm font-medium">Search Results</p>

              {filteredDocs.length > 0 ? (
                filteredDocs.map((item) => (
                  <button
                    key={item.tab}
                    onClick={() => {
                      setActiveTab(item.tab);
                      setDocSearch("");
                    }}
                    className="block w-full text-left rounded-md border p-3 hover:bg-muted"
                  >
                    <p className="font-medium">{item.title}</p>
                    <p className="text-sm text-muted-foreground">
                      Go to {item.title}
                    </p>
                  </button>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No matching documentation found.
                </p>
              )}
            </div>
          )}

          {/* ── INTRODUCTION ── */}
          <TabsContent value="introduction" className="flex-1 m-0 h-full">
            <ScrollArea className="h-full w-full">
              <div className="p-4 md:p-8 w-full">
                <div className="space-y-6 max-w-none">
                  <div>
                    <h1 className="text-2xl md:text-3xl font-bold mb-4">
                      Introduction to VisHeart
                    </h1>
                    <p className="text-muted-foreground mb-6">
                      VisHeart is a cutting-edge cardiac segmentation platform
                      designed to revolutionize medical image analysis through
                      advanced artificial intelligence and intuitive user
                      interfaces.
                    </p>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
                        <Info className="w-5 h-5" />
                        About VisHeart
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Our platform combines state-of-the-art deep learning
                        algorithms with user-friendly visualization tools to
                        provide accurate cardiac structure segmentation from
                        medical imaging data.
                      </p>
                      <div className="grid gap-4">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-medium flex-shrink-0">
                            AI
                          </div>
                          <div>
                            <h4 className="font-semibold">
                              AI-Powered Analysis
                            </h4>
                            <p className="text-sm text-muted-foreground">
                              Advanced neural networks trained on extensive
                              cardiac imaging datasets.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-sm font-medium flex-shrink-0">
                            3D
                          </div>
                          <div>
                            <h4 className="font-semibold">3D Visualization</h4>
                            <p className="text-sm text-muted-foreground">
                              Interactive 3D rendering of cardiac structures for
                              comprehensive analysis.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-sm font-medium flex-shrink-0">
                            ⚡
                          </div>
                          <div>
                            <h4 className="font-semibold">Fast Processing</h4>
                            <p className="text-sm text-muted-foreground">
                              Efficient algorithms that deliver results in
                              minutes, not hours.
                            </p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle>Key Features</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2 text-sm">
                          <li>• Automated cardiac segmentation</li>
                          <li>• Real-time 3D visualization</li>
                          <li>• Multi-format support</li>
                          <li>• Cloud-based processing</li>
                          <li>• Export capabilities</li>
                        </ul>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle>Target Users</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2 text-sm">
                          <li>• Cardiologists</li>
                          <li>• Radiologists</li>
                          <li>• Medical researchers</li>
                          <li>• Clinical technicians</li>
                          <li>• Healthcare institutions</li>
                        </ul>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle>Use Cases</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2 text-sm">
                          <li>• Diagnostic imaging</li>
                          <li>• Treatment planning</li>
                          <li>• Research studies</li>
                          <li>• Education &amp; training</li>
                          <li>• Clinical trials</li>
                        </ul>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── GETTING STARTED ── */}
          <TabsContent value="getting-started" className="flex-1 m-0 h-full">
            <ScrollArea className="h-full w-full">
              <div className="p-4 md:p-8 w-full">
                <div className="space-y-6 max-w-none">
                  <div>
                    <h1 className="text-2xl md:text-3xl font-bold mb-4">
                      Getting Started with VisHeart
                    </h1>
                    <p className="text-muted-foreground mb-6">
                      Welcome to VisHeart, a comprehensive cardiac segmentation
                      platform that combines advanced AI-powered image analysis
                      with intuitive visualization tools.
                    </p>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
                        <Zap className="w-5 h-5" />
                        Quick Start
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-4">
                        {[
                          {
                            n: "1",
                            title: "Create an Account",
                            desc: "Sign up for a new account or log in with existing credentials.",
                          },
                          {
                            n: "2",
                            title: "Upload Medical Images",
                            desc: "Upload your NIfTI files for analysis.",
                          },
                          {
                            n: "3",
                            title: "Run Segmentation",
                            desc: "Let our AI analyze your cardiac images automatically.",
                          },
                          {
                            n: "4",
                            title: "View Results",
                            desc: "Analyze the segmented results with our interactive visualization tools.",
                          },
                        ].map((step) => (
                          <div key={step.n} className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium flex-shrink-0">
                              {step.n}
                            </div>
                            <div>
                              <h4 className="font-semibold">{step.title}</h4>
                              <p className="text-sm text-muted-foreground">
                                {step.desc}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base md:text-lg">
                          System Requirements
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2 text-sm">
                          <li>
                            • Modern web browser (Chrome, Firefox, Safari, Edge)
                          </li>
                          <li>• Stable internet connection</li>
                          <li>• JavaScript enabled</li>
                          <li>• Minimum 4GB RAM recommended</li>
                        </ul>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base md:text-lg">
                          Supported Formats
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">NIfTI</Badge>
                          <Badge variant="secondary">.nii.gz</Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── ACCOUNTS ── */}
          <TabsContent value="accounts" className="flex-1 m-0 h-full">
            <ScrollArea className="h-full w-full">
              <div className="p-4 md:p-8 w-full">
                <div className="space-y-6 max-w-none">
                  <div>
                    <h1 className="text-2xl md:text-3xl font-bold mb-4">
                      Account Types
                    </h1>
                    <p className="text-muted-foreground mb-6">
                      Compare the features and capabilities available for Guest
                      and Registered User accounts.
                    </p>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg md:text-xl">
                        Feature Comparison
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-1/3 text-xs md:text-sm">
                              Feature
                            </TableHead>
                            <TableHead className="text-center text-xs md:text-sm">
                              Guest Account
                            </TableHead>
                            <TableHead className="text-center text-xs md:text-sm">
                              User Account
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[
                            ["File Upload", "✓", "✓"],
                            ["Cardiac Segmentation", "✓", "✓"],
                            ["3D/4D Visualization", "✓", "✓"],
                            ["Export Results", "✓", "✓"],
                            ["File Saving", "✗", "✓"],
                            ["Project Management", "✗", "✓"],
                            ["Processing History", "✗", "✓"],
                            ["Cloud Storage", "✗", "✓"],
                          ].map(([feature, guest, user]) => (
                            <TableRow key={feature}>
                              <TableCell className="font-medium text-xs md:text-sm">
                                {feature}
                              </TableCell>
                              <TableCell className="text-center text-xs md:text-sm">
                                {guest}
                              </TableCell>
                              <TableCell className="text-center text-xs md:text-sm">
                                {user}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base md:text-lg">
                          Guest Account
                        </CardTitle>
                        <Badge variant="secondary" className="w-fit">
                          Free
                        </Badge>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground mb-4">
                          Perfect for trying out the platform and performing
                          quick analysis tasks.
                        </p>
                        <ul className="space-y-2 text-sm">
                          <li>• Immediate access without registration</li>
                          <li>• Full segmentation capabilities</li>
                          <li>• Limited to session-based work</li>
                          <li>• No data persistence</li>
                        </ul>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base md:text-lg">
                          User Account
                        </CardTitle>
                        <Badge variant="default" className="w-fit">
                          Free Registration
                        </Badge>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground mb-4">
                          Full platform access with data persistence and project
                          management.
                        </p>
                        <ul className="space-y-2 text-sm">
                          <li>• All guest features included</li>
                          <li>• Save and organize projects</li>
                          <li>• Access processing history</li>
                          <li>• Cloud storage integration</li>
                        </ul>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── HOW SEGMENTATION WORKS ── */}
          <TabsContent value="how-it-works" className="flex-1 m-0 h-full">
            <ScrollArea className="h-full w-full">
              <div className="p-4 md:p-8 w-full">
                <div className="space-y-6 md:space-y-8 max-w-none">
                  <div>
                    <h1 className="text-2xl md:text-3xl font-bold mb-4">
                      How the Segmentation System Works
                    </h1>
                    <p className="text-muted-foreground mb-6">
                      Follow this comprehensive guide to understand the complete
                      workflow from project creation to cardiac segmentation
                      results.
                    </p>
                  </div>

                  {/* Steps 1-8 */}
                  {[
                    {
                      num: "1",
                      color: "bg-blue-500",
                      title: "Welcome to VisHeart",
                      desc: "Start your journey with VisHeart's intuitive homepage. Here you'll find the main entry points to access the platform.",
                      src: "/images/doc/homescreen.png",
                      alt: "VisHeart Homepage",
                      caption:
                        "The VisHeart homepage with key features highlighted and easy access to get started.",
                    },
                    {
                      num: "2",
                      color: "bg-blue-500",
                      title: "Dashboard Overview",
                      desc: "Your dashboard provides a comprehensive overview of your projects, GPU status, and system statistics.",
                      src: "/images/doc/dashboard-overview.png",
                      alt: "Dashboard Overview",
                      caption:
                        "Dashboard overview showing project statistics, GPU status, and quick access to new project creation.",
                    },
                    {
                      num: "3",
                      color: "bg-green-500",
                      title: "Starting Fresh",
                      desc: "When you first access the Projects tab, you'll see a clean interface ready for your first medical imaging project.",
                      src: "/images/doc/dashboard-project-no-projects.png",
                      alt: "Empty Projects Dashboard",
                      caption:
                        "Empty projects dashboard with clear call-to-action to upload your first project.",
                    },
                  ].map((step) => (
                    <Card key={step.num}>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                          <div
                            className={`w-8 h-8 rounded-full ${step.color} text-white flex items-center justify-center text-sm font-bold flex-shrink-0`}
                          >
                            {step.num}
                          </div>
                          {step.title}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          {step.desc}
                        </p>
                        <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
                          <DocImage
                            src={step.src}
                            alt={step.alt}
                            className="w-full h-auto rounded-md border shadow-sm"
                          />
                          <p className="text-xs text-muted-foreground mt-2">
                            {step.caption}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  {/* Step 4 — two images */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                        <div className="w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                          4
                        </div>
                        Upload Your Medical Images
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        The upload process is straightforward — simply drag and
                        drop or click to browse for your medical imaging files.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
                          <DocImage
                            src="/images/doc/dashboard-project-upload-new-project.png"
                            alt="Upload Dialog"
                            className="w-full h-auto rounded-md border shadow-sm"
                          />
                          <p className="text-xs text-muted-foreground mt-2">
                            Upload dialog with drag-and-drop interface for
                            medical imaging files.
                          </p>
                        </div>
                        <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
                          <DocImage
                            src="/images/doc/dashboard-project-upload-new-project-with-file-added.png"
                            alt="Upload Dialog with File"
                            className="w-full h-auto rounded-md border shadow-sm"
                          />
                          <p className="text-xs text-muted-foreground mt-2">
                            Upload dialog showing selected file with metadata
                            and project configuration options.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Step 5 — two images */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                        <div className="w-8 h-8 rounded-full bg-purple-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                          5
                        </div>
                        Project Management
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Once uploaded, your projects appear in the dashboard
                        with detailed information and management options.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
                          <DocImage
                            src="/images/doc/dashboard-project-with-1-project.png"
                            alt="Project Card"
                            className="w-full h-auto rounded-md border shadow-sm"
                          />
                          <p className="text-xs text-muted-foreground mt-2">
                            Project card showing uploaded project with &quot;No
                            Masks&quot; status, ready for segmentation.
                          </p>
                        </div>
                        <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
                          <DocImage
                            src="/images/doc/dashboard-project-with-1-project-saved.png"
                            alt="Saved Project Card"
                            className="w-full h-auto rounded-md border shadow-sm"
                          />
                          <p className="text-xs text-muted-foreground mt-2">
                            Project card showing saved project with persistent
                            storage status.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Step 6 — two images */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                        <div className="w-8 h-8 rounded-full bg-purple-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                          6
                        </div>
                        Project Details &amp; AI Segmentation
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Access detailed project information and start the
                        AI-powered segmentation process with a single click.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
                          <DocImage
                            src="/images/doc/project-overview.png"
                            alt="Project Overview"
                            className="w-full h-auto rounded-md border shadow-sm"
                          />
                          <p className="text-xs text-muted-foreground mt-2">
                            Detailed project overview showing technical
                            specifications and segmentation controls.
                          </p>
                        </div>
                        <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
                          <DocImage
                            src="/images/doc/project-overview-segmentation-done.png"
                            alt="Completed Segmentation"
                            className="w-full h-auto rounded-md border shadow-sm"
                          />
                          <p className="text-xs text-muted-foreground mt-2">
                            Project view after successful segmentation showing
                            available masks and editing options.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Step 7 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                        <div className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                          7
                        </div>
                        MRI Viewer (Before Segmentation)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        When segmentation masks are not yet available or
                        processing is pending, the MRI viewer allows you to
                        preview and examine your medical images.
                      </p>
                      <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
                        <DocImage
                          src="/images/doc/project-preview.png"
                          alt="MRI Viewer"
                          className="w-full h-auto rounded-md border shadow-sm"
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                          MRI viewer interface with frame navigation, zoom
                          controls, and image display options.
                        </p>
                      </div>
                      <div className="p-2 md:p-4 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                        <p className="text-sm font-medium mb-1">
                          📋 MRI Viewer Features
                        </p>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          <li>
                            • Frame-by-frame navigation through medical image
                            slices
                          </li>
                          <li>• Zoom and pan controls for detailed examination</li>
                          <li>
                            • Technical specifications display (dimensions, voxel
                            size)
                          </li>
                          <li>• Thumbnail overview of all frames</li>
                          <li>
                            • Available when masks are not generated or processing
                            is pending
                          </li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Step 8 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                        <div className="w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                          8
                        </div>
                        Segmentation Viewer &amp; Manual Editing
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Once AI segmentation is complete, the segmentation
                        viewer becomes available with advanced editing tools.
                      </p>
                      <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
                        <DocImage
                          src="/images/doc/project-segmentation.png"
                          alt="Segmentation Viewer"
                          className="w-full h-auto rounded-md border shadow-sm"
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                          Segmentation viewer with precision drawing tools,
                          brush settings, mask overlays, and full medical image
                          access.
                        </p>
                      </div>
                      <div className="p-2 md:p-4 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
                        <p className="text-sm font-medium mb-1">
                          🎨 Segmentation Viewer Features
                        </p>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          <li>
                            •{" "}
                            <strong>All MRI viewer capabilities</strong> — frame
                            navigation, zoom, pan, thumbnails
                          </li>
                          <li>
                            • Advanced drawing tools (brush, select, linear tool)
                          </li>
                          <li>
                            • Mask overlay toggle and opacity controls
                          </li>
                          <li>• Brush size and opacity adjustments</li>
                          <li>• Undo/redo functionality for precise editing</li>
                          <li>• Real-time mask preview and editing</li>
                          <li>
                            • Available only after successful AI segmentation
                          </li>
                        </ul>
                      </div>
                      <div className="p-2 md:p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                        <p className="text-sm font-medium mb-1">
                          💡 Important Note
                        </p>
                        <p className="text-sm text-muted-foreground">
                          The original medical images remain fully accessible in
                          the segmentation viewer. You can toggle between viewing
                          the raw medical data and the segmented masks, or view
                          them overlaid together for precise editing.
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Workflow Summary */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                        <Zap className="w-5 h-5 flex-shrink-0" />
                        Complete Workflow Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-3">
                        {[
                          {
                            n: "1",
                            c: "bg-blue-500",
                            bg: "bg-blue-50 dark:bg-blue-950/30",
                            border: "border-blue-200 dark:border-blue-800",
                            text: "Start from the homepage and navigate to the dashboard",
                          },
                          {
                            n: "2",
                            c: "bg-green-500",
                            bg: "bg-green-50 dark:bg-green-950/30",
                            border: "border-green-200 dark:border-green-800",
                            text: "Upload your medical imaging files (NIfTI)",
                          },
                          {
                            n: "3",
                            c: "bg-purple-500",
                            bg: "bg-purple-50 dark:bg-purple-950/30",
                            border: "border-purple-200 dark:border-purple-800",
                            text: "Review project details and start AI segmentation",
                          },
                          {
                            n: "4",
                            c: "bg-orange-500",
                            bg: "bg-orange-50 dark:bg-orange-950/30",
                            border: "border-orange-200 dark:border-orange-800",
                            text: "Use MRI viewer to preview images (before segmentation)",
                          },
                          {
                            n: "5",
                            c: "bg-red-500",
                            bg: "bg-red-50 dark:bg-red-950/30",
                            border: "border-red-200 dark:border-red-800",
                            text: "Access segmentation viewer for advanced editing (after AI processing)",
                          },
                        ].map((s) => (
                          <div
                            key={s.n}
                            className={`flex items-center gap-3 p-2 md:p-3 rounded-lg ${s.bg} border ${s.border}`}
                          >
                            <div
                              className={`w-6 h-6 rounded-full ${s.c} text-white flex items-center justify-center text-xs font-bold flex-shrink-0`}
                            >
                              {s.n}
                            </div>
                            <span className="text-xs md:text-sm">{s.text}</span>
                          </div>
                        ))}
                      </div>
                      <div className="p-2 md:p-4 rounded-lg bg-muted/50 border-l-4 border-primary">
                        <p className="text-sm font-medium mb-1">Pro Tip</p>
                        <p className="text-sm text-muted-foreground">
                          Register for a user account to save your projects
                          permanently and access advanced project management
                          features. Guest accounts provide full functionality but
                          projects are only available during your session.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── RECONSTRUCTION ── */}
          <TabsContent value="reconstruction" className="flex-1 m-0 h-full">
            <ScrollArea className="h-full w-full">
              <div className="p-4 md:p-8 w-full">
                <div className="space-y-6 md:space-y-8 max-w-none">
                  <div>
                    <h1 className="text-2xl md:text-3xl font-bold mb-4">
                      3D/4D Reconstruction
                    </h1>
                    <p className="text-muted-foreground mb-6">
                      Follow this comprehensive guide to run 3D/4D
                      reconstructions. It walks you through preparing your
                      project, choosing a reference frame, submitting a
                      reconstruction job, monitoring progress, and downloading
                      results.
                    </p>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                        <Zap className="w-5 h-5 flex-shrink-0" />
                        Overview
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Reconstruction converts segmentation masks into 3D
                        meshes of cardiac structures (myocardium). 4D
                        reconstruction produces time-resolved mesh sequences
                        across cardiac frames to represent motion. The system
                        runs reconstructions on the GPU inference service and
                        stores results in cloud storage for download and further
                        analysis.
                      </p>
                      <div className="grid gap-4">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-sm font-medium flex-shrink-0">
                            3D
                          </div>
                          <div>
                            <h4 className="font-semibold">3D Reconstruction</h4>
                            <p className="text-sm text-muted-foreground">
                              Single mesh reconstruction generated from a MRI
                              scan with only one frame.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-sm font-medium flex-shrink-0">
                            4D
                          </div>
                          <div>
                            <h4 className="font-semibold">
                              4D (Time-series) Reconstruction
                            </h4>
                            <p className="text-sm text-muted-foreground">
                              Mesh sequence generated for multiple frames to
                              capture cardiac motion across time.
                            </p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Step 1 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                        <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                          1
                        </div>
                        Starting a Reconstruction Job
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Ensure segmentation has been completed for your project
                        first — reconstruction uses those results. Open the
                        project and click{" "}
                        <strong>Create 4D Reconstruction</strong>.
                      </p>
                      <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
                        <DocImage
                          src="/images/doc/project-reconstruction-overview.png"
                          alt="Project reconstruction overview"
                          className="w-full h-auto rounded-md border shadow-sm"
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                          Project overview with Create 4D Reconstruction button
                          to start the process.
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Step 2 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                        <div className="w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                          2
                        </div>
                        Configure 4D Reconstruction
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Configure the parameters for generating your 4D cardiac
                        reconstruction. Defaults are optimized to balance
                        quality and speed.
                      </p>
                      <div className="grid gap-3">
                        <div>
                          <h4 className="font-semibold text-sm">
                            Export format
                          </h4>
                          <div className="text-sm text-muted-foreground space-y-2 pl-3">
                            <p>
                              •{" "}
                              <strong>GLB (Recommended)</strong> — Binary glTF
                              2.0 optimized for web viewing.
                            </p>
                            <p>
                              •{" "}
                              <strong>OBJ (Wavefront)</strong> — Plain text
                              format, widely supported.
                            </p>
                          </div>
                        </div>
                        <div>
                          <h4 className="font-semibold text-sm">
                            End-diastole frame
                          </h4>
                          <p className="text-sm text-muted-foreground">
                            Default: <strong>Frame 1</strong>. Select the
                            cardiac end-diastole frame representing the relaxed
                            state of the heart.
                          </p>
                        </div>
                        <div>
                          <h4 className="font-semibold text-sm">
                            Advanced settings
                          </h4>
                          <div className="text-sm text-muted-foreground space-y-2 pl-3">
                            <p>
                              • <strong>SDF optimizer iterations:</strong>{" "}
                              Default 30 (range 10–200).
                            </p>
                            <p>
                              • <strong>Marching cubes resolution:</strong>{" "}
                              Default 32 (range 32–256).
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
                          <DocImage
                            src="/images/doc/project-reconstruction-configuration.png"
                            alt="Configure modal"
                            className="w-full h-auto rounded-md border shadow-sm"
                          />
                          <p className="text-xs text-muted-foreground mt-2">
                            Configuration panel with export format, ED frame
                            selector, and basic parameters.
                          </p>
                        </div>
                        <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
                          <DocImage
                            src="/images/doc/project-reconstruction-configuration-advanced.png"
                            alt="Advanced settings panel"
                            className="w-full h-auto rounded-md border shadow-sm"
                          />
                          <p className="text-xs text-muted-foreground mt-2">
                            Advanced settings with SDF optimizer iterations and
                            marching cubes resolution controls.
                          </p>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Click <strong>Start Reconstruction</strong> to submit.
                      </p>
                    </CardContent>
                  </Card>

                  {/* Step 3 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                        <div className="w-8 h-8 rounded-full bg-purple-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                          3
                        </div>
                        Inspect &amp; Visualize Results
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        After reconstruction completes, you can visualize the 4D
                        model with playback controls and compare it side-by-side
                        with segmentation.
                      </p>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        <li>
                          • Inspect the 4D model with playback controls to
                          review cardiac motion frame-by-frame
                        </li>
                        <li>
                          • Toggle side-by-side view to compare segmentation
                          masks and reconstructed mesh
                        </li>
                        <li>
                          • Focus on full-screen 4D viewer with timeline
                          controls for detailed analysis
                        </li>
                        <li>
                          • If you re-edit segmentation masks, re-run
                          reconstruction to update the 4D model
                        </li>
                      </ul>
                      <div className="rounded-lg border bg-muted/30 p-2 md:p-4 mt-4">
                        <DocImage
                          src="/images/doc/project-reconstruction.png"
                          alt="Reconstruction results"
                          className="w-full h-auto rounded-md border shadow-sm"
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                          Reconstruction results showing completed 4D
                          reconstruction with metadata and view options.
                        </p>
                      </div>
                      <div className="rounded-lg border bg-muted/30 p-2 md:p-4 mt-4">
                        <DocImage
                          src="/images/doc/project-reconsturction-view.png"
                          alt="4D reconstruction viewer"
                          className="w-full h-auto rounded-md border shadow-sm"
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                          Interactive 4D viewer with side-by-side segmentation
                          comparison and playback timeline controls.
                        </p>
                      </div>
                      <div className="p-2 md:p-4 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 mt-4">
                        <p className="text-sm font-medium mb-1">
                          💡 Important Note
                        </p>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          <li>
                            • If you make changes to your segmentation masks,
                            you can{" "}
                            <strong>re-run reconstruction</strong> to update the
                            4D model.
                          </li>
                          <li>
                            • You can also{" "}
                            <strong>delete existing reconstructions</strong> and
                            create new ones with different parameters.
                          </li>
                          <li>
                            • Reconstruction models are regenerated based on the
                            current segmentation state.
                          </li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Step 4 */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                        <div className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                          4
                        </div>
                        Complete Project Details &amp; Management
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Access comprehensive project information including
                        segmentation masks, reconstruction details, job history,
                        metadata, and storage statistics all in one place.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
                          <DocImage
                            src="/images/doc/project-reconstruction-details.png"
                            alt="Project details overview"
                            className="w-full h-auto rounded-md border shadow-sm"
                          />
                          <p className="text-xs text-muted-foreground mt-2">
                            Comprehensive project details with metadata, storage
                            statistics, and segmentation/reconstruction
                            information.
                          </p>
                        </div>
                        <div className="rounded-lg border bg-muted/30 p-2 md:p-4">
                          <DocImage
                            src="/images/doc/project-reconstruction-details2.png"
                            alt="Project management actions"
                            className="w-full h-auto rounded-md border shadow-sm"
                          />
                          <p className="text-xs text-muted-foreground mt-2">
                            Project management panel with export and reset
                            options for easy data management.
                          </p>
                        </div>
                      </div>
                      <div className="p-2 md:p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 mt-4">
                        <p className="text-sm font-medium mb-1">
                          ⚠️ Reset Masks Warning
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Using the <strong>Reset Masks</strong> option will
                          permanently delete all segmentation masks and
                          reconstruction data. This action cannot be undone.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </div>

        {/* FAQ Button */}
        <Button
          className="fixed bottom-6 right-6"
          onClick={() => setShowFAQ(true)}
        >
          FAQ
        </Button>

        {showFAQ && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-background p-6 rounded-lg w-[500px] max-h-[80vh] overflow-y-auto">
              <h2 className="text-xl font-bold mb-4">FAQ</h2>
              <Input
                placeholder="Search FAQ."
                value={faqSearch}
                onChange={(e) => setFaqSearch(e.target.value)}
                className="mb-4"
              />
              <div className="space-y-3">
                {filteredFAQ.map((item, index) => (
                  <div key={index}>
                    <p className="font-medium">{item.question}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.answer}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <Button onClick={() => setShowFAQ(false)}>Close</Button>
              </div>
            </div>
          </div>
        )}
      </Tabs>
    </div>
  );
};

export default DocPage;
