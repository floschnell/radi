import React, { useState, useEffect, useCallback } from "react";
import "./App.css";
import {
  MapContainer as LeafletMap,
  TileLayer,
  Marker,
  Popup,
  Polyline,
} from "react-leaflet";
import TextField from "@material-ui/core/TextField";
import Autocomplete from "@material-ui/lab/Autocomplete";
import { LatLngBounds, LeafletEvent, LeafletMouseEvent, Map as LMap } from "leaflet";
import { createMuiTheme, ThemeProvider } from "@material-ui/core/styles";
import { throttle, debounce } from "lodash";
import Button from "@material-ui/core/Button";
import { LinearProgress } from "@material-ui/core";
const togpx = require("togpx");

const RADI_GREEN = "#00BCF2";

const SOUTH_WEST = {
  lng: 10.334022,
  lat: 47.286771,
};

const NORTH_EAST = { lat: 49.096737, lng: 13.926551 };

const MAP_BOUNDS = new LatLngBounds(SOUTH_WEST, NORTH_EAST);

const RADI_THEME = createMuiTheme({
  palette: {
    primary: {
      main: RADI_GREEN,
    },
  },
});

interface NominatimItem {
  display_name: string;
  place_id: number;
  lat: string;
  lon: string;
}

interface RouteMetadata {
  distance: number;
  duration: number;
}

interface QueryItem {
  distance: number;
  start: number;
  end: number;
  surface: string | undefined;
}

async function geocode(value: string): Promise<Array<NominatimItem>> {
  if (value.trim().length > 0) {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        value
      )}&format=json&viewbox=${SOUTH_WEST.lng},${SOUTH_WEST.lat},${NORTH_EAST.lng
      },${NORTH_EAST.lat}&bounded=1`
    );
    return response.json();
  } else {
    return [];
  }
}

function displayDistance(distance: number): string {
  if (distance > 1000) {
    return `${Math.floor(distance / 1000)},${Math.round(
      (distance % 1000) / 10
    )} km`;
  } else {
    return `${Math.round(distance)} m`;
  }
}

function download(filename: string, xml: string): void {
  var element = document.createElement("a");
  element.setAttribute(
    "href",
    "data:application/xml;charset=utf-8," + encodeURIComponent(xml)
  );
  element.setAttribute("download", filename);

  element.style.display = "none";
  document.body.appendChild(element);

  element.click();

  document.body.removeChild(element);
}

function translateSurface(surface: string): string {
  switch (surface) {
    case "paved":
    case "asphalt":
    case "concrete":
      return "Asphalt";
    case "concrete:lanes":
      return "Asphaltweg";
    case "concrete:plates":
      return "Asphaltplatten";
    case "paving_stones":
      return "Ebener Pflasterstein";
    case "sett":
    case "cobblestone":
      return "Pflasterstein";
    case "unhewn_cobblestone":
      return "Kopfsteinpflaster";
    case "unpaved":
      return "Uneben";
    case "compacted":
      return "Guter Waldweg";
    case "fine_gravel":
    case "pebblestone":
      return "Kies";
    case "gravel":
      return "Schotter";
    case "earth":
    case "dirt":
    case "ground":
      return "Erdboden";
    case "grass":
      return "Gras";
    case "grass_paver":
      return "Betonstein auf Gras";
    case "mud":
      return "Matsch";
    case "sand":
      return "Sand";
    case "woodchips":
      return "Holzschnitzel";
    default:
      return surface;
  }
}

const SURFACE_COLORS = new Map([
  ["Asphalt", "#4682B4"],
  ["Asphaltweg", "#ADD8E6"],
  ["Asphaltplatten", "#B0C4DE"],
  ["Ebener Pflasterstein", "#C0C0C0"],
  ["Pflasterstein", "#A9A9A9"],
  ["Kopfsteinpflaster", "#808080"],
  ["Uneben", "#FFA07A"],
  ["Guter Waldweg", "#006400"],
  ["Kies", "#708090"],
  ["Schotter", "#696969"],
  ["Erdboden", "#CD853F"],
  ["Gras", "#228B22"],
  ["Betonstein auf Gras", "#8FBC8F"],
  ["Matsch", "#BDB76B"],
  ["Sand", "#F4A460"],
  ["Holzschnitzel", "#DEB887"],
]);

function translateLit(lit: string): string {
  if (lit == "no") {
    return "Nicht beleuchtet";
  } else {
    return "Beleuchtet";
  }
}

const LIT_COLORS = new Map([
  ["Beleuchtet", "yellow"],
  ["Nicht beleuchtet", "black"],
]);

function App() {
  const [startSuggestions, setStartSuggestions] = useState<
    Array<NominatimItem>
  >(new Array<NominatimItem>());
  const [endSuggestions, setEndSuggestions] = useState<Array<NominatimItem>>(
    new Array<NominatimItem>()
  );
  const [startValue, setStartValue] = useState("");
  const [endValue, setEndValue] = useState("");
  const [startPosition, setStartPosition] = useState<NominatimItem | null>(
    null
  );
  const [endPosition, setEndPosition] = useState<NominatimItem | null>(null);
  const [route, setRoute] = useState<null | any>();
  const [surfacesOnRoute, setSurfacesOnRoute] = useState<null | Map<
    string,
    number
  >>(null);
  const [illuminatedOnRoute, setIlluminatedOnRoute] = useState<null | Map<
    string,
    number
  >>(null);
  const [illuminatedPaths, setIlluminatedPaths] = useState<null | Map<string, Array<Array<{ lat: number, lon: number }>>>>(null);
  const [surfacePaths, setSurfacePaths] = useState<null | Map<string, Array<Array<{ lat: number, lon: number }>>>>(null);
  const [routeMetadata, setRouteMetadata] = useState<RouteMetadata | null>(
    null
  );
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    left: number;
    top: number;
    lat: number;
    lng: number;
  } | null>(null);
  const [menuMinimized, setMenuMinimized] = useState<boolean>(false);
  const [hightlightLit, setHightlightLit] = useState<string | null>(null);
  const [hightlightSurface, setHightlightSurface] = useState<string | null>(null);
  const [map, setMap] = useState<LMap | null>(null);

  useEffect(() => {
    if (map != null) {
      map.on("contextmenu", (e: LeafletMouseEvent) => {
        openContextMenu(e);
      });
      map.on("movestart", () => closeContextMenu());
      map.on("click", () => closeContextMenu());
    }
  }, [map])

  const autocompleteStart = useCallback(
    debounce((value) => {
      geocode(value).then(setStartSuggestions);
    }, 1000),
    []
  );

  const autocompleteEnd = useCallback(
    debounce((value) => {
      geocode(value).then(setEndSuggestions);
    }, 1000),
    []
  );

  useEffect(() => autocompleteStart(startValue), [startValue]);
  useEffect(() => autocompleteEnd(endValue), [endValue]);

  const dragStartPosition = throttle((e: LeafletEvent) => {
    // console.log(e);
    const pos = e.target?.getLatLng();
    if (pos) {
      routeFromHere(pos);
    }
  }, 500);

  const dragEndPosition = throttle((e: LeafletEvent) => {
    // console.log(e);
    const pos = e.target?.getLatLng();
    if (pos) {
      routeToHere(pos);
    }
  }, 500);

  const calculateRouteSurface = useCallback(
    debounce((results) => {
      const nodes = results.routes[0].legs[0].annotation.nodes;
      const distances = results.routes[0].legs[0].annotation.distance;

      const queryItems: Array<QueryItem> = nodes
        .map((n: number, i: number) => {
          if (i < nodes.length - 1) {
            return {
              distance: distances[i],
              start: n,
              end: nodes[i + 1],
            };
          } else {
            return null;
          }
        })
        .filter((i: QueryItem | null) => i !== null);

      const queryData = `[out:json][timeout:25];node(id:${nodes.join(",")});way(bn);(._;>;);out;`;

      fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "form/multipart" },
        body: `data=${encodeURIComponent(queryData)}`,
      })
        .then((response) => response.json())
        .then((answer) => {
          const surfaces: Map<string, number> = new Map();
          const illuminated: Map<string, number> = new Map();

          const ways = answer.elements.filter((e: any) => e.type === 'way');
          const nodesById = Object.fromEntries(answer.elements.filter((e: any) => e.type === 'node').map((node: any) => [node.id, node]));
          const illuminatedPaths = new Map<string, Array<Array<{ lat: number, lon: number }>>>();
          const surfacePaths = new Map<string, Array<Array<{ lat: number, lon: number }>>>();

          for (const item of queryItems) {
            const wayContainingNodes = ways.find((way: any) => way.nodes.includes(item.start) && way.nodes.includes(item.end));
            const surface = wayContainingNodes.tags.surface === undefined ? "Unbekannt" : translateSurface(wayContainingNodes.tags.surface);
            const lit = wayContainingNodes.tags.lit === undefined ? "Unbekannt" : translateLit(wayContainingNodes.tags.lit);
            const startNode = nodesById[item.start];
            const endNode = nodesById[item.end];
            const path = [startNode, endNode];

            if (illuminatedPaths.has(lit)) {
              const lastPoint = illuminatedPaths.get(lit)?.slice(-1)?.[0]?.slice(-1)?.[0];
              if (lastPoint !== undefined && lastPoint.lat === startNode.lat && lastPoint.lon === startNode.lon) {
                illuminatedPaths.get(lit)?.slice(-1)?.[0].push(endNode);
              } else {
                illuminatedPaths.get(lit)?.push(path);
              }
            } else {
              illuminatedPaths.set(lit, [path]);
            }

            if (surfacePaths.has(surface)) {
              const lastPoint = surfacePaths.get(surface)?.slice(-1)?.[0]?.slice(-1)?.[0];
              if (lastPoint !== undefined && lastPoint.lat === startNode.lat && lastPoint.lon === startNode.lon) {
                surfacePaths.get(surface)?.slice(-1)?.[0].push(endNode);
              } else {
                surfacePaths.get(surface)?.push(path);
              }
            } else {
              surfacePaths.set(surface, [path]);
            }

            if (surfaces.has(surface)) {
              const current = surfaces.get(surface) || 0;
              surfaces.set(surface, current + item.distance);
            } else {
              surfaces.set(surface, item.distance);
            }

            if (illuminated.has(lit)) {
              const current = illuminated.get(lit) || 0;
              illuminated.set(lit, current + item.distance);
            } else {
              illuminated.set(lit, item.distance);
            }
          }
          setIlluminatedPaths(illuminatedPaths);
          setSurfacePaths(surfacePaths);
          setSurfacesOnRoute(surfaces);
          setIlluminatedOnRoute(illuminated);
        });
    }, 1000),
    []
  );

  const calculateRoute = useCallback(
    throttle((startPosition, endPosition) => {
      if (startPosition && endPosition) {
        fetch(
          `https://routing.floschnell.de/route/v1/bike/${startPosition.lon},${startPosition.lat}%3b${endPosition.lon},${endPosition.lat
          }%3Foverview=full&alternatives=true&steps=true&geometries=geojson&annotations=true`
        )
          .then((response) => response.json())
          .then((results) => {
            setRoute(results.routes[0]);
            setRouteMetadata({
              distance: results.routes[0].distance as number,
              duration: results.routes[0].duration as number,
            });
            setIlluminatedPaths(null);
            setSurfacePaths(null);
            setSurfacesOnRoute(null);
            setIlluminatedOnRoute(null);
            calculateRouteSurface(results);
          });
      }
    }, 500),
    []
  );

  const exportGpx = useCallback(() => {
    if (route.geometry != null) {
      const routeGpx = togpx(route.geometry);
      download("route.gpx", routeGpx);
    }
  }, [route]);

  const openContextMenu = useCallback((e: LeafletMouseEvent) => {
    e.originalEvent.preventDefault();
    setContextMenuPosition({
      left: e.originalEvent.clientX,
      top: e.originalEvent.clientY,
      lat: e.latlng.lat,
      lng: e.latlng.lng,
    });
    console.log(
      "clicked on point",
      e.latlng,
      e.originalEvent.clientX,
      e.originalEvent.clientY
    );
    return false;
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenuPosition(null);
  }, []);

  const toggleMenu = useCallback(() => {
    setMenuMinimized(!menuMinimized);
  }, [menuMinimized]);

  const routeFromHere = useCallback(
    (position: { lat: number; lng: number }) => {
      const item = {
        display_name: `[${position.lat.toPrecision(
          8
        )}; ${position.lng.toPrecision(8)}]`,
        place_id: 1,
        lat: position.lat.toString() || "0",
        lon: position.lng.toString() || "0",
      };
      setStartSuggestions([item]);
      setStartPosition(item);
      closeContextMenu();
    },
    []
  );

  const routeToHere = useCallback((position: { lat: number; lng: number }) => {
    const item = {
      display_name: `[${position.lat.toPrecision(
        8
      )}; ${position.lng.toPrecision(8)}]`,
      place_id: 2,
      lat: position.lat.toString() || "0",
      lon: position.lng.toString() || "0",
    };
    setEndSuggestions([item]);
    setEndPosition(item);
    closeContextMenu();
  }, []);

  useEffect(() => calculateRoute(startPosition, endPosition), [
    startPosition,
    endPosition,
  ]);

  let surfacesElement = null;
  let illuminatedElement = null;

  if (startPosition != null && endPosition != null && surfacesOnRoute != null) {
    surfacesElement = <div style={{ display: 'flex', height: '30px' }}>{
      [...surfacesOnRoute.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([k, v]) => (
        <div onMouseEnter={() => setHightlightSurface(k)} onMouseLeave={() => setHightlightSurface(null)} id={k} style={{ background: SURFACE_COLORS.get(k) || 'gray', flexGrow: v / ([...surfacesOnRoute.values()].reduce((p, v) => p + v, 0)) * 100 }}></div>
      ))
      .reverse()
    }</div>;
  }

  if (startPosition != null && endPosition != null && illuminatedOnRoute != null) {
    illuminatedElement = <div style={{ display: 'flex', height: '30px', marginTop: 0 }}>{
        [...illuminatedOnRoute.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([k, v]) => (
          <div onMouseEnter={() => setHightlightLit(k)} onMouseLeave={() => setHightlightLit(null)} id={k} style={{ background: LIT_COLORS.get(k) || 'gray', flexGrow: v / ([...illuminatedOnRoute.values()].reduce((p, v) => p + v, 0)) * 100 }}></div>
        ))
        .reverse()
      }</div>;
  }

  const routeMetaElement = routeMetadata ? (
    <div id="route-metadata">
      <div id="route-header" className="route-meta-heading">
        Berechnete Route
      </div>
      <div id="route-duration" className="route-meta">
        <div id="route-duration-key">Geschätzte Dauer</div>
        <div id="route-duration-value">
          {routeMetadata
            ? `${Math.round(routeMetadata.duration / 60)} Minuten`
            : "unbekannt"}
        </div>
      </div>
      <div id="route-distance" className="route-meta">
        <div id="route-distance-key">Gesamtdistanz</div>
        <div id="route-distance-value">
          {routeMetadata
            ? displayDistance(routeMetadata.distance)
            : "unbekannt"}
        </div>
      </div>
    </div>
  ) : null;

  const drawRoute = (route: any) => {
    const coords = route.geometry.coordinates.map(
      (tuple: Array<Array<number>>) => ({
        lat: tuple[1],
        lng: tuple[0],
      })
    );
    return <Polyline positions={coords} color="#005180"></Polyline>;
  };

  const drawIlluminated = () => {
    return illuminatedPaths == null ? [] : [...illuminatedPaths.entries()]
      .filter(([key, _]) => key === hightlightLit)
      .map(([key, entry]) => entry.map(
        (litPath) => <React.Fragment>
          <Polyline color={'white'} weight={6} positions={
            litPath.map(
              (point) => ({ lat: point.lat, lng: point.lon })
            )
          }></Polyline>
          <Polyline color={LIT_COLORS.get(key) || 'gray'} weight={4} positions={
            litPath.map(
              (point) => ({ lat: point.lat, lng: point.lon })
            )
          }></Polyline>
        </React.Fragment>
      )
      );
  };

  const drawSurfaces = () => {
    return surfacePaths == null ? [] : [...surfacePaths.entries()]
      .filter(([key, _]) => key === hightlightSurface)
      .map(([key, entry]) => entry.map(
        (surfacePath) => <React.Fragment>
          <Polyline color={'white'} weight={6} positions={
            surfacePath.map(
              (point) => ({ lat: point.lat, lng: point.lon })
            )
          }></Polyline>
          <Polyline color={SURFACE_COLORS.get(key) || 'gray'} weight={4} positions={
            surfacePath.map(
              (point) => ({ lat: point.lat, lng: point.lon })
            )
          }></Polyline>
        </React.Fragment>
      )
      );
  };

  return (
    <ThemeProvider theme={RADI_THEME}>
      <div className="App">
        {contextMenuPosition !== null ? (
          <div
            id="menu"
            style={{
              left: `${contextMenuPosition.left}px`,
              top: `${contextMenuPosition.top}px`,
            }}
          >
            <Button
              color="primary"
              onClick={() => routeFromHere(contextMenuPosition)}
            >
              Route von hier
            </Button>
            <Button
              color="primary"
              onClick={() => routeToHere(contextMenuPosition)}
            >
              Route zu dieser Position
            </Button>
          </div>
        ) : null}
        <div className={`routing ${menuMinimized ? "routing--minimized" : ""}`}>
          <div className="menu-toggle" onClick={toggleMenu}></div>
          <img src="logo.png" width="320" height="100" alt="Radi Logo"></img>
          <Autocomplete
            id="start"
            filterOptions={(x) => x}
            value={startPosition}
            onInputChange={(_props, newValue: string, _reason) => {
              console.log("set value", newValue);
              setStartValue(newValue);
            }}
            clearOnBlur={false}
            onChange={(e, newValue) => {
              console.log("selected", newValue);
              setStartPosition(newValue);
              if (newValue == null) {
                setRoute(null);
                setRouteMetadata(null);
              }
            }}
            options={startSuggestions}
            getOptionLabel={(option: NominatimItem | null) =>
              !option ? "" : option.display_name
            }
            getOptionSelected={(a, b) => a.place_id === b.place_id}
            style={{ width: 300, marginTop: '20px' }}
            noOptionsText={"Für Vorschläge Adresse eingeben ..."}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Startposition"
                variant="outlined"
                fullWidth
              />
            )}
          />
          <Autocomplete
            id="end"
            filterOptions={(x) => x}
            value={endPosition}
            clearOnBlur={false}
            onInputChange={(_props, newValue: string, _reason) => {
              console.log("set value", newValue);
              setEndValue(newValue);
            }}
            onChange={(e, newValue) => {
              console.log("selected", newValue);
              setEndPosition(newValue);
              if (newValue == null) {
                setRoute(null);
                setRouteMetadata(null);
              }
            }}
            options={endSuggestions}
            getOptionLabel={(option: NominatimItem | null) =>
              !option ? "" : option.display_name
            }
            getOptionSelected={(a, b) => a.place_id === b.place_id}
            style={{ width: 300 }}
            noOptionsText={"Für Vorschläge Adresse eingeben ..."}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Ziel"
                variant="outlined"
                fullWidth
              />
            )}
          />
          {routeMetaElement}
          {surfacesElement}
          {illuminatedElement}
          {startPosition != null && endPosition != null && (surfacesElement == null || illuminatedElement == null || routeMetaElement == null) ? <LinearProgress /> : null}
          <Button
            variant="contained"
            color="primary"
            onClick={exportGpx}
            disabled={route == null}
          >
            Route als GPX exportieren
          </Button>
        </div>
        <LeafletMap
          className="map"
          center={[48.134991, 11.584225]}
          zoom={13}
          zoomAnimation={true}
          zoomControl={false}
          maxBounds={MAP_BOUNDS}
          ref={setMap}
        >
          <TileLayer
            attribution='&amp;copy <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {startPosition != null ? (
            <Marker
              draggable={true}
              eventHandlers={{
                drag: (e) => dragStartPosition(e),
              }}
              position={[
                parseFloat(startPosition.lat),
                parseFloat(startPosition.lon),
              ]}
            >
              <Popup>{startPosition.display_name}</Popup>
            </Marker>
          ) : null}
          {endPosition != null ? (
            <Marker
              draggable={true}
              eventHandlers={{
                drag: (e) => dragEndPosition(e),
              }}
              position={[
                parseFloat(endPosition.lat),
                parseFloat(endPosition.lon),
              ]}
            >
              <Popup>{endPosition.display_name}</Popup>
            </Marker>
          ) : null}
          {route != null && startPosition != null && endPosition != null
            ? drawRoute(route)
            : null}
          {illuminatedPaths != null && startPosition != null && endPosition != null ? drawIlluminated() : null}
          {surfacePaths != null && startPosition != null && endPosition != null ? drawSurfaces() : null}
        </LeafletMap>
      </div>
    </ThemeProvider>
  );
}

export default App;
