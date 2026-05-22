"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, File, RefreshCw, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { sampleNiftiApi } from "@/lib/api";

interface NiftiFileInfo {
  filename: string;
  size: number;
  sizeFormatted: string;
  modifiedDate: string;
  downloadUrl: string;
}

interface SampleNiftiResponse {
  success: boolean;
  message: string;
  data: {
    totalFiles: number;
    files: NiftiFileInfo[];
  };
}

const SamplePage: React.FC = () => {
  const [files, setFiles] = useState<NiftiFileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  const fetchSampleFiles = async () => {
    try {
      setLoading(true);
      setError(null);

      const data: SampleNiftiResponse = await sampleNiftiApi.getFileInfo();

      if (data.success) {
        setFiles(data.data.files);
      } else {
        setError(data.message || "Failed to fetch sample files");
      }
    } catch (err: any) {
      console.error("Error fetching sample files:", err);
      const errorMessage = err?.response?.data?.message || err?.message || "An unknown error occurred";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (filename: string) => {
    try {
      setDownloadingFile(filename);

      // Use the API function to download the file
      const blob = await sampleNiftiApi.downloadFile(filename);

      // Create a download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up the URL
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Error downloading file:", err);
      const errorMessage = err?.response?.data?.message || err?.message || "Failed to download file";
      setError(errorMessage);
    } finally {
      setDownloadingFile(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  useEffect(() => {
    fetchSampleFiles();
  }, []);

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl sm:h-dvh h-full">
      <div className="sm:mb-20 mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Sample NIfTI Files</h1>
        <p className="text-muted-foreground mb-4">Download sample cardiac imaging files for testing and demonstration purposes.</p>
      </div>

      {error && (
        <Alert className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && !error ? (
        <div className="flex justify-center items-center py-12">
          <div className="text-center">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-gray-400" />
            <p className="text-foreground">Loading sample files...</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-6">
          {files.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <File className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-500 text-lg mb-2">No sample files found</p>
                <p className="text-gray-400">There are currently no NIfTI files available for download.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {files.map((file) => (
                  <Card key={file.filename} className="hover:shadow-md transition-shadow">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <File className="h-5 w-5 text-blue-500" />
                        {file.filename}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="text-sm text-muted-foreground">
                        <div className="flex justify-between">
                          <span className="font-bold">Size:</span>
                          <span className="font-mono">{file.sizeFormatted}</span>
                        </div>
                      </div>

                      <Button onClick={() => handleDownload(file.filename)} disabled={downloadingFile === file.filename} className="w-full" size="sm">
                        {downloadingFile === file.filename ? (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                            Downloading...
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4 mr-2" />
                            Download
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}

          <Card className="border-none bg-muted/30 shadow-none">
            <CardContent className="space-y-4 p-6">
              <h2 className="text-xl font-semibold">How to use these files</h2>
              <div className="grid gap-4 md:grid-cols-4">
                {[
                  "Download a sample file above",
                  "Go to Dashboard and create a New Project",
                  "Upload the .nii.gz file",
                  "Run segmentation to view results",
                ].map((step, index) => (
                  <div key={step} className="flex items-start gap-3">
                    <div className="bg-pink-500 text-white flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                      {index + 1}
                    </div>
                    <p className="text-sm text-muted-foreground leading-6">{step}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default SamplePage;
