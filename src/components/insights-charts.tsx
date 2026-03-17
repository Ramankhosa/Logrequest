"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { Panel } from "@/components/panel";
import { entitlementDistribution, insightTrend, roleAdoption } from "@/lib/data";

const pieColors = ["#0f766e", "#f59e0b", "#e2e8f0", "#dc2626"];

export function InsightsCharts() {
  return (
    <div className="space-y-4">
      <Panel
        eyebrow="Adoption trend"
        title="Usage and access health by month"
        description="This is where intelligent summaries should explain meaningful shifts, not just surface raw chart noise."
      >
        <div className="h-72 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={insightTrend}>
              <defs>
                <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0f766e" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#0f766e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(23,32,51,0.08)" vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="activeUsers"
                stroke="#0f766e"
                strokeWidth={3}
                fill="url(#usageFill)"
              />
              <Area
                type="monotone"
                dataKey="blockedAttempts"
                stroke="#dc2626"
                strokeWidth={2}
                fillOpacity={0}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          eyebrow="Role adoption"
          title="Role mix by active membership"
          description="Tenant leadership needs role distribution without opening a separate export."
        >
          <div className="h-72 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={roleAdoption}>
                <CartesianGrid stroke="rgba(23,32,51,0.08)" vertical={false} />
                <XAxis dataKey="role" tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="count" radius={[12, 12, 0, 0]} fill="#172033" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel
          eyebrow="Entitlement distribution"
          title="Commercial state visibility"
          description="This supports the distinction between active, grace, hold, and revoked tenant access."
        >
          <div className="h-72 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={entitlementDistribution}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={56}
                  paddingAngle={3}
                >
                  {entitlementDistribution.map((entry, index) => (
                    <Cell
                      key={entry.label}
                      fill={pieColors[index % pieColors.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
    </div>
  );
}
