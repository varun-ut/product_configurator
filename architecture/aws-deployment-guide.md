# AWS Deployment Guide — Product Configurator

## Architecture Overview

```
Browser
  │
  ├──▶ CloudFront (app.yourdomain.com)
  │         └──▶ S3 Bucket  [React build — Frontend]
  │
  ├──▶ CloudFront (assets.yourdomain.com)
  │         └──▶ S3 Bucket  [Images, PDFs — Static Assets]
  │
  └──▶ EC2 — Nginx (api.yourdomain.com)
            └──▶ uvicorn :8000  [FastAPI Backend]
                      └──▶ /thumb/*  (PIL thumbnail generation, cached on disk)
```

**Why this split?**
- `/static/images/*` and `/tech-specs/*` PDFs are large binary blobs → S3 + CloudFront gives you global edge caching, no EC2 bandwidth bill for assets
- `/thumb/*` does on-the-fly Pillow image processing + disk caching → must stay on EC2
- `/api/*` is dynamic → EC2
- The React app itself is fully static after `npm run build` → cheapest possible hosting on S3

---

## Prerequisites Checklist

Before you start, have these ready:
- [ ] AWS account with Administrator access (you said: ✓)
- [ ] A domain name (can buy on Route 53 during setup, or bring your own)
- [ ] Local tools: AWS CLI v2, SSH client (PuTTY or built-in), Node.js 18+

---

## Step-by-Step Plan

---

### STEP 1 — AWS Account Hygiene & Safety Rails

**Why first:** Prevent surprise bills and lock down root.

1. **Enable MFA on root account** (AWS Console → Account → MFA)
2. **Create a Billing Alert**
   - Go to Billing → Budgets → Create Budget
   - Set a monthly budget (e.g. $50) with email alert at 80%
3. **Create a deployment IAM User** (do not use root for day-to-day work)
   - IAM → Users → Create user: `deploy-admin`
   - Attach policy: `AdministratorAccess`
   - Create Access Keys → download CSV
4. **Install & configure AWS CLI**
   ```bash
   aws configure
   # Enter: Access Key ID, Secret Key, region (e.g. ap-south-1 for Mumbai), output: json
   ```
5. **Verify CLI works**
   ```bash
   aws sts get-caller-identity
   ```

**Deliverable:** CLI configured, billing alerts on, MFA on root.

---

### STEP 2 — Domain & DNS Setup

**Why:** You need `yourdomain.com` before you can issue SSL certificates.

**Option A (Easiest): Buy domain on Route 53**
- Route 53 → Registered Domains → Register Domain
- It automatically creates a Hosted Zone for you

**Option B: Bring your own domain (Namecheap, GoDaddy, etc.)**
- Create a Hosted Zone in Route 53 for your domain
- Copy the 4 NS records Route 53 gives you
- In your registrar's DNS settings, replace the existing nameservers with those 4

**Subdomains you'll create later (not now):**
- `app.yourdomain.com` → frontend CloudFront
- `api.yourdomain.com` → EC2 / backend
- `assets.yourdomain.com` → assets CloudFront

**Deliverable:** Domain pointing at Route 53 name servers. A Hosted Zone exists in Route 53.

---

### STEP 3 — SSL Certificates via ACM

**Why now:** CloudFront requires certificates to be in `us-east-1` specifically. Request them before creating distributions.

1. Go to **ACM (Certificate Manager)** — switch region to **us-east-1** in the console header
2. Request a public certificate → add these names:
   ```
   yourdomain.com
   *.yourdomain.com
   ```
   (The wildcard covers app, api, assets subdomains with one cert)
3. Choose **DNS validation**
4. ACM will show you a CNAME record to add → click "Create records in Route 53" (one click if you used Route 53)
5. Wait 5-10 mins → Status becomes **Issued**

> ⚠️ For **Nginx on EC2** (api.yourdomain.com), you'll use **Let's Encrypt / Certbot** separately — ACM certs cannot be downloaded and installed on EC2 directly.

**Deliverable:** Wildcard cert issued in us-east-1 for CloudFront use.

---

### STEP 4 — Assets Bucket (S3 + CloudFront)

**Why before backend:** The backend's environment config needs the CDN URL for assets.

#### 4A — Create the Assets S3 Bucket

1. S3 → Create Bucket
   - Name: `yourdomain-assets` (globally unique)
   - Region: `ap-south-1` (or your closest region)
   - **Block all public access: ON** (CloudFront will access it via OAC, not public URL)
2. **Pre-generate all thumbnails locally** before uploading (one-time, then re-run whenever new images are added):
   ```bash
   # From the repo root
   cd backend
   python scripts/generate_thumbs.py
   ```
   This runs the same PIL center-crop + resize logic as the old `/thumb/` endpoint and writes
   results to `backend/static/_thumbcache/`, mirroring the source path exactly.

3. Upload everything — images AND the pre-generated thumbcache — to S3:
   ```bash
   aws s3 sync backend/static/ s3://yourdomain-assets/static/ --delete
   ```
   > `_thumbcache/` is intentionally included. Thumbnails are now static files served from CDN,
   > not generated on-demand by EC2. There is no Pillow dependency on the server.

#### 4B — Create CloudFront Distribution for Assets

1. CloudFront → Create Distribution
2. **Origin domain:** Select `yourdomain-assets.s3.ap-south-1.amazonaws.com`
3. **Origin access:** Select "Origin access control (OAC)" → Create new OAC
4. **Alternate domain names (CNAMEs):** `assets.yourdomain.com`
5. **SSL Certificate:** Select the wildcard cert from ACM (us-east-1)
6. **Default cache behavior:**
   - Viewer protocol policy: Redirect HTTP to HTTPS
   - Cache policy: `CachingOptimized` (AWS managed)
   - Allowed methods: GET, HEAD
7. **Create Distribution** → copy the CloudFront domain (e.g. `d1abc123.cloudfront.net`)
8. S3 will prompt you to update the bucket policy → copy and apply the policy it shows you
9. In Route 53 → Hosted Zone → Add Record:
   - Name: `assets`
   - Type: A (Alias)
   - Route traffic to: CloudFront distribution → select `d1abc123.cloudfront.net`

**Test:** `https://assets.yourdomain.com/static/images/fabric/somefile.png` should return an image.

**Deliverable:** `assets.yourdomain.com` serves everything from `backend/static/` via CDN.

---

### STEP 5 — EC2 Instance for the Backend

#### 5A — Launch the EC2 Instance

1. EC2 → Launch Instance
   - **Name:** `configurator-backend`
   - **AMI:** Ubuntu 24.04 LTS
   - **Instance type:** `t3.small` (2 vCPU, 2GB — sufficient for the API; upgrade if load demands it)
   - **Key pair:** Create new → download the `.pem` file → keep it safe
   - **Network settings:**
     - Allow SSH (port 22) — from your IP only (not 0.0.0.0/0)
     - Allow HTTP (port 80) — from anywhere
     - Allow HTTPS (port 443) — from anywhere
     - Do NOT expose port 8000 publicly — Nginx will front it

2. **Allocate an Elastic IP** (so the IP doesn't change on reboot)
   - EC2 → Elastic IPs → Allocate → Associate with your instance

3. In Route 53 → Add Record:
   - Name: `api`
   - Type: A
   - Value: your Elastic IP

#### 5B — Connect & Install System Dependencies

```bash
ssh -i your-key.pem ubuntu@api.yourdomain.com

# Update system
sudo apt update && sudo apt upgrade -y

# Install Python 3, pip, venv, nginx, certbot
sudo apt install -y python3 python3-pip python3-venv nginx certbot python3-certbot-nginx git

# Check Pillow OS dependencies (needed for PIL)
sudo apt install -y libjpeg-turbo8-dev libpng-dev
```

#### 5C — Deploy the Backend Code

```bash
# On EC2: create app directory
mkdir -p /home/ubuntu/app
cd /home/ubuntu/app

# Option A: Clone from git (recommended)
git clone https://github.com/yourrepo/product_configurator.git .

# Option B: Upload files (if no git)
# From your local machine:
# scp -i your-key.pem -r backend/ ubuntu@api.yourdomain.com:/home/ubuntu/app/
```

```bash
# Back on EC2: create virtualenv and install dependencies
cd /home/ubuntu/app/backend
python3 -m venv myenv
source myenv/bin/activate
pip install -r requirements.txt
```

#### 5D — Configure the Backend Environment

```bash
# Create /home/ubuntu/app/backend/.env
nano /home/ubuntu/app/backend/.env
```

Content for `.env`:
```env
# CORS — allow the production frontend origin
CORS_ORIGINS=https://app.yourdomain.com
# If you have a regex pattern for additional origins:
CORS_ORIGIN_REGEX=

# Assets CDN base URL (for any future server-side asset URL generation)
ASSETS_CDN_URL=https://assets.yourdomain.com
```

> The existing CORS code in server.py reads `CORS_ORIGINS` from the environment — just update this file.

#### 5E — Create a systemd Service

```bash
sudo nano /etc/systemd/system/configurator.service
```

```ini
[Unit]
Description=Configurator FastAPI Backend
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/app/backend
Environment="PATH=/home/ubuntu/app/backend/myenv/bin"
ExecStart=/home/ubuntu/app/backend/myenv/bin/uvicorn server:app --host 0.0.0.0 --port 8000 --workers 2
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable configurator
sudo systemctl start configurator
sudo systemctl status configurator   # should show: active (running)
```

#### 5F — Configure Nginx as Reverse Proxy

```bash
sudo nano /etc/nginx/sites-available/configurator
```

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    # Certbot will add SSL config here after Step 5G

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 60s;
        proxy_send_timeout 60s;

        # Large body limit for any potential future upload endpoints
        client_max_body_size 20M;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/configurator /etc/nginx/sites-enabled/
sudo nginx -t          # should say: syntax is ok
sudo systemctl reload nginx
```

#### 5G — SSL for the API with Certbot

```bash
sudo certbot --nginx -d api.yourdomain.com
# Follow prompts: enter email, agree to TOS, choose redirect HTTP→HTTPS
```

Certbot auto-modifies your Nginx config to add the SSL block and sets up auto-renewal.

**Test:** `https://api.yourdomain.com/api/products` should return JSON.

**Deliverable:** FastAPI running on EC2, HTTPS, auto-restart on crash.

---

### STEP 6 — Frontend Build & S3 Hosting

#### 6A — Create Environment File for Production Build

In `frontend/`, create `.env.production`:
```env
REACT_APP_BACKEND_URL=https://api.yourdomain.com
REACT_APP_ASSETS_URL=https://assets.yourdomain.com
```

> The frontend already reads `REACT_APP_BACKEND_URL` throughout the codebase (`Configurator.jsx`, `skus.js`, `use-dt-panel.js`, `downloadPanelImages.js`). The build bakes these values in at compile time — no runtime config needed.

#### 6B — Build the React App

```bash
# On your local machine, in the frontend/ directory
cd frontend
npm install
npm run build
```

This creates `frontend/build/` — a folder of static HTML/JS/CSS files ready for S3.

#### 6C — Create the Frontend S3 Bucket

1. S3 → Create Bucket
   - Name: `yourdomain-frontend`
   - Region: any (CloudFront sits in front, region doesn't matter much)
   - **Block all public access: ON** (OAC only — same as assets bucket)
2. Upload the build output:
   ```bash
   aws s3 sync frontend/build/ s3://yourdomain-frontend/ --delete
   ```

#### 6D — Create CloudFront Distribution for Frontend

1. CloudFront → Create Distribution
2. **Origin:** `yourdomain-frontend.s3.amazonaws.com`
3. **Origin access:** OAC → Create new OAC → apply the suggested bucket policy
4. **Alternate domain:** `app.yourdomain.com`
5. **SSL:** wildcard cert from ACM
6. **Default root object:** `index.html`
7. **CRITICAL — Custom Error Response** (makes React Router work):
   - Error code: 403 → Response page: `/index.html` → HTTP response: 200
   - Error code: 404 → Response page: `/index.html` → HTTP response: 200
   
   Without this, refreshing any URL other than `/` returns a 403/404 from S3.

8. **Cache behavior:**
   - For `index.html`: set Cache-Control to no-cache (so users always get latest deploy)
   - For JS/CSS/images: long cache (filenames are content-hashed by CRA, so safe)
   
   You can handle this with a CloudFront Cache Policy or by setting metadata during upload:
   ```bash
   # Upload index.html with no-cache
   aws s3 cp frontend/build/index.html s3://yourdomain-frontend/index.html \
     --cache-control "no-cache, no-store, must-revalidate" \
     --content-type "text/html"
   
   # Upload everything else with 1-year cache
   aws s3 sync frontend/build/ s3://yourdomain-frontend/ \
     --exclude "index.html" \
     --cache-control "public, max-age=31536000, immutable" \
     --delete
   ```

9. In Route 53 → Add Record:
   - Name: `app`
   - Type: A (Alias) → CloudFront distribution

**Test:** `https://app.yourdomain.com` should load the configurator.

**Deliverable:** Frontend live on CDN.

---

### STEP 7 — Wire Up Assets CDN in Frontend + Clean Up Backend

With thumbnails pre-generated and everything in S3, the `/thumb/` endpoint on EC2 becomes dead weight. This step removes it and points the frontend at the CDN for all asset URLs.

#### 7A — Update frontend environment

In `frontend/.env.production`, ensure you have:
```env
REACT_APP_BACKEND_URL=https://api.yourdomain.com
REACT_APP_ASSETS_URL=https://assets.yourdomain.com
```

#### 7B — Update URL builders in `frontend/src/data/skus.js`

Every `/thumb/` call and `/static/` image/PDF URL in `skus.js` needs to point at `ASSETS_URL` instead of `BACKEND_URL`. Concretely:

| Old pattern | New pattern |
|---|---|
| `${BACKEND_URL}/thumb/X` | `${ASSETS_URL}/static/_thumbcache/X` |
| `${BACKEND_URL}/static/images/X` | `${ASSETS_URL}/static/images/X` |
| `${BACKEND_URL}/static/technical_specification_pdfs/X` | `${ASSETS_URL}/static/technical_specification_pdfs/X` |

`BACKEND_URL` is kept only for API calls (`/api/...`).

#### 7C — Update `thumbnail_url` fields in `backend/server.py`

The product catalog returned by `/api/products` includes `thumbnail_url` fields like:
```
/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/AB-BL-02.jpg
```
Change these to use the CDN path:
```
/static/_thumbcache/flat-embossed-vmt/panels/vmd-line-and-texture/AB-BL-02.jpg
```
The frontend's `resolveAssetUrl()` in `skus.js` prepends the base URL — update it to use `ASSETS_URL` for paths starting with `/static/`, and `BACKEND_URL` only for `/api/`.

#### 7D — Remove the `/thumb/` endpoint and Pillow from the backend

In `backend/server.py`:
- Delete the `@app.get("/thumb/{path:path}")` endpoint and related constants (`THUMB_CACHE_DIR`, `THUMB_SIZE`)
- Remove the `PIL_AVAILABLE` import block

In `backend/requirements.txt`:
- Remove `pillow==...`

**Result:** EC2 no longer does any image processing. It only serves the FastAPI JSON endpoints. The instance can be downsized or replaced with Lambda in the future.

**Deliverable:** All images, thumbnails, and PDFs served from `assets.yourdomain.com` via CloudFront. Backend handles only `/api/*` requests.

---

### STEP 8 — Security Hardening

8.1 **Backend CORS** — Final `.env` on EC2 should only list your real frontend origin  
8.2 **Security Groups** — EC2 port 8000 must NOT be open to the internet (only 80/443 via Nginx)  
8.3 **S3 Bucket Policies** — Buckets must only allow CloudFront OAC, not public  
8.4 **HTTP Security Headers** — Add to Nginx config: `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`  
8.5 **Rate Limiting** (optional at launch) — Add `limit_req` in Nginx for the API if abuse is a concern (thumbnails are now on CDN, no PIL exposure)  
8.6 **Certbot auto-renewal** — Verify cron is set: `sudo certbot renew --dry-run`

---

### STEP 9 — CI/CD (Future / Optional)

Once you're comfortable with the manual process:

9.1 **Frontend deploys** — GitHub Actions: on push to `main`, run `npm run build`, sync to S3, invalidate CloudFront cache  
9.2 **Backend deploys** — GitHub Actions SSH deploy or CodeDeploy: pull latest code, restart systemd service  
9.3 **Asset uploads** — One-time or on-demand `aws s3 sync` from a script

---

## Deployment Order Summary

| # | Step | Service | Time Estimate |
|---|------|---------|---------------|
| 1 | AWS hygiene, IAM, CLI | IAM / Billing | 30 min |
| 2 | Domain + Route 53 | Route 53 | 30 min + DNS propagation |
| 3 | SSL Cert (wildcard) | ACM us-east-1 | 15 min |
| 4 | Assets S3 + CloudFront | S3 / CloudFront | 1 hr |
| 5 | Backend on EC2 | EC2 / Nginx / systemd | 2 hr |
| 6 | Frontend build + S3 + CloudFront | S3 / CloudFront | 1 hr |
| 7 | Wire up CDN URLs in code | Code changes | 1 hr |
| 8 | Security hardening | Various | 1 hr |

**Total first-time:** ~7-8 hours spread across a day (DNS propagation needs waiting).

---

## Estimated AWS Monthly Cost (light traffic)

| Service | Config | Est. Cost |
|---------|--------|-----------|
| EC2 t3.small | 24/7 | ~$15/mo |
| Elastic IP | 1 IP | $0 (while attached) |
| S3 | <5 GB | ~$0.12/mo |
| CloudFront | <50 GB transfer | ~$4/mo |
| Route 53 | 1 hosted zone | $0.50/mo |
| ACM | Wildcard cert | Free |
| **Total** | | **~$20/mo** |

---

## Reference — Key Files in This Project

| File | Purpose | What changes for production |
|------|---------|----------------------------|
| `backend/.env` | CORS origins, env config | Update to prod frontend domain |
| `backend/server.py` | FastAPI app entrypoint | May add asset redirect logic (Step 7) |
| `backend/requirements.txt` | Python deps | Install these on EC2 |
| `frontend/.env.production` | React build env vars | Set `REACT_APP_BACKEND_URL` + `REACT_APP_ASSETS_URL` |
| `frontend/src/pages/Configurator.jsx` | Main app, reads `REACT_APP_BACKEND_URL` | No changes needed if env var is set |
| `frontend/src/data/skus.js` | Reads `REACT_APP_BACKEND_URL` | No changes needed |
| `frontend/src/lib/downloadPanelImages.js` | Reads `REACT_APP_BACKEND_URL` | No changes needed |
