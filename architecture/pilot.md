┌──────────────┐    ┌─────────────────────────────────────────────┐
│  Admin UI    │───▶│  S3 Bucket (raw uploads)                    │
│  (React)     │    │  s3://univicoustic-assets/raw/              │
└──────────────┘    └───────────────┬─────────────────────────────┘
                                    │ upload triggers
                                    ▼
                    ┌───────────────────────────────┐
                    │  Lambda – Image Pipeline       │
                    │  · converts to WebP            │
                    │  · generates thumbnail (200px) │
                    │  · generates preview (800px)   │
                    │  · generates full (2000px)     │
                    └───────────────┬───────────────┘
                                    │ writes processed images
                                    ▼
                    ┌──────────────────────────────────────┐
                    │  S3 Bucket (processed)                │
                    │  s3://univicoustic-assets/            │
                    │    products/{type}/{category}/        │
                    │      {sku}-thumb.webp                 │
                    │      {sku}-preview.webp               │
                    │      {sku}-full.webp                  │
                    └─────────────────┬────────────────────┘
                                      │
                    ┌─────────────────▼────────────────────┐
                    │  CloudFront CDN                       │
                    │  cdn.univicoustic.com                 │
                    │  · edge caching                       │
                    │  · gzip / brotli                      │
                    │  · cache-control headers              │
                    └──────────────────────────────────────┘
                                      ▲
                    ┌─────────────────┴────────────────────┐
                    │  FastAPI Backend (ECS/EC2)            │
                    │  · reads SKU data from Postgres (RDS) │
                    │  · returns CDN URLs in API responses  │
                    │  · S3 presigned URL for admin uploads │
                    └──────────────────────────────────────┘
                                      ▲
                    ┌─────────────────┴────────────────────┐
                    │  React Frontend (S3 + CloudFront)    │
                    │  · no images in the repo at all       │
                    │  · image URLs come from the API       │
                    └──────────────────────────────────────┘