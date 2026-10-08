import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, Polygon, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useNavigate } from 'react-router-dom';
import type { DistrictSummary } from '@sevalens/shared';
import { MANIPUR_OUTLINE } from '../lib/manipurOutline';
import { SEV_COLOR, SEV_LABEL } from '../lib/theme';
import { fmtInt, fmtPct } from '../lib/format';

function TileStatus({ onError }: { onError: () => void }) {
  const map = useMap();
  useEffect(() => {
    let errors = 0;
    // several failed tiles => assume offline and fall back to the plain outline
    const handler = () => { if (++errors >= 4) onError(); };
    map.on('tileerror', handler);
    return () => { map.off('tileerror', handler); };
  }, [map, onError]);
  return null;
}

export function ManipurMap({ districts, height = 420 }: { districts: DistrictSummary[]; height?: number }) {
  const navigate = useNavigate();
  const [tilesOk, setTilesOk] = useState(true);
  const [offline] = useState(() => () => setTilesOk(false));
  const maxGap = Math.max(1, ...districts.map((d) => d.coverage.gap));
  const radius = (gap: number) => 5 + 17 * Math.sqrt(gap / maxGap);
  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200" style={{ height }}>
      <MapContainer center={[24.72, 93.88]} zoom={8} minZoom={7} maxZoom={11} scrollWheelZoom={false} className="h-full w-full bg-slate-100" attributionControl={tilesOk}>
        {tilesOk && (
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            className="sevalens-tiles"
            attribution='&copy; OpenStreetMap contributors'
          />
        )}
        {tilesOk && <TileStatus onError={offline} />}
        {!tilesOk && <Polygon positions={MANIPUR_OUTLINE} pathOptions={{ color: '#0B1F3A', weight: 1.5, opacity: 0.5, fillColor: '#ffffff', fillOpacity: 0.9, dashArray: '4 3' }} interactive={false} />}
        {[...districts].sort((a, b) => b.coverage.gap - a.coverage.gap).map((d) => (
          <CircleMarker
            key={d.id}
            center={[d.lat, d.lng]}
            radius={radius(d.coverage.gap)}
            pathOptions={{ color: '#ffffff', weight: 2, fillColor: SEV_COLOR[d.attention.level], fillOpacity: 0.78 }}
            eventHandlers={{ click: () => navigate(`/districts/${d.id}`) }}
          >
            <Tooltip direction="top" offset={[0, -6]} opacity={1}>
              <div className="text-xs">
                <div className="font-semibold text-navy-900">{d.name}</div>
                <div>Attention: <b>{d.attention.score}</b> ({SEV_LABEL[d.attention.level]})</div>
                <div>Coverage: <b>{fmtPct(d.coverage.coverage)}</b> · Gap: <b>{fmtInt(d.coverage.gap)}</b></div>
                <div className="text-slate-500">{d.attention.topReason}</div>
                <div className="mt-0.5 text-teal-700">Click to drill down →</div>
              </div>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
      <div className="pointer-events-none absolute bottom-2 left-2 z-[500] rounded-lg bg-white/95 px-2.5 py-1.5 text-[11px] text-slate-600 shadow ring-1 ring-slate-200">
        <div className="mb-0.5 font-semibold text-navy-900">Attention level</div>
        <div className="flex gap-2">
          {(['high', 'medium', 'low'] as const).map((l) => (
            <span key={l} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: SEV_COLOR[l] }} />{SEV_LABEL[l]}</span>
          ))}
        </div>
        <div className="mt-0.5">Circle size = coverage gap (est. eligible not enrolled)</div>
        {!tilesOk && <div className="mt-0.5 text-slate-500">Offline mode · approximate state outline</div>}
      </div>
    </div>
  );
}
