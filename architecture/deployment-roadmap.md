# AWS Deployment Learning Roadmap

## Context
- Already know: EC2, SSH (PuTTY), basic Linux, systemd, Ubuntu
- Goal: Deploy the UniVicoustic configurator + become proficient with AWS/cloud
- Approach: Learn concepts on a small personal project first, then apply to real app

---

## Stage 1 — Domains and DNS (1-2 days)

**Goal:** Buy a domain, point it at an EC2 server manually, understand what's actually happening.

**What you'll learn:**
- What a domain registrar is vs DNS
- A records vs CNAME records
- What TTL means and why DNS changes take time
- How a browser resolves a domain to an IP

**Practical exercise:**
1. Buy a cheap domain (~$1-2/year for `.xyz` or `.dev`) on Namecheap
2. Launch a free t2.micro EC2 with Ubuntu
3. Run a dead-simple Python HTTP server on port 80:
   ```bash
   python3 -m http.server 80
   ```
4. Add an **A record** in Namecheap DNS: `yourdomain.xyz` → your EC2's IP
5. Wait 5 mins, open `yourdomain.xyz` in browser — it works

That one exercise makes DNS click better than any tutorial.

---

## Stage 2 — HTTPS (1 day)

**Goal:** Add SSL to that same server so the browser shows the padlock.

**What you'll learn:**
- What SSL/TLS actually is
- What a certificate is and who issues it
- The difference between Let's Encrypt (manual) and ACM (AWS-managed)

**Practical exercise:**
1. Install **Nginx** on your EC2 as a reverse proxy in front of your Python server
2. Use **Certbot** (Let's Encrypt) to get a free SSL cert
3. Nginx handles HTTPS on port 443, forwards to Python on port 80

This gives you working HTTPS without touching AWS at all — pure Linux config.
Once you've done this manually, ACM + CloudFront will make sense because it
automates exactly what you just did by hand.

---

## Stage 3 — CloudFront Basics (1-2 days)

**Goal:** Put CloudFront in front of that same EC2 and understand what it adds.

**What you'll learn:**
- What a CDN edge node is
- How CloudFront distributions work
- Caching vs pass-through behaviors
- How ACM certificates attach to CloudFront

**Practical exercise:**
1. Create a CloudFront distribution pointing at your EC2
2. Add `cdn.yourdomain.xyz` as alternate domain
3. Add ACM cert (must be in us-east-1 — this is a common gotcha)
4. Add CNAME in Namecheap pointing `cdn.yourdomain.xyz` → CloudFront domain
5. Hit the domain — now served through CloudFront

---

## Stage 4 — S3 as a Static Host (1 day)

**Goal:** Host a simple HTML file on S3 + CloudFront instead of EC2.

**What you'll learn:**
- S3 bucket policies
- Origin Access Control (OAC) — how CloudFront reads from a private S3 bucket
- Why static frontend hosting on S3 is better than EC2

**Practical exercise:**
1. Create S3 bucket, upload a single `index.html`
2. Create CloudFront distribution pointing at S3 (with OAC)
3. Add `app.yourdomain.xyz` as alternate domain
4. Works — no server needed at all

---

## Stage 5 — Deploy the Real App (1 day)

By this point you understand every piece. The actual deployment is just applying
everything above together:

- S3 for React build → (Stage 4)
- S3 for images/assets → (Stage 4)
- EC2 for FastAPI backend → (Stage 1 + 2, but with FastAPI instead of http.server)
- CloudFront for all three → (Stage 3)
- DNS with three subdomains → (Stage 1)

**The three subdomains:**
```
app.univicoustic.com  →  CloudFront  →  S3 (React build)
api.univicoustic.com  →  CloudFront  →  EC2 (FastAPI)
cdn.univicoustic.com  →  CloudFront  →  S3 (images)
```

---

## Time Estimate

| Stage | Topic | Time |
|---|---|---|
| 1 | Domains + DNS | 1-2 days |
| 2 | HTTPS + Nginx | 1 day |
| 3 | CloudFront | 1-2 days |
| 4 | S3 hosting | 1 day |
| 5 | Deploy real app | 1 day |

**Total: ~1 week** at a few hours per day.

---

## Practice Project

A FastAPI app with a single endpoint:
```python
@app.get("/")
def root():
    return {"hello": "world"}
```

Dead simple — nothing to debug in the code. All attention goes to the infrastructure.
That's the point.

---

## Key Gotchas to Remember

| Gotcha | Detail |
|---|---|
| ACM cert region | Must always be created in `us-east-1`, regardless of where EC2/S3 lives |
| EC2 Elastic IP | Assign one immediately — prevents IP changing on restart |
| S3 must be private | Use OAC, never make bucket public |
| EC2 security group | Port 8000 source = CloudFront prefix list only, not 0.0.0.0/0 |
| systemd service | Set up so uvicorn restarts on EC2 reboot |
| CloudFront API cache | Set TTL=0 on /api/* behavior — never cache API responses |
| index.html invalidation | Run `aws cloudfront create-invalidation --paths "/index.html"` after every frontend deploy |
