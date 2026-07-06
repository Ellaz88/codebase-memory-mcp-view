# 3D Codebase Graph Viewer

Production-ready, mobile-first static 3D graph viewer for `Ellaz88/codebase-memory-mcp-view`.

This branch is designed for direct Vercel deployment with no build step.

## Files

```text
/
├── index.html
├── styles.css
├── app.js
└── data/
    └── graph.json
```

## What it does

- Loads `/data/graph.json` by default.
- Supports external graph loading with `?graph=<encoded-json-url>`.
- Supports local JSON file upload from iPhone Files app or desktop.
- Uses Three.js ES modules from a CDN.
- Renders nodes with `InstancedMesh` for better mobile performance.
- Renders edges as 3D line segments.
- Computes a client-side 3D force-directed layout when nodes lack `x`, `y`, and `z` coordinates.
- Falls back to a deterministic spherical layout for very large graphs.
- Supports tap-to-open node details, camera fit, and share-link copy.
- Tuned for iPhone/mobile safe-area layout and touch navigation.

## Graph format

Minimum valid graph:

```json
{
  "nodes": [
    { "id": "a", "label": "Node A" },
    { "id": "b", "label": "Node B" }
  ],
  "edges": [
    { "source": "a", "target": "b", "type": "depends_on" }
  ]
}
```

Optional node fields:

```json
{
  "id": "app",
  "label": "app.js",
  "type": "viewer",
  "path": "/app.js",
  "size": 30,
  "color": "#22c55e",
  "x": 0,
  "y": 120,
  "z": -80
}
```

If `x`, `y`, and `z` are missing, the app computes positions in the browser.

## Vercel deployment settings

Use these settings when importing the GitHub repository into Vercel:

- Framework Preset: `Other`
- Root Directory: `/`
- Build Command: leave empty
- Output Directory: leave empty
- Branch to deploy: `add-3d-graph-viewer`

## iPhone usage

1. Open the deployed `vercel.app` URL in Safari or Chrome.
2. The demo graph loads automatically from `/data/graph.json`.
3. Tap and drag to rotate, pinch to zoom, and two-finger drag to pan.
4. Tap a node to open its details panel.
5. Tap **Upload** to load your own `graph.json` from the iPhone Files app.
6. Tap **Fit** to refocus the camera.
7. Tap **Share** to copy the current viewer link.

## Validation checklist

After deployment:

- `/` returns HTTP 200.
- `/data/graph.json` returns HTTP 200.
- `/data/graph.json` parses as JSON.
- The page displays node and edge counts.
- Tapping a node opens the details panel.

## Notes

For very large graphs, client-side layout can become expensive on mobile. For graphs above several thousand nodes, generate `x`, `y`, and `z` positions server-side or add clustering/progressive loading.
