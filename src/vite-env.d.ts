/// <reference types="vite/client" />

/**
 * The Google Drive picker's settings, and the only environment this app reads.
 *
 * Every one of these is compiled into the bundle and visible to anyone who
 * opens the page -- that is what `VITE_` means, and it is correct for these,
 * which are public identifiers rather than credentials (see src/lib/drive.ts).
 * Nothing that would be a secret may be added here: this project publishes its
 * build to GitHub Pages, so a secret in the environment is a secret on the
 * public internet.
 *
 * All optional. With no client ID and API key the Drive button is not drawn and
 * the page is exactly the browser-only tool it was before.
 */
interface ImportMetaEnv {
  /** OAuth 2.0 Web client ID from the Google Cloud console. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** API key for the Picker, restricted by HTTP referrer. */
  readonly VITE_GOOGLE_API_KEY?: string;
  /** The shared folder the picker opens on -- its ID, or its URL. */
  readonly VITE_GOOGLE_DRIVE_FOLDER_ID?: string;
  /** Cloud project number. Needed only when the scans live on a shared drive. */
  readonly VITE_GOOGLE_APP_ID?: string;
  /** "true" to show shared drives in the picker. */
  readonly VITE_GOOGLE_SHARED_DRIVES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
