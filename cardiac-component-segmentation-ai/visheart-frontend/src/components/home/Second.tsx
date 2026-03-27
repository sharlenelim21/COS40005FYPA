"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Brain, Heart, Zap, ExternalLink, Box, FileDown, Download, Upload, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { motion } from 'framer-motion';
import Image from 'next/image';

interface SecondSectionProps {
  className?: string;
}

export default function SecondSection({ className = '' }: SecondSectionProps) {
  return (
    <section className={cn("py-24 bg-muted/30", className)}>
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto">
          {/* Section Header */}
          <motion.div 
            className="text-center mb-16"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <motion.div 
              className="flex items-center justify-center mb-6"
              initial={{ scale: 0 }}
              whileInView={{ scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              viewport={{ once: true }}
            >
              <motion.div
                whileHover={{ y: -5, transition: { duration: 0.3 } }}
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="mr-4"
              >
                <Heart className="w-12 h-12 text-primary" />
              </motion.div>
              <motion.div
                whileHover={{ y: -5, transition: { duration: 0.3 } }}
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 1.5 }}
              >
                <Brain className="w-12 h-12 text-primary" />
              </motion.div>
            </motion.div>
            <motion.h2 
              className="text-4xl md:text-5xl font-bold text-foreground mb-6"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              viewport={{ once: true }}
            >
              AI-Powered Cardiac Analysis Pipeline
            </motion.h2>
            <motion.p 
              className="text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              viewport={{ once: true }}
            >
              Our platform integrates YOLOv11 object detection, MedSAM medical segmentation, and a cutting-edge 
              4D reconstruction model to deliver a complete cardiac imaging analysis workflow.
            </motion.p>
          </motion.div>

          {/* AI Models Cards */}
          <motion.div 
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mb-16"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            viewport={{ once: true }}
          >
            {/* YOLOv11 Card */}
            <motion.div
              whileHover={{ scale: 1.02, y: -5 }}
              transition={{ duration: 0.3 }}
            >
              <Card className="group hover:shadow-lg transition-all duration-300 h-full">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <motion.div 
                        className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mr-4"
                        whileHover={{ rotate: 180 }}
                        transition={{ duration: 0.4 }}
                      >
                        <Zap className="w-6 h-6 text-primary" />
                      </motion.div>
                      <div>
                        <CardTitle className="text-2xl">YOLOv11</CardTitle>
                        <CardDescription>Real-time Object Detection</CardDescription>
                      </div>
                    </div>
                    <motion.div
                      whileHover={{ scale: 1.2, rotate: 15 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ExternalLink className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </motion.div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col h-full">
                  <p className="text-muted-foreground mb-6">
                    The latest iteration of the YOLO architecture provides lightning-fast cardiac structure detection 
                    with enhanced accuracy. Perfect for real-time analysis and initial region identification.
                  </p>
                  <div className="space-y-3 mb-6">
                    <motion.div 
                      className="flex items-center text-sm"
                      initial={{ opacity: 0, x: -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5, delay: 0.1 }}
                      viewport={{ once: true }}
                    >
                      <div className="w-2 h-2 bg-primary rounded-full mr-3"></div>
                      <span>Ultra-fast inference speed</span>
                    </motion.div>
                    <motion.div 
                      className="flex items-center text-sm"
                      initial={{ opacity: 0, x: -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5, delay: 0.2 }}
                      viewport={{ once: true }}
                    >
                      <div className="w-2 h-2 bg-primary rounded-full mr-3"></div>
                      <span>Improved accuracy over YOLOv10</span>
                    </motion.div>
                    <motion.div 
                      className="flex items-center text-sm"
                      initial={{ opacity: 0, x: -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5, delay: 0.3 }}
                      viewport={{ once: true }}
                    >
                      <div className="w-2 h-2 bg-primary rounded-full mr-3"></div>
                      <span>Optimized for medical imaging</span>
                    </motion.div>
                  </div>
                  <motion.div
                    className="mt-auto"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Button variant="outline" className="w-full" asChild>
                      <Link href="https://docs.ultralytics.com/models/yolo11/" target="_blank" rel="noopener noreferrer">
                        Learn More About YOLOv11
                        <ExternalLink className="w-4 h-4 ml-2" />
                      </Link>
                    </Button>
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>

            {/* MedSAM Card */}
            <motion.div
              whileHover={{ scale: 1.02, y: -5 }}
              transition={{ duration: 0.3 }}
            >
              <Card className="group hover:shadow-lg transition-all duration-300 h-full">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <motion.div 
                        className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mr-4"
                        whileHover={{ rotate: 180 }}
                        transition={{ duration: 0.4 }}
                      >
                        <Brain className="w-6 h-6 text-primary" />
                      </motion.div>
                      <div>
                        <CardTitle className="text-2xl">MedSAM</CardTitle>
                        <CardDescription>Medical Segment Anything</CardDescription>
                      </div>
                    </div>
                    <motion.div
                      whileHover={{ scale: 1.2, rotate: 15 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ExternalLink className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </motion.div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col h-full">
                  <p className="text-muted-foreground mb-6">
                    A specialized adaptation of Meta&apos;s Segment Anything Model for medical imaging. 
                    Provides precise pixel-level segmentation for detailed cardiac structure analysis.
                  </p>
                  <div className="space-y-3 mb-6">
                    <motion.div 
                      className="flex items-center text-sm"
                      initial={{ opacity: 0, x: -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5, delay: 0.1 }}
                      viewport={{ once: true }}
                    >
                      <div className="w-2 h-2 bg-primary rounded-full mr-3"></div>
                      <span>Medical imaging specialized</span>
                    </motion.div>
                    <motion.div 
                      className="flex items-center text-sm"
                      initial={{ opacity: 0, x: -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5, delay: 0.2 }}
                      viewport={{ once: true }}
                    >
                      <div className="w-2 h-2 bg-primary rounded-full mr-3"></div>
                      <span>Pixel-perfect segmentation</span>
                    </motion.div>
                    <motion.div 
                      className="flex items-center text-sm"
                      initial={{ opacity: 0, x: -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5, delay: 0.3 }}
                      viewport={{ once: true }}
                    >
                      <div className="w-2 h-2 bg-primary rounded-full mr-3"></div>
                      <span>Runs automatically after segmentation</span>
                    </motion.div>
                  </div>
                  <motion.div
                    className="mt-auto"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Button variant="outline" className="w-full" asChild>
                      <Link href="https://www.nature.com/articles/s41467-024-44824-z" target="_blank" rel="noopener noreferrer">
                        Read Research Paper
                        <ExternalLink className="w-4 h-4 ml-2" />
                      </Link>
                    </Button>
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>

            {/* 4D Reconstruction Card */}
            <motion.div
              whileHover={{ scale: 1.02, y: -5 }}
              transition={{ duration: 0.3 }}
            >
              <Card className="group hover:shadow-lg transition-all duration-300 h-full">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <motion.div 
                        className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mr-4"
                        whileHover={{ rotate: 180 }}
                        transition={{ duration: 0.4 }}
                      >
                        <Box className="w-6 h-6 text-primary" />
                      </motion.div>
                      <div>
                        <CardTitle className="text-2xl">4D Reconstruction</CardTitle>
                        <CardDescription>Temporal Cardiac Modeling</CardDescription>
                      </div>
                    </div>
                    <motion.div
                      whileHover={{ scale: 1.2, rotate: 15 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ExternalLink className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </motion.div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col h-full">
                  <p className="text-muted-foreground mb-6">
                    Advanced 4D myocardium reconstruction using decoupled motion and shape models. 
                    Generates dynamic cardiac meshes from segmentation masks across the entire cardiac cycle.
                  </p>
                  <div className="space-y-3 mb-6">
                    <motion.div 
                      className="flex items-center text-sm"
                      initial={{ opacity: 0, x: -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5, delay: 0.1 }}
                      viewport={{ once: true }}
                    >
                      <div className="w-2 h-2 bg-primary rounded-full mr-3"></div>
                      <span>Temporal motion tracking</span>
                    </motion.div>
                    <motion.div 
                      className="flex items-center text-sm"
                      initial={{ opacity: 0, x: -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5, delay: 0.2 }}
                      viewport={{ once: true }}
                    >
                      <div className="w-2 h-2 bg-primary rounded-full mr-3"></div>
                      <span>SDF-based mesh generation</span>
                    </motion.div>
                    <motion.div 
                      className="flex items-center text-sm"
                      initial={{ opacity: 0, x: -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5, delay: 0.3 }}
                      viewport={{ once: true }}
                    >
                      <div className="w-2 h-2 bg-primary rounded-full mr-3"></div>
                      <span>Multi-format export (OBJ, GLB)</span>
                    </motion.div>
                  </div>
                  <motion.div
                    className="mt-auto"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Button variant="outline" className="w-full" asChild>
                      <Link href="https://arxiv.org/abs/2308.14083" target="_blank" rel="noopener noreferrer">
                        Read Research Paper
                        <ExternalLink className="w-4 h-4 ml-2" />
                      </Link>
                    </Button>
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>

          {/* Complete Workflow */}
          <motion.div 
            className="bg-card rounded-xl p-8 border"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            viewport={{ once: true }}
          >
            <motion.h3 
              className="text-2xl font-semibold text-foreground mb-6 text-center"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              viewport={{ once: true }}
            >
              Complete Clinical Workflow
            </motion.h3>
            <p className="text-center text-muted-foreground mb-6 max-w-2xl mx-auto">
              From raw cardiac MRI scans to exportable 3D meshes—our streamlined pipeline guides you through every step
            </p>
            
            {/* Try it Now Section */}
            <motion.div 
              className="bg-primary/5 border border-primary/20 rounded-lg p-6 mb-12 max-w-3xl mx-auto"
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              viewport={{ once: true }}
            >
              <div className="flex flex-col md:flex-row items-center gap-4">
                <div className="flex-1 text-center md:text-left">
                  <h4 className="text-lg font-semibold text-foreground mb-2">
                    Try it Now with Our Sample Files!
                  </h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Want to see the platform in action? Download our sample cardiac MRI dataset and test the complete workflow using a guest account — <b>no signup required!</b>
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                    <Link 
                      href="/sample-nifti" 
                      className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                    >
                      <Download className="w-4 h-4" />
                      Download Sample Files
                    </Link>
                    <span className="text-muted-foreground">•</span>
                    <Link 
                      href="/login" 
                      className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                    >
                      Use Guest Account
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              </div>
            </motion.div>
            
            <div className="space-y-8">
              {/* Step 1: Upload Project */}
              <motion.div 
                className="flex flex-col gap-4"
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.5 }}
                viewport={{ once: true }}
              >
                <div className="flex items-center gap-4">
                  <motion.div 
                    className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0"
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    transition={{ duration: 0.3 }}
                  >
                    <span className="text-2xl font-bold text-primary">1</span>
                  </motion.div>
                  <h4 className="text-xl font-semibold text-foreground">Upload Cardiac MRI Data</h4>
                </div>
                <motion.div 
                  className="w-full bg-muted/50 border-2 border-primary/20 rounded-lg p-6"
                  whileHover={{ borderColor: "hsl(var(--primary) / 0.4)" }}
                  transition={{ duration: 0.3 }}
                >
                    <div className="flex flex-col md:flex-row gap-6 items-center">
                      <div className="flex-1">
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                            <Upload className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground mb-1">NIfTI Format Support</p>
                            <p className="text-sm text-muted-foreground">
                              Upload your cardiac MRI scans in compressed NIfTI format (.nii.gz). 
                              Our platform supports 3D and 4D temporal sequences.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-4">
                          <div className="w-2 h-2 bg-primary/50 rounded-full"></div>
                          <span>Multiple frames supported</span>
                          <div className="w-2 h-2 bg-primary/50 rounded-full ml-2"></div>
                          <span>Automatic metadata extraction</span>
                        </div>
                      </div>
                      <div className="w-full md:w-48 h-48 bg-muted rounded-lg border-2 border-primary/30 flex items-center justify-center relative overflow-hidden">
                        {/* MRI scan image */}
                        <Image 
                          src="/images/home/Second/sample_niftiMRI_image.png" 
                          alt="Cardiac MRI Scan"
                          fill
                          className="object-cover"
                        />
                      </div>
                    </div>
                </motion.div>
              </motion.div>

              {/* Arrow Down */}
              <div className="flex justify-center">
                <ArrowRight className="w-6 h-6 text-primary rotate-90" />
              </div>

              {/* Step 2: AI Segmentation */}
              <motion.div 
                className="flex flex-col gap-4"
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.6 }}
                viewport={{ once: true }}
              >
                <div className="flex items-center gap-4">
                  <motion.div 
                    className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0"
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    transition={{ duration: 0.3 }}
                  >
                    <span className="text-2xl font-bold text-primary">2</span>
                  </motion.div>
                  <h4 className="text-xl font-semibold text-foreground">Start AI Segmentation</h4>
                </div>
                <motion.div 
                  className="w-full bg-muted/50 border-2 border-primary/20 rounded-lg p-6"
                  whileHover={{ borderColor: "hsl(var(--primary) / 0.4)" }}
                  transition={{ duration: 0.3 }}
                >
                    <div className="flex flex-col md:flex-row gap-6 items-center">
                      <div className="flex-1 space-y-4">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                            <Zap className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground mb-1">YOLOv11 Detection</p>
                            <p className="text-sm text-muted-foreground">
                              Rapidly identifies cardiac structures and regions of interest
                            </p>
                          </div>
                        </div>
                        <div className="h-px bg-primary/20"></div>
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                            <Brain className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground mb-1">MedSAM Segmentation</p>
                            <p className="text-sm text-muted-foreground">
                              Generates precise pixel-level segmentation masks
                            </p>
                          </div>
                        </div>
                        <div className="bg-primary/5 rounded-lg p-3 mt-4">
                          <p className="text-xs text-muted-foreground italic text-center">
                            ⚡ Both models run simultaneously in one GPU-accelerated process
                          </p>
                        </div>
                      </div>
                      <div className="w-full md:w-48 h-48 bg-muted rounded-lg border-2 border-primary/30 flex items-center justify-center relative overflow-hidden">
                        {/* Segmentation result */}
                        <Image 
                          src="/images/home/Second/sample_segmented_image.gif" 
                          alt="Segmentation Result"
                          fill
                        className="object-cover"
                        unoptimized
                        />
                      </div>
                    </div>
                </motion.div>
              </motion.div>

              {/* Step 2.1: Export Masks */}
              <motion.div 
                className="flex flex-col gap-4"
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.65 }}
                viewport={{ once: true }}
              >
                <div className="flex items-center gap-4">
                  <motion.div 
                    className="w-12 h-12 bg-muted/50 rounded-full flex items-center justify-center border-2 border-primary/30 flex-shrink-0"
                    whileHover={{ scale: 1.1 }}
                    transition={{ duration: 0.3 }}
                  >
                    <FileDown className="w-5 h-5 text-primary" />
                  </motion.div>
                  <h5 className="text-lg font-semibold text-foreground">Export Segmentation Masks</h5>
                </div>
                <div className="w-full bg-muted/30 border border-primary/20 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground mb-3">
                    Once segmentation is complete, download your masks in NIfTI format (.nii.gz) for further analysis or archival
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span>Ready after segmentation completes</span>
                  </div>
                </div>
              </motion.div>

              {/* Arrow Down */}
              <div className="flex justify-center">
                <ArrowRight className="w-6 h-6 text-primary rotate-90" />
              </div>

              {/* Step 3: 4D Reconstruction */}
              <motion.div 
                className="flex flex-col gap-4"
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.7 }}
                viewport={{ once: true }}
              >
                <div className="flex items-center gap-4">
                  <motion.div 
                    className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0"
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    transition={{ duration: 0.3 }}
                  >
                    <span className="text-2xl font-bold text-primary">3</span>
                  </motion.div>
                  <h4 className="text-xl font-semibold text-foreground">Generate 4D Reconstruction</h4>
                </div>
                <div className="w-full">
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4">
                    <p className="text-sm text-amber-700 dark:text-amber-400 text-center">
                      <strong>Prerequisites:</strong> Segmentation <b>must</b> be completed before starting reconstruction
                    </p>
                  </div>
                  <motion.div 
                    className="bg-muted/50 border-2 border-primary/20 rounded-lg p-6"
                    whileHover={{ borderColor: "hsl(var(--primary) / 0.4)" }}
                    transition={{ duration: 0.3 }}
                  >
                    <div className="flex flex-col md:flex-row gap-6 items-center">
                      <div className="flex-1 space-y-4">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                            <Box className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground mb-1">SDF Mesh Generation</p>
                            <p className="text-sm text-muted-foreground">
                              Creates dynamic 3D cardiac meshes using deep learning
                            </p>
                          </div>
                        </div>
                        <div className="h-px bg-primary/20"></div>
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                            <Heart className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground mb-1">Temporal Motion Tracking</p>
                            <p className="text-sm text-muted-foreground">
                              Decoupled shape and motion model across cardiac cycle
                            </p>
                          </div>
                        </div>
                        <div className="bg-primary/5 rounded-lg p-3 mt-4">
                          <p className="text-xs text-muted-foreground italic text-center">
                            ⚡ GPU-accelerated reconstruction pipeline with cutting-edge Shape-Motion and SDF models in unified pipeline
                          </p>
                        </div>
                      </div>
                      <div className="w-full md:w-48 h-48 bg-muted rounded-lg border-2 border-primary/30 flex items-center justify-center relative overflow-hidden">
                        {/* 3D mesh */}
                        <Image 
                          src="/images/home/Second/sample_mesh_image.gif" 
                          alt="3D Cardiac Mesh"
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    </div>
                </motion.div>
                </div>
              </motion.div>

              {/* Step 3.1: Export Meshes */}
              <motion.div 
                className="flex flex-col gap-4"
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.75 }}
                viewport={{ once: true }}
              >
                <div className="flex items-center gap-4">
                  <motion.div 
                    className="w-12 h-12 bg-muted/50 rounded-full flex items-center justify-center border-2 border-primary/30 flex-shrink-0"
                    whileHover={{ scale: 1.1 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Download className="w-5 h-5 text-primary" />
                  </motion.div>
                  <h5 className="text-lg font-semibold text-foreground">Export 3D Meshes</h5>
                </div>
                <div className="w-full bg-muted/30 border border-primary/20 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground mb-3">
                    Download reconstructed cardiac meshes in industry-standard formats for visualization and analysis
                  </p>
                  <div className="flex flex-wrap gap-3 mb-3">
                    <div className="bg-primary/10 rounded-md px-3 py-1">
                      <span className="text-xs font-medium text-primary">OBJ Format</span>
                    </div>
                    <div className="bg-primary/10 rounded-md px-3 py-1">
                      <span className="text-xs font-medium text-primary">GLB Format</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span>Ready after reconstruction completes</span>
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
