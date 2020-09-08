import React, { useState, useEffect, createRef, useCallback } from "react";
import "./App.css";
import {
  Map as LeafletMap,
  TileLayer,
  Marker,
  Popup,
  Polyline,
} from "react-leaflet";
import TextField from "@material-ui/core/TextField";
import Autocomplete from "@material-ui/lab/Autocomplete";
import { LatLngBounds, LeafletMouseEvent } from "leaflet";
import { createMuiTheme, ThemeProvider } from "@material-ui/core/styles";
import { throttle, debounce } from "lodash";
import Button from "@material-ui/core/Button";
const togpx = require("togpx");

const SOUTH_WEST = {
  lng: 10.334022,
  lat: 47.286771,
};

const NORTH_EAST = { lat: 49.096737, lng: 13.926551 };

const MAP_BOUNDS = new LatLngBounds(SOUTH_WEST, NORTH_EAST);

const RADI_THEME = createMuiTheme({
  palette: {
    primary: {
      main: "#2b9847",
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
      )}&format=json&viewbox=${SOUTH_WEST.lng},${SOUTH_WEST.lat},${
        NORTH_EAST.lng
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

  const dragStartPosition = throttle(() => {
    const pos = startMarkerRef.current?.leafletElement.getLatLng();
    if (pos) {
      routeFromHere(pos);
    }
  }, 500);

  const dragEndPosition = throttle(() => {
    const pos = endMarkerRef.current?.leafletElement.getLatLng();
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

      const queryData = `node(id:${nodes.join(",")});way(bn);out;`;

      fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "form/multipart" },
        body: `data=${encodeURIComponent(queryData)}`,
      })
        .then((response) => response.text())
        .then((answer) => {
          const surfaces: Map<string, number> = new Map();
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(answer, "text/xml");

          const ways: Array<{
            surface: string | undefined;
            nodes: Array<number>;
          }> = [...xmlDoc.getElementsByTagName("way")].map((tag) => {
            const nodes: number[] = [
              ...tag.getElementsByTagName("nd"),
            ].map((node) => parseInt(node.getAttribute("ref") || "0"));
            const surfaceTags = [...tag.getElementsByTagName("tag")].filter(
              (tag) => tag.getAttribute("k") === "surface"
            );
            return {
              surface:
                surfaceTags.length > 0
                  ? surfaceTags[0].getAttribute("v") || undefined
                  : undefined,
              nodes,
            };
          });

          queryItems.forEach((item: QueryItem) => {
            const found = ways.filter(
              (w) =>
                w.nodes.some((n) => n === item.start) &&
                w.nodes.some((n) => n === item.end)
            );
            if (found.length >= 1) {
              const matchedWay = found[0];
              const surface =
                matchedWay.surface === undefined
                  ? "Unbekannt"
                  : translateSurface(matchedWay.surface);
              if (surfaces.has(surface)) {
                const current = surfaces.get(surface) || 0;
                surfaces.set(surface, current + item.distance);
              } else {
                surfaces.set(surface, item.distance);
              }
            }
          });

          setSurfacesOnRoute(surfaces);
        });
    }, 1000),
    []
  );

  const calculateRoute = useCallback(
    throttle((startPosition, endPosition) => {
      if (startPosition && endPosition) {
        fetch(
          `https://routing.floschnell.de/route/v1/bike/${startPosition.lon},${startPosition.lat}%3b${endPosition.lon},${endPosition.lat}%3Foverview=full&alternatives=true&steps=true&geometries=geojson&annotations=true`
        )
          .then((response) => response.json())
          .then((results) => {
            setRoute(results.routes[0]);
            setRouteMetadata({
              distance: results.routes[0].distance as number,
              duration: results.routes[0].duration as number,
            });
            setSurfacesOnRoute(null);
            calculateRouteSurface(results);
          });
      }
    }, 200),
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

  const startMarkerRef = createRef<Marker>();
  const endMarkerRef = createRef<Marker>();

  if (startPosition != null && endPosition != null && surfacesOnRoute != null) {
    surfacesElement = [...surfacesOnRoute.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([k, v]) => (
        <div id={k} className="surface">
          <div className="surface-name">{k}</div>
          <div className="surface-distance">{displayDistance(v)}</div>
        </div>
      ))
      .concat(
        <div id="setup" className="route-meta-heading">
          Beschaffenheit
        </div>
      )
      .reverse();
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
    return <Polyline positions={coords}></Polyline>;
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
          <img src="logo.png" width="320" height="154" alt="Radi Logo"></img>
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
            style={{ width: 300 }}
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
          {surfacesElement ? <div id="surfaces">{surfacesElement}</div> : null}
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
          zoomControl={false}
          maxBounds={MAP_BOUNDS}
          oncontextmenu={openContextMenu}
          onViewportChange={closeContextMenu}
          onclick={closeContextMenu}
        >
          <TileLayer
            attribution='&amp;copy <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {startPosition != null ? (
            <Marker
              draggable={true}
              ondrag={dragStartPosition}
              ref={startMarkerRef}
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
              ondrag={dragEndPosition}
              ref={endMarkerRef}
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
        </LeafletMap>
      </div>
    </ThemeProvider>
  );
}

export default App;
