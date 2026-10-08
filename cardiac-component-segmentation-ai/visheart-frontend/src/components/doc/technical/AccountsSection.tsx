import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function AccountsSection() {
  return (
    <div className="space-y-6 max-w-none">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold mb-4">
          Account Types
        </h2>
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
  );
}
