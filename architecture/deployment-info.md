# Deployment Infrastructure

## Frontend
| | |
|---|---|
| **S3 Bucket** | `univicoustic-frontend` (ap-south-1) |
| **CloudFront ID** | `E2IM7ENU181X52` |
| **CloudFront URL** | `https://dn2vs1a2dhu8n.cloudfront.net` |
| **Custom Domain** | `https://configurator.univicoustic.com` |
| **Contents** | React build (`index.html` + static JS/CSS chunks) |
| **Caching** | `index.html` — no-cache; everything else — 1 year immutable |

## Assets (Images, Thumbnails, PDFs, JSON)
| | |
|---|---|
| **S3 Bucket** | `univicoustic-assets` (ap-south-1) |
| **CloudFront ID** | `EM4CCSPNL02GH` |
| **CloudFront URL** | `https://d27tzvhakjjy0q.cloudfront.net` |
| **CORS Policy ID** | `e572b3d6-532c-412a-9d24-2d22b89f5e8e` (Allow-Origin: *) |

### Asset folder structure on S3
```
univicoustic-assets/
  static/
    images/
      fabric/
      flat-embossed-vmt/
      ombre/
      vicstrip/
      wood/
    _thumbcache/         ← pre-generated 200x200 thumbnails
      fabric/
      flat-embossed-vmt/
      ombre/
      wood/
    technical_specification_pdfs/
  data/
    products.json        ← product catalog (replaces /api/products)
    tech-specs.json      ← tech specs (replaces /api/products/{id}/specs)
```

## SSL Certificate
| | |
|---|---|
| **ARN** | `arn:aws:acm:us-east-1:318270725820:certificate/3bb23f8f-9a7d-451c-b903-17b714d6caac` |
| **Region** | `us-east-1` (required for CloudFront) |
| **Domain** | `configurator.univicoustic.com` |
| **Status** | ISSUED |

## DNS (GoDaddy — univicoustic.com)
| Name | Type | Value |
|------|------|-------|
| `configurator` | CNAME | `dn2vs1a2dhu8n.cloudfront.net` |
| `_fdaab5d6918844e4f2348971a305d1b6.configurator` | CNAME | `_f1361e239fce765ada7ef6ff3ce5db9c.jkddzztszm.acm-validations.aws` |

## No Backend / EC2
The app is fully static. No EC2 or server is needed in production.
- Product catalog and tech specs are static JSON files served from the assets CDN
- All images are pre-generated and served directly from S3 via CloudFront

## Key Commands

**Redeploy frontend:**
```powershell
# from frontend/
npm run build
aws s3 cp build/index.html s3://univicoustic-frontend/index.html --cache-control "no-cache, no-store, must-revalidate" --content-type "text/html"
aws s3 sync build/ s3://univicoustic-frontend/ --exclude "index.html" --cache-control "public, max-age=31536000, immutable"
aws cloudfront create-invalidation --distribution-id E2IM7ENU181X52 --paths "/*"
```

**Enable SPA routing (one-time setup — required for direct URL access like /ombre):**
```powershell
aws cloudfront get-distribution-config --id E2IM7ENU181X52 --query "DistributionConfig" --output json > cf-config.json
# In cf-config.json, add a CustomErrorResponses block:
# "CustomErrorResponses": {
#   "Quantity": 2,
#   "Items": [
#     { "ErrorCode": 403, "ResponsePagePath": "/index.html", "ResponseCode": "200", "ErrorCachingMinTTL": 0 },
#     { "ErrorCode": 404, "ResponsePagePath": "/index.html", "ResponseCode": "200", "ErrorCachingMinTTL": 0 }
#   ]
# }
# Then apply the updated config:
# aws cloudfront update-distribution --id E2IM7ENU181X52 --distribution-config file://cf-config.json --if-match <ETag>
```

**Sync assets:**
```powershell
# from backend/
aws s3 sync static/ s3://univicoustic-assets/static/ --cache-control "public, max-age=31536000, immutable"
aws cloudfront create-invalidation --distribution-id EM4CCSPNL02GH --paths "/*"
```

**Update product catalog:**
```powershell
# from backend/
python scripts/dump_catalog.py
aws s3 sync data/ s3://univicoustic-assets/data/
aws cloudfront create-invalidation --distribution-id EM4CCSPNL02GH --paths "/data/*"
```
