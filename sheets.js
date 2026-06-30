import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

export async function appendLeadToSpreadsheet(profile, draftText) {
  console.log('🌐 Syncing to Google Sheets...');

  try {
    // Load credentials from env (base64-encoded JSON) or fall back to file for local dev
    let credentials;
    if (process.env.GOOGLE_CREDENTIALS_BASE64) {
      credentials = JSON.parse(
        Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString()
      );
    }

    const auth = new google.auth.GoogleAuth({
      ...(credentials ? { credentials } : { keyFile: path.resolve(__dirname, 'google-credentials.json') }),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();

    const sheets = google.sheets({
      version: 'v4',
      auth: authClient,
    });

    const spreadsheetId = process.env.SPREADSHEET_ID;
    if (!spreadsheetId) {
      console.warn('⚠️ [Sheets]: SPREADSHEET_ID not set — skipping sync.');
      return null;
    }

    const timestamp = new Date().toISOString();

    // -------------------------------
    // 1. CHECK DUPLICATES (PHONE)
    // -------------------------------
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Sheet1!D:D", // phone column
    });

    const rows = existing.data.values || [];

    const isDuplicate = rows.some(
      (row) => row[0] === profile.phone
    );

    if (isDuplicate) {
      console.log("⚠️ Duplicate lead detected. Skipping insert.");
      return { skipped: true };
    }

    // -------------------------------
    // 2. APPEND ROW
    // -------------------------------
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1!A:G",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          timestamp,
          profile.name,
          profile.company || "N/A",
          profile.phone,
          profile.query,
          profile.priority,
          draftText,
        ]],
      },
    });

    console.log("✅ Lead inserted successfully.");
    return response;

  } catch (error) {
    console.error("❌ Sheets error:", error);
    return null;
  }
}