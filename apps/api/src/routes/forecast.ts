import { Router } from 'express';
import { z } from 'zod';
import { FORECAST, forecastPendency, pendencySeries } from '../analytics/forecast';
import { getSnapshot } from '../services/snapshot';
import { assertInScope, effectiveDistrict } from '../middleware/auth';
import { h, HttpError, parse } from '../lib/http';

export const forecastRouter = Router();

const querySchema = z.object({
  districtId: z.coerce.number().int().positive().optional(),
  blockId: z.coerce.number().int().positive().optional(),
});

/** 60-day pendency forecast for the state (admins), a district or a block. Same district scoping as the rest of the API. */
forecastRouter.get('/forecast', h((req, res) => {
  const query = parse(querySchema, req.query);
  const s = getSnapshot();

  let districtId: number | undefined;
  let blockId: number | undefined;
  let areaName = 'Manipur';
  if (query.blockId !== undefined) {
    const block = s.blocks.find((b) => b.id === query.blockId);
    if (!block) throw new HttpError(404, 'Block not found.');
    assertInScope(req, block.districtId);
    if (query.districtId !== undefined && query.districtId !== block.districtId) throw new HttpError(400, 'This block is not in the selected district.');
    districtId = block.districtId;
    blockId = block.id;
    areaName = block.name;
  } else {
    districtId = effectiveDistrict(req, query.districtId);
    if (districtId !== undefined) {
      const district = s.districts.find((d) => d.id === districtId);
      if (!district) throw new HttpError(404, 'District not found.');
      areaName = district.name;
    }
  }

  const apps = s.apps.filter((a) => (districtId === undefined || a.districtId === districtId) && (blockId === undefined || a.blockId === blockId));
  const { open, breached } = pendencySeries(apps, s.asOf, s.months.length, FORECAST.stepDays);
  res.json({
    dataAsOf: s.asOf, computedAt: s.computedAt, synthetic: true,
    districtId: districtId ?? null, blockId: blockId ?? null,
    ...forecastPendency({ areaName, asOf: s.asOf, open, breached }),
  });
}));
