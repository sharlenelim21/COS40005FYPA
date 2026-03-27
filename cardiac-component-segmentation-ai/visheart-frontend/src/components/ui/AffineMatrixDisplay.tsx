/**
 * Reusable component for displaying 4x4 affine transformation matrices
 * Used across dashboard and project detail views to show spatial coordinate information
 */

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Grid3X3 } from 'lucide-react';

interface AffineMatrixDisplayProps {
  affineMatrix?: number[][];
  className?: string;
  compact?: boolean; // For dashboard cards vs full project view
  title?: string;
}

export function AffineMatrixDisplay({ 
  affineMatrix, 
  className = "", 
  compact = false,
  title = "Affine Matrix"
}: AffineMatrixDisplayProps) {
  // 1. Handle missing or invalid matrix data
  if (!affineMatrix || !Array.isArray(affineMatrix) || affineMatrix.length === 0) {
    return (
      <div className={`space-y-2 ${className}`}>
        {!compact && (
          <div className="flex items-center gap-2">
            <Grid3X3 className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-semibold text-sm">{title}</h4>
          </div>
        )}
        <Badge variant="outline" className="text-xs">
          Not Available
        </Badge>
      </div>
    );
  }

  // 2. Validate matrix dimensions (should be 4x4)
  const isValid4x4 = affineMatrix.length === 4 && affineMatrix.every(row => Array.isArray(row) && row.length === 4);
  
  if (!isValid4x4) {
    return (
      <div className={`space-y-2 ${className}`}>
        {!compact && (
          <div className="flex items-center gap-2">
            <Grid3X3 className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-semibold text-sm">{title}</h4>
          </div>
        )}
        <Badge variant="destructive" className="text-xs">
          Invalid Matrix ({affineMatrix.length}x{affineMatrix[0]?.length || 0})
        </Badge>
      </div>
    );
  }

  // 3. Format matrix values for display
  const formatValue = (value: number): string => {
    if (Math.abs(value) < 0.0001 && value !== 0) {
      return value.toExponential(2);
    }
    return value.toFixed(3);
  };

  // 4. Render compact version for dashboard cards
  if (compact) {
    return (
      <div className={`space-y-2 ${className}`}>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">Affine Matrix:</span>
          <Badge variant="outline" className="text-xs">
            4×4 Available
          </Badge>
        </div>
        <div className="text-xs font-mono bg-muted/30 p-2 rounded border overflow-hidden">
          <div className="grid grid-cols-4 gap-1 text-center">
            {affineMatrix.flat().map((value, index) => (
              <div key={index} className="truncate" title={value.toString()}>
                {formatValue(value)}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 5. Render full version for project details page
  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center gap-2">
        <Grid3X3 className="h-4 w-4" />
        <h4 className="font-semibold">{title}</h4>
        <Badge variant="outline" className="text-xs">
          4×4 Transformation
        </Badge>
      </div>
      
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Spatial coordinate transformation matrix (RAS → Voxel coordinates)
        </p>
        
        <div className="font-mono text-sm bg-muted/30 p-3 rounded border">
          <div className="grid grid-cols-4 gap-2">
            {affineMatrix.map((row, rowIndex) => 
              row.map((value, colIndex) => (
                <div 
                  key={`${rowIndex}-${colIndex}`}
                  className="text-center p-2 bg-background rounded border text-xs"
                  title={`Row ${rowIndex + 1}, Col ${colIndex + 1}: ${value}`}
                >
                  {formatValue(value)}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p><strong>Coordinate System:</strong> RAS (Right-Anterior-Superior)</p>
          <p><strong>Translation:</strong> [{formatValue(affineMatrix[0][3])}, {formatValue(affineMatrix[1][3])}, {formatValue(affineMatrix[2][3])}]</p>
        </div>
      </div>
    </div>
  );
}
