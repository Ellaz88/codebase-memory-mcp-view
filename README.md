# 3D Codebase Graph Viewer

This branch contains a production-ready static 3D graph viewer intended for mobile use (iPhone 17). It uses Three.js and serves as a static site — no build step required. Files included in the repo root:

- index.html — entry point
- styles.css — mobile-first styles
- app.js — main 3D viewer (ES module + three.js CDN)
- data/graph.json — sample embedded graph to demo

How to deploy on Vercel (manual)
1. Go to https://vercel.com/new and import this repository.
2. Project settings:
   - Framework Preset: Other
   - Root Directory: /
   - Build Command: (leave empty)
   - Output Directory: (leave empty)
3. Click Deploy.

Using the viewer on iPhone
- Open the deployed URL on your iPhone.
- The viewer will load /data/graph.json by default. To load a graph hosted elsewhere, append ?graph=<raw-URL> to the URL.
  Example: https://your-site.vercel.app/?graph=https://raw.githubusercontent.com/user/repo/branch/path/graph.json
- Tap nodes to open a details panel. Use pinch-to-zoom & drag to pan. Use the Share button to copy a link for WhatsApp.

Notes & next steps
- The app assumes node positions (x,y,z) may be present. If your graph doesn't include coordinates, the viewer will compute a client-side force layout for small-to-medium graphs. For very large graphs, it falls back to random positions and recommends server-side layout generation.
- For very large graphs (>5k nodes) performance may be limited on phones; I can add LOD/clustering/progressive loading if needed.

If you want additional design polish (icons, animations, improved color system, accessibility improvements, or server-hosted graph loading), I will implement next after your approval.
