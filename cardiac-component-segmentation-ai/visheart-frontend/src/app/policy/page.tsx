"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Shield, Clock, Users, Database, FileText } from "lucide-react";

export default function PolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Button variant="ghost" asChild className="mb-6 text-muted-foreground hover:text-foreground">
            <Link href="/" className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Home
            </Link>
          </Button>

          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-muted rounded-lg">
                <Shield className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <h1 className="text-4xl font-bold text-foreground tracking-tight">Privacy Policy</h1>
                <p className="text-sm text-muted-foreground mt-1">Effective Date: September 2, 2025</p>
              </div>
            </div>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-3xl">
              This Privacy Policy outlines how VisHeart handles information in our university final-year project demonstration. 
              We are committed to protecting your privacy and being transparent about our data practices.
            </p>
          </div>
        </div>

        {/* Main Content */}
        <div className="space-y-8">
          {/* Information We Collect */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-xl text-foreground">
                <div className="p-2 bg-muted rounded-md">
                  <Database className="h-5 w-5 text-muted-foreground" />
                </div>
                1. Information We Collect
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-foreground leading-relaxed">
                This web application may collect basic information such as names, email addresses, 
                and login credentials for demonstration purposes only.
              </p>
              <div className="bg-muted/30 p-4 rounded-lg border">
                <h4 className="font-medium text-foreground mb-2">Academic Demonstration Only</h4>
                <p className="text-sm text-muted-foreground">
                  All data collection is strictly for educational demonstration purposes as part of a university final-year project.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* How We Use Information */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-xl text-foreground">
                <div className="p-2 bg-muted rounded-md">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </div>
                2. How We Use Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full mt-2.5 flex-shrink-0"></div>
                  <p className="text-foreground">
                    Information is used exclusively to demonstrate application functionality as part of academic research.
                  </p>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full mt-2.5 flex-shrink-0"></div>
                  <p className="text-foreground">
                    We do not sell, share, or distribute information to third parties for any purpose.
                  </p>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full mt-2.5 flex-shrink-0"></div>
                  <p className="text-foreground">
                    Data is processed solely within the scope of this educational demonstration.
                  </p>
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* Data Retention */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-xl text-foreground">
                <div className="p-2 bg-muted rounded-md">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                </div>
                3. Data Retention and Security
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-foreground leading-relaxed">
                All collected data will be permanently deleted upon completion of the academic project.
              </p>
              <div className="bg-muted/30 p-4 rounded-lg border">
                <h4 className="font-medium text-foreground mb-2">Temporary Storage Policy</h4>
                <p className="text-sm text-muted-foreground">
                  This is a time-limited academic project. All data has a defined retention period and will be 
                  securely disposed of after project completion and evaluation.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Third Party Disclosure */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-xl text-foreground">
                <div className="p-2 bg-muted rounded-md">
                  <Users className="h-5 w-5 text-muted-foreground" />
                </div>
                4. Third Party Disclosure
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-foreground leading-relaxed">
                We do not share, sell, or disclose personal information to any third parties.
              </p>
              <div className="bg-muted/30 p-4 rounded-lg border">
                <h4 className="font-medium text-foreground mb-2">Zero Third-Party Sharing</h4>
                <p className="text-sm text-muted-foreground">
                  Your information remains within this demonstration environment and is not shared with external entities.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Contact Information */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-xl text-foreground">
                <div className="p-2 bg-muted rounded-md">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                </div>
                5. Contact & Questions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-foreground leading-relaxed">
                If you have any questions about this Privacy Policy or our data handling practices, 
                please contact the development team through the application&apos;s contact channels.
              </p>
            </CardContent>
          </Card>
        </div>

        <Separator className="my-12" />

        {/* Footer */}
        <div className="space-y-6">
          <div className="bg-muted/20 p-6 rounded-lg border">
            <h3 className="font-semibold text-foreground mb-3">Academic Project Disclaimer</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              VisHeart is developed as part of a final-year university project for educational and research purposes. 
              This application is not intended for commercial use. All data handling practices are implemented 
              with privacy and security considerations appropriate for an academic demonstration environment.
            </p>
          </div>

          <div className="flex justify-center gap-4 pt-4">
            <Button asChild variant="default">
              <Link href="/dashboard">Return to Dashboard</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/">Return to Home</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
