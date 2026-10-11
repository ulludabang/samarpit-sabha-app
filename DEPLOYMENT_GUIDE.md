# Complete Step-by-Step Deployment Guide ($0 Cost)

This guide takes you through the exact steps to deploy the **SAMARPIT IRANIWADI** app to **Vercel** with a **Supabase PostgreSQL database** and **Google OAuth authentication**, maintaining a **100% free ($0/month)** infrastructure.

---

## 🏗️ Architecture & Free-Tier Quotas

| Service | Purpose | Free Tier Limit | Cost |
| :--- | :--- | :--- | :--- |
| **Vercel** | Global Edge CDN & Static Hosting | 100 GB Bandwidth, Unlimited Requests | **$0 / month** |
| **Supabase** | PostgreSQL Database + Realtime Sync | 500 MB Database, 50,000 Monthly Active Users | **$0 / month** |
| **Google Cloud** | Google Sign-In (OAuth 2.0) | Unlimited OAuth logins | **$0 / month** |

Total Monthly Infrastructure Cost: **$0.00**

---

## Step 1: Create Free Supabase Project (Database & Auth)

1. Go to [https://supabase.com](https://supabase.com) and click **Sign Up** (or log in with GitHub/Google).
2. Click **New Project**:
   - **Name**: `samarpit-sabha`
   - **Database Password**: Set a secure password and save it somewhere safe.
   - **Region**: Choose the closest region (e.g. `ap-south-1` Mumbai if you are in India).
   - **Pricing Plan**: Select **Free tier ($0)**.
3. Click **Create new project** and wait ~1-2 minutes for the database to provision.

---

## Step 2: Set Up Database Tables & Real-Time Sync

1. In your Supabase dashboard, click **SQL Editor** on the left navigation menu.
2. Click **New query**.
3. Open the [`schema.sql`](file:///C:/Users/ayush/.gemini/antigravity/scratch/samarpit-sabha-app/schema.sql) file included in this project, copy all its contents, paste them into the SQL Editor, and click **Run**.
4. You will see `Success. No rows returned`.
   - This creates the `children`, `sabhas`, and `attendance` tables.
   - Configures Row Level Security (RLS).
   - Enables real-time synchronization so all open devices stay in sync.

---

## Step 3: Enable Google OAuth Authentication

To allow users (karyakars / teachers) to log in with their Google accounts:

### 3.1 Get Supabase Redirect URI
1. In Supabase, navigate to **Authentication** -> **Providers** -> **Google**.
2. Note the **Callback URL (for OAuth)** shown at the top. It looks like:
   `https://<your-project-id>.supabase.co/auth/v1/callback`

### 3.2 Create Google Cloud OAuth Credentials
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., `Samarpit Sabha`).
3. Go to **APIs & Services** -> **OAuth consent screen**:
   - Choose **External**, click **Create**.
   - Fill in **App name** (`Samarpit Sabha`), **User support email**, and **Developer contact email**.
   - Click **Save and Continue** through the remaining steps.
4. Go to **APIs & Services** -> **Credentials**:
   - Click **+ CREATE CREDENTIALS** -> **OAuth client ID**.
   - **Application type**: Web application.
   - **Name**: `Samarpit Sabha Web`.
   - Under **Authorized redirect URIs**, click **ADD URI** and paste the Supabase Callback URL from step 3.1:
     `https://<your-project-id>.supabase.co/auth/v1/callback`
   - Click **Create**.
5. Copy your **Client ID** and **Client Secret**.

### 3.3 Paste Credentials into Supabase
1. Return to your Supabase dashboard -> **Authentication** -> **Providers** -> **Google**.
2. Toggle Google to **Enabled**.
3. Paste the **Client ID** and **Client Secret** from Google Cloud.
4. Click **Save**.

---

## Step 4: Configure Project Credentials

1. In Supabase, go to **Project Settings** (gear icon) -> **API**.
2. Copy:
   - **Project URL** (`https://xxxxxxxx.supabase.co`)
   - **Project API Keys** -> `anon` `public` key.
3. Open [`config.js`](file:///C:/Users/ayush/.gemini/antigravity/scratch/samarpit-sabha-app/config.js) and fill in the values:
   ```javascript
   window.APP_CONFIG = {
     SUPABASE_URL: "https://your-project.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
     AUTH_PROVIDER: "google",
     APP_NAME: "SAMARPIT IRANIWADI",
     APP_SUBTITLE: "Bhulku records, attendance and sabha schedule"
   };
   ```
*(Note: You can also enter these directly in the website by tapping the ⚙️ Settings icon in the header!)*

---

## Step 5: Deploy to Vercel (100% Free)

### Method A: Deploy via GitHub (Recommended for automatic continuous deployment)
1. Initialize a git repository and push this folder to your GitHub account:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of Samarpit Sabha App"
   # Push to your GitHub repo
   ```
2. Go to [https://vercel.com](https://vercel.com) and sign in.
3. Click **Add New...** -> **Project**.
4. Import your GitHub repository.
5. In the project configuration:
   - **Framework Preset**: Other (Static / HTML).
   - **Root Directory**: `./` (leave default).
6. Click **Deploy**. Within 15 seconds, your app will be live with a free `https://your-app.vercel.app` domain and free SSL certificate!

### Method B: Deploy via Vercel CLI (or Drag & Drop)
1. If you have the Vercel CLI installed (`npm i -g vercel`), simply run:
   ```bash
   vercel --prod
   ```
2. Or in the Vercel dashboard, deploy directly by linking your repository.

---

## Step 6: Add Your Vercel Domain to Supabase & Google Console

Once your Vercel deployment URL is live (e.g. `https://samarpit-sabha.vercel.app`):

1. **In Supabase**:
   - Go to **Authentication** -> **URL Configuration**.
   - Under **Site URL**, enter your Vercel URL: `https://samarpit-sabha.vercel.app`.
   - Under **Redirect URLs**, add: `https://samarpit-sabha.vercel.app/**`.
2. **In Google Cloud Console**:
   - Go to **APIs & Services** -> **Credentials** -> Click your OAuth Client ID.
   - Under **Authorized JavaScript origins**, add: `https://samarpit-sabha.vercel.app`.
   - Click **Save**.

Your app is now fully functional, securely synced to a cloud database, authenticated with Google OAuth, and hosted on Vercel at zero cost!
