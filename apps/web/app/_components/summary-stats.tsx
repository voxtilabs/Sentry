'use client';

import dynamic from 'next/dynamic';
import type { SummaryBlock } from './summary-catalog';

// Keep the statistics runtime out of the guard's patrol and scan flows.
const RenderSummary = dynamic(() => import('./summary-renderer'));

export function SummaryStats({ blocks, layout = 'stack' }: {
  blocks: SummaryBlock[]; layout?: 'stack' | 'charts';
}) {
  const keys = blocks.map(block => block.type);
  return <RenderSummary spec={{ root: 'summary', elements: {
    summary: { type: 'Grid', props: { layout }, children: keys },
    ...Object.fromEntries(blocks.map(block => [block.type, block])),
  } }} />;
}
