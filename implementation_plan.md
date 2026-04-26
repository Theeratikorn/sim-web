# Physics Simulation Portal (PhET-Style)

This plan outlines the creation of a modern, dynamic web application to host and display your 20+ physics simulations. The goal is to provide a "PhET-like" user experience with a highly polished design.

## User Review Required
> [!IMPORTANT]
> **Technology Stack Decision**: This plan proposes using **Vite + React** with **Vanilla CSS** for the main portal site. This allows for a smooth, single-page application experience with modern routing and state management for searching/filtering.
> - **How to embed your sims**: We will create a flexible viewer. If your simulations are standalone HTML files, we will embed them using `<iframe>`. If they are React components, we can import them directly.
> - **Please confirm** if Vite + React is acceptable for the main portal.

## Proposed Changes

### Portal Architecture
We will structure the application into two main views:
1. **The Library (Home Page)**: A visually stunning grid of your simulations, complete with search and category filters (e.g., Mechanics, Optics, Quantum).
2. **The Simulation Viewer**: A dedicated view for running a selected simulation, with a "Back to Library" button, full-screen toggle, and an area for description/instructions.

---

### Phase 1: Project Setup (Vite + React + Vanilla CSS)
Initialize a new Vite project in `e:\simWeb` to serve as the portal. Create the foundational CSS variables and theming (dark mode supported, vibrant accents, glassmorphism UI).

#### [NEW] index.html
#### [NEW] src/main.jsx
#### [NEW] src/index.css (Design System & Variables)
#### [NEW] src/App.jsx

---

### Phase 2: Core Components

#### [NEW] src/components/Header.jsx
A sleek top navigation bar with the website title and an optional dark/light mode toggle.

#### [NEW] src/components/SearchBar.jsx
An input field with dynamic filtering capabilities to search simulations by name or keyword.

#### [NEW] src/components/SimCard.jsx
A highly aesthetic card component representing a single simulation. It will feature:
- A placeholder for a thumbnail image.
- Title and tags.
- Smooth hover animations (scaling, glowing borders).

#### [NEW] src/components/SimGrid.jsx
A responsive grid layout to house multiple `SimCard` components.

---

### Phase 3: The Simulation Viewer & Routing

#### [NEW] src/pages/Home.jsx
The main library page integrating the Header, SearchBar, and SimGrid.

#### [NEW] src/pages/SimViewer.jsx
The dedicated page for running a selected simulation. It will use an `<iframe>` configured to take up most of the screen, allowing you to easily drop in your external HTML/Three.js files.

---

### Phase 4: Data Management & Example Setup

#### [NEW] src/data/simulations.js
A centralized data file (array of objects) where you can easily keep track of your 20+ simulations. We will populate this with 3-4 placeholder examples so you can see how to add yours.
Example data structure:
```javascript
{
  id: 'projectile-motion',
  title: 'Projectile Motion',
  category: 'Mechanics',
  entryUrl: '/sims/projectile/index.html', // Path to your HTML file
  thumbnail: '/assets/thumb-projectile.jpg',
  description: 'Simulate the motion of a projectile...'
}
```

## Open Questions
> [!WARNING]
> 1. Do your existing simulations have a lot of shared assets (like images or libraries) that need to be centralized, or are they completely independent HTML/JS packages?
> 2. Would you like a specific color scheme (e.g., dark theme like space, or clean light theme like a laboratory)?
> 3. Do you have thumbnail images for these simulations ready, or should I generate some aesthetic placeholders using AI for now?

## Verification Plan

### Manual Verification
- Verify that the development server starts correctly (`npm run dev`).
- Test the responsive layout (mobile vs. desktop).
- Verify that filtering and searching actually update the simulation grid.
- Click on an example simulation and verify the viewer opens and loads an embedded `<iframe>` successfully.
