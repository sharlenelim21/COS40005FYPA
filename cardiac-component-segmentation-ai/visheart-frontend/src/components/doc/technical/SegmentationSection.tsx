import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Zap } from "lucide-react";
import { DocImage } from "@/components/doc/DocImage";

export function SegmentationSection() {
  return (
    <div className="space-y-6 md:space-y-8 max-w-none">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold mb-4">
          How the Segmentation System Works
        </h2>
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
            Preview Dataset (Raw MRI Viewer)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The Preview Dataset viewer lets you browse the raw medical
            images without any mask overlay. It&apos;s available from
            the project page at every stage — before segmentation,
            after masks exist, and after reconstruction — for quick
            previewing and navigation.
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
                • Available anytime from the project page, regardless
                of segmentation or reconstruction status
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
                text: "Use Preview Dataset to browse raw MRI images anytime",
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
  );
}
