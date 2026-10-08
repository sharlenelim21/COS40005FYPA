import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";

export function GettingStartedSection() {
  return (
    <div className="space-y-6 max-w-none">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold mb-4">
          Getting Started with VisHeart
        </h2>
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
  );
}
