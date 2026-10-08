import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Claim, Condition } from "@/content/medicalGuide";
import { ClaimText } from "@/components/doc/medical/Citation";

export function ConditionCard({ condition }: { condition: Condition }) {
  const headingId = `condition-${condition.id}-heading`;
  return (
    <Card
      id={`condition-${condition.id}`}
      aria-labelledby={headingId}
      role="article"
      className="row-span-2 grid scroll-mt-44 grid-rows-subgrid gap-4 py-5 lg:scroll-mt-32"
    >
      <CardHeader className="gap-2 px-5">
        {condition.badge && (
          <Badge variant="secondary" className="w-fit font-medium">
            {condition.badge}
          </Badge>
        )}
        <h3 id={headingId} className="text-base leading-snug font-semibold">
          {condition.name}
        </h3>
        <p className="text-muted-foreground text-sm">
          <ClaimText claim={condition.summary} />
        </p>
      </CardHeader>
      <CardContent className="px-5">
        <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
          Key imaging features
        </p>
        <ul className="list-disc space-y-1.5 pl-4 text-sm">
          {condition.imagingFeatures.map((feature, index) => (
            <li key={index}>
              <ClaimText claim={feature} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function ConditionGrid({ conditions, note }: { conditions: Condition[]; note?: Claim }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-2">
        {conditions.map((condition) => (
          <ConditionCard key={condition.id} condition={condition} />
        ))}
      </div>
      {note && (
        <p className="text-muted-foreground text-xs">
          <ClaimText claim={note} />
        </p>
      )}
    </div>
  );
}
