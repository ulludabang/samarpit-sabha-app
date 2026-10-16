## SAMARPIT IRANIWADI - Sabha & Bhulku Register

A responsive, high-performance web application for tracking children (Bhulku) directory, sabha attendance, and event schedules. Built with a modern, zero-cost cloud architecture using **Vercel**, **Supabase (PostgreSQL)**, and **Google OAuth 2.0**.

---

## ✨ Features

- **Google OAuth Authentication**: Secure one-click Google Sign-In for karyakars / teachers.
- **Cloud Database (Supabase PostgreSQL)**: 100% Free tier cloud database with Row Level Security (RLS).
- **Multi-Device Real-Time Sync**: Changes to attendance or records made on one phone/laptop reflect on all other screens instantly.
- **Offline & Local Fallback**: Seamless local storage cache ensures the app remains usable even during spotty hall WiFi/mobile data.
- **Warm Cultural Aesthetic**: Crafted with Gujarati/Sanskrit nomenclature (*Bhulku*, *Sabha*, *Vakta*), mobile-first layout, and dark mode support.
- **Zero Cost Forever**: Deployed on Vercel's global CDN and Supabase's free tier ($0/month).

---

## 📁 Project Structure

```
samarpit-sabha-app/
├── index.html            # Main application entry point & semantic markup
├── styles.css            # Responsive styles, theme variables, dark mode & components
├── app.js                # Core logic, Supabase sync, OAuth handlers, attendance logic
├── config.js             # Credentials config (Supabase URL & Anon Key)
├── schema.sql            # PostgreSQL schema, RLS policies & real-time publication
├── vercel.json           # Vercel deployment & security header configuration
├── .gitignore            # Git ignore file
├── DEPLOYMENT_GUIDE.md   # Step-by-step setup guide for Supabase, Google OAuth & Vercel
└── README.md             # Project overview
```

---

## 🚀 Quick Local Preview

You can preview the app right away using :
 https://samarpit-sabha-app.vercel.app/

in your web browser.

---

## 🛠️ Deployment

See [`DEPLOYMENT_GUIDE.md`](file:///C:/Users/ayush/.gemini/antigravity/scratch/samarpit-sabha-app/DEPLOYMENT_GUIDE.md) for full instructions on setting up Supabase, Google OAuth credentials, and deploying to Vercel in less than 5 minutes.
