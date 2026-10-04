/**
 * Grid of selectable panel cutouts.  Self-contained — pulls from
 * samplePanels.js, doesn't reach into the main configurator's data layer.
 * Reuses the existing `Card` shadcn primitive for visual consistency with
 * the rest of the app, but nothing else is shared with /pages/Configurator.jsx.
 */
import { Card } from "@/components/ui/card";
import { SAMPLE_PANELS } from "./samplePanels";

export default function PanelPicker({ selectedId, onSelect }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-[hsl(215,25%,27%)]">
        1. Pick a panel
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {SAMPLE_PANELS.map((panel) => {
          const isSelected = selectedId === panel.id;
          return (
            <Card
              key={panel.id}
              onClick={() => onSelect(panel)}
              className={`cursor-pointer overflow-hidden transition-all ${
                isSelected
                  ? "ring-2 ring-[hsl(var(--accent))] ring-offset-2"
                  : "hover:ring-1 hover:ring-[hsl(215,16%,47%)]"
              }`}
              data-testid={`panel-pick-${panel.id}`}
            >
              <div
                className="aspect-[2/3] bg-cover bg-center"
                style={{ backgroundImage: `url(${panel.thumbnailUrl})` }}
              />
              <div className="px-2 py-2 text-[11px] font-medium text-[hsl(215,25%,27%)] truncate">
                {panel.name}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
