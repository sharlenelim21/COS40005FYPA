import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info } from "lucide-react";

export function IntroductionSection() {
  return (
    <div className="space-y-6 max-w-none">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold mb-4">
          Introduction to VisHeart
        </h2>
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
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium flex-shrink-0">
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
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium flex-shrink-0">
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
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium flex-shrink-0">
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
  );
}
