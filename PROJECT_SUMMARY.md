# UniVicoustic 2D Product Configurator — Project Summary

## Overview
This project is a web-based MVP 2D product configurator for UniVicoustic, an acoustic wall panel company. The configurator enables users to visualize wall panels in a room scene, focusing on speed, scalability, and modular product data.

### User Personas
- **Interior Designers:** Visualize panel options for client presentations
- **Architects:** Quickly configure acoustic panel specifications
- **Commercial Buyers:** Preview panels before bulk ordering

## Core Features
- 4 Product Types: VMD Panels, Colored HD VMD, Ombre Panels, VicStrip Panels
- Dynamic configuration based on product type
- Real-time wall preview and 2D visualization
- Save/load favorite configurations
- Download rendered images
- Scalable architecture for 1000+ SKUs

## Architecture
- **Frontend:** React (SPA), provides the main UI and visualization logic
- **Backend:** FastAPI, serves product data and images, handles technical specs and thumbnail generation
- **Image Pipeline:** S3 buckets for raw and processed images, Lambda for image processing, CloudFront CDN for delivery
- **Data:** Product SKUs and configurations are modular and extensible

### System Flow
1. **Admin UI** uploads assets to S3 (raw)
2. **Lambda** processes images (WebP, thumbnails, previews)
3. **Processed images** stored in S3, served via CloudFront CDN
4. **Backend** reads SKU data from Postgres, returns CDN URLs in API responses
5. **Frontend** fetches product data and renders interactive configurator

## Implementation Highlights
- **Backend:**
  - `/api/products` — Returns all product types with configurations
  - `/api/products/{id}` — Get specific product
  - `/api/products/{id}/categories` — Get categories
  - `/api/products/{id}/specs` — Get technical specifications
  - `/thumb/{path}` — Dynamic thumbnail generation and caching
  - **Deboss/Emboss Engine:** Applies realistic 3D effects to panel textures
- **Frontend:**
  - Main entry: `src/App.js` and `src/pages/Configurator.jsx`
  - Canvas rendering for wall and panel visualization
  - Modular product data in `src/data/skus.js`
  - Technical specs and sustainability info displayed in UI

## Usage
- Run the backend (FastAPI) to serve API and images
- Run the frontend (React) for the configurator UI
- Configure product SKUs and assets as needed

## Documentation
- See `README.md` (root) and `frontend/README.md` for setup and usage instructions
- See `architecture/pilot.md` for detailed architecture diagrams and notes
- See `memory/PRD.md` for product requirements and personas

---
*Generated summary based on codebase and documentation as of March 2026.*
