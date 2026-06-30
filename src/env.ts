export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SESSIONS: KVNamespace;
  ATTACHMENTS: R2Bucket;
  CF_ACCESS_AUD: string;
  CF_TEAM_DOMAIN: string;
  FROM_EMAIL: string;
  APP_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
  GOOGLE_PICKER_API_KEY: string;
  RESIDENT_ROSTER_SHEET_ID: string;
  AUTO_DETAILS_SHEET_ID: string;
}
