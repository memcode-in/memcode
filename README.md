# MemCode dashboard

This is the standalone dashboard application split from `../landing`. It owns:

- `/dashboard`
- `/login`
- `/oauth/authorize`

Set the variables in `.env.example`, deploy this directory as its own Vite app,
and point the landing deployment's `VITE_MEMCODE_DASHBOARD_URL` at its public
origin. The dashboard's `VITE_MEMCODE_LANDING_URL` controls the back-to-home
link.

Before production cutover, add the new dashboard origin to Google OAuth's
authorized JavaScript origins and allow it in the Company Brain API's CORS and
session-cookie configuration.
