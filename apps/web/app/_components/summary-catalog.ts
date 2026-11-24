import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { z } from 'zod';

const components = {
  Grid: { props: z.object({ layout: z.enum(['stack', 'charts']) }) },
  Metrics: { props: z.object({ items: z.array(z.object({
    label: z.string(), value: z.union([z.number(), z.string()]), detail: z.string(),
    icon: z.enum(['route', 'check', 'review', 'target', 'gps', 'tasks', 'company', 'users', 'sites']),
    attention: z.boolean().optional(),
  })) }) },
  PatrolStates: { props: z.object({
    completed: z.number(), active: z.number(), waiting: z.number(), incomplete: z.number(), expired: z.number(), upcoming: z.number(),
  }) },
  DailyTrend: { props: z.object({
    metric: z.string(), points: z.array(z.object({
      bucket: z.string(), patrols: z.number(), completed: z.number(), sites: z.number(), compliancePct: z.number().nullable(),
    })),
  }) },
  Ranking: { props: z.object({
    title: z.string(), caption: z.string(), scale: z.number(), empty: z.string(),
    items: z.array(z.object({
      key: z.string(), label: z.string(), value: z.number(), display: z.string(), attention: z.boolean().optional(),
    })),
  }) },
};

export const summaryCatalog = defineCatalog(schema, { components, actions: {} });

type BlockName = Exclude<keyof typeof components, 'Grid'>;
export type SummaryBlock = {
  [K in BlockName]: { type: K; props: z.infer<typeof components[K]['props']> }
}[BlockName];
