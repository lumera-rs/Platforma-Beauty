import { useEffect, useRef, useState, useMemo } from "react";

interface Marker {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  active?: boolean;
}

interface SimpleMapProps {
  markers: Marker[];
  onMarkerClick?: (id: string) => void;
  className?: string;
}

function lon2tile(lon: number, zoom: number) {
  return ((lon + 180) / 360) * Math.pow(2, zoom);
}

function lat2tile(lat: number, zoom: number) {
  return (
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)
      ) /
        Math.PI) /
      2) *
    Math.pow(2, zoom)
  );
}

export function SimpleMap({ markers, onMarkerClick, className = "" }: SimpleMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(13);
  const [center, setCenter] = useState({ lat: 44.8125, lon: 20.4612 }); // Default Belgrade
  const [isDragging, setIsDragging] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const markerGeometryKey = useMemo(
    () => markers.map((marker) => `${marker.id}:${marker.latitude}:${marker.longitude}`).join("|"),
    [markers],
  );

  useEffect(() => {
    if (markers.length > 0) {
      const validMarkers = markers.filter(
        (m) => m.latitude != null && m.longitude != null
      );
      if (validMarkers.length > 0) {
        const lats = validMarkers.map((m) => m.latitude);
        const lons = validMarkers.map((m) => m.longitude);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLon = Math.min(...lons);
        const maxLon = Math.max(...lons);

        setCenter({
          lat: (minLat + maxLat) / 2,
          lon: (minLon + maxLon) / 2,
        });
        
        // Simple heuristic for zoom based on bounding box
        const maxDiff = Math.max(maxLat - minLat, maxLon - minLon);
        if (maxDiff > 0) {
            let newZoom = Math.floor(8 - Math.log2(maxDiff));
            newZoom = Math.max(5, Math.min(newZoom, 15));
            setZoom(newZoom);
        } else {
            setZoom(14);
        }
      }
    }
  }, [markerGeometryKey]);

  const centerTileX = lon2tile(center.lon, zoom);
  const centerTileY = lat2tile(center.lat, zoom);

  const TILE_SIZE = 256;

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    setLastPos({ x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - lastPos.x;
    const dy = e.clientY - lastPos.y;
    
    // Convert dx, dy in pixels back to lat/lon degrees (approx)
    const tilesPerX = dx / TILE_SIZE;
    const tilesPerY = dy / TILE_SIZE;
    
    // New center tile
    const newCenterX = centerTileX - tilesPerX;
    const newCenterY = centerTileY - tilesPerY;
    
    // Convert tile back to lat/lon
    const newLon = (newCenterX / Math.pow(2, zoom)) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * newCenterY) / Math.pow(2, zoom);
    const newLat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    
    setCenter({ lat: newLat, lon: newLon });
    setLastPos({ x: e.clientX, y: e.clientY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.deltaY > 0) {
      setZoom((z) => Math.max(1, z - 1));
    } else {
      setZoom((z) => Math.min(19, z + 1));
    }
  };

  // Generate tiles
  const tiles = useMemo(() => {
    if (!containerRef.current) return [];
    
    // we need to know the container size to know how many tiles to load
    // for simplicity, we assume 1000x1000 max size
    const width = 1000; 
    const height = 1000;
    
    const tileCols = Math.ceil(width / TILE_SIZE) + 1;
    const tileRows = Math.ceil(height / TILE_SIZE) + 1;
    
    const startX = Math.floor(centerTileX - tileCols / 2);
    const startY = Math.floor(centerTileY - tileRows / 2);
    
    const tilesArr = [];
    for (let x = startX; x <= startX + tileCols; x++) {
      for (let y = startY; y <= startY + tileRows; y++) {
        // Tile wraps around horizontally
        const wrapX = ((x % Math.pow(2, zoom)) + Math.pow(2, zoom)) % Math.pow(2, zoom);
        if (y >= 0 && y < Math.pow(2, zoom)) {
            tilesArr.push({
                x, y, wrapX, z: zoom,
                // offset in pixels from the center of the container
                offsetX: (x - centerTileX) * TILE_SIZE,
                offsetY: (y - centerTileY) * TILE_SIZE
            });
        }
      }
    }
    return tilesArr;
  }, [centerTileX, centerTileY, zoom]);

  return (
    <div 
      className={`relative overflow-hidden bg-muted select-none touch-none ${className}`}
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      {/* Container centered in the middle of the div */}
      <div className="absolute top-1/2 left-1/2 w-0 h-0">
        {tiles.map((t) => (
          <img 
            key={`${t.z}-${t.x}-${t.y}`}
            src={`https://a.tile.openstreetmap.org/${t.z}/${t.wrapX}/${t.y}.png`}
            className="absolute max-w-none pointer-events-none opacity-50 dark:opacity-30 dark:invert dark:hue-rotate-180"
            style={{
              width: TILE_SIZE,
              height: TILE_SIZE,
              transform: `translate(calc(${t.offsetX}px - 50%), calc(${t.offsetY}px - 50%))`
            }}
            alt=""
            loading="lazy"
          />
        ))}

        {markers.map((m, markerIndex) => {
          if (m.latitude == null || m.longitude == null) return null;
          const markerX = (lon2tile(m.longitude, zoom) - centerTileX) * TILE_SIZE;
          const markerY = (lat2tile(m.latitude, zoom) - centerTileY) * TILE_SIZE;
          const overlappingMarkers = markers.slice(0, markerIndex).filter((other) => {
            const otherX = (lon2tile(other.longitude, zoom) - centerTileX) * TILE_SIZE;
            const otherY = (lat2tile(other.latitude, zoom) - centerTileY) * TILE_SIZE;
            return Math.hypot(otherX - markerX, otherY - markerY) < 28;
          });
          const overlapIndex = overlappingMarkers.length;
          const overlapAngle = (overlapIndex * 137.5 * Math.PI) / 180;
          const overlapRadius = overlapIndex === 0 ? 0 : 42 + Math.floor((overlapIndex - 1) / 5) * 18;
          const offsetX = Math.cos(overlapAngle) * overlapRadius;
          const offsetY = Math.sin(overlapAngle) * overlapRadius;
          
          return (
            <button
              type="button"
              key={m.id}
              aria-label={`Prikaži salon ${m.label}`}
              className={`absolute flex flex-col items-center justify-center cursor-pointer transition-transform origin-bottom hover:scale-110 focus:outline-none focus-visible:scale-110 ${m.active ? 'scale-110 z-10' : 'z-0'}`}
              style={{ transform: `translate(-50%, -100%) translate(${markerX + offsetX}px, ${markerY + offsetY}px)` }}
              onClick={() => {
                onMarkerClick?.(m.id);
              }}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-lg border-2 ${m.active ? 'bg-primary border-white text-white' : 'bg-white border-primary text-primary'}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
              </div>
              <div className={`w-2 h-2 rotate-45 -mt-1 border-b-2 border-r-2 ${m.active ? 'bg-primary border-white' : 'bg-white border-primary'}`}></div>
            </button>
          )
        })}
      </div>
    </div>
  );
}
