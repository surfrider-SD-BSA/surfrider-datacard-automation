/**
 * Pick a scanned PDF out of the chapter's shared Google Drive folder.
 *
 * The scans arrive in Drive already -- somebody walks the ScanSnap output into
 * a shared folder after the cleanup -- so the person doing the data entry was
 * downloading a file to their laptop only in order to drag it back into this
 * page. This removes that round trip: the picker opens on the shared folder,
 * they choose the scan, and the bytes go straight from Drive into the tab.
 *
 * WHAT THIS COSTS, stated plainly because the rest of the tool is built on not
 * paying it: every other path through this app has no account, no API key and
 * no third party. This one has all three. The trade is deliberate and it is
 * narrow, so the parts of the promise that survive are worth being exact about:
 *
 *   - The scan still is not uploaded. It is DOWNLOADED, from a folder that
 *     already holds it, into the page. Nothing about a card ever travels
 *     outward, and no server of ours sees a byte -- there still is no server
 *     of ours.
 *   - Google learns that this account opened this file, which it would have
 *     learned from the same person downloading it by hand.
 *   - The scope asked for is `drive.file`, which is the narrowest scope that
 *     can do this at all: it grants access to the individual files the user
 *     picks in the picker, and to nothing else in the Drive. This app cannot
 *     enumerate the folder, cannot read a file nobody chose, and loses the
 *     access when the tab closes. `drive.readonly` would have been fewer lines
 *     -- it would also have handed a beach-cleanup transcription tool the
 *     ability to read the volunteer's entire Drive, which is not a reasonable
 *     thing to ask somebody to click Allow on.
 *   - The access token is held in a module-local variable for as long as the
 *     tab lives and is never written to storage. There is no refresh token and
 *     no persistent grant; a reload asks Google again.
 *
 * The whole feature is optional and off unless configured. With no client ID
 * in the environment `driveConfig()` returns null, no button is drawn, no
 * Google script is fetched, and the page behaves exactly as it did before --
 * which is what a fork of this repository, or a build for a chapter that keeps
 * its scans on a USB stick, should get by default.
 *
 * Setup is in docs/google-drive.md.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DriveConfig {
  /** OAuth 2.0 Web client ID. Public by design; not a secret. */
  clientId: string;
  /** API key for the Picker, restricted by HTTP referrer. Also public. */
  apiKey: string;
  /**
   * The shared folder the picker opens on, or null to open on the whole Drive.
   *
   * This is a convenience, not a boundary. The picker will happily let someone
   * navigate out of a parent folder, and the file they end up choosing is the
   * file this app is granted. Restricting what a volunteer may open is Drive's
   * job, done by sharing the folder and nothing else with them; this setting
   * only saves them the navigation.
   */
  folderId: string | null;
  /**
   * Cloud project NUMBER, if the scans live on a shared drive.
   *
   * The picker needs it to hand a shared-drive file to an app holding
   * `drive.file`; on a personal My Drive it is unnecessary. Supplying it is
   * harmless either way, so the setup doc just tells people to set it.
   */
  appId: string | null;
  /** Whether to show shared drives in the picker. */
  enableSharedDrives: boolean;
}

/**
 * Read the Drive settings out of the build environment, or null if this build
 * was made without them.
 *
 * Both IDs are compiled into the bundle by Vite and are visible to anyone who
 * opens the page. That is how browser OAuth works and is not a leak: a client
 * ID identifies the app, and the API key is constrained by the referrer
 * allowlist on it. Neither can be used to read anything without a user sitting
 * in front of the consent screen. Nothing that would be a secret belongs here.
 */
export function driveConfig(): DriveConfig | null {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY?.trim();
  if (!clientId || !apiKey) return null;

  return {
    clientId,
    apiKey,
    folderId: parseFolderId(import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID),
    appId: import.meta.env.VITE_GOOGLE_APP_ID?.trim() || null,
    enableSharedDrives: import.meta.env.VITE_GOOGLE_SHARED_DRIVES === "true",
  };
}

/**
 * Accept either a folder ID or the URL of the folder, because the thing a
 * person actually has is the URL.
 *
 * Setting this up means someone opens the shared folder in Drive and copies
 * something out of the address bar. Asking them to then find the ID inside
 * `https://drive.google.com/drive/folders/1a2b3c?usp=sharing` is asking them
 * to get it wrong, and getting it wrong produces a picker that opens on an
 * empty folder with no explanation. Both forms are taken.
 */
export function parseFolderId(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;

  // .../folders/<id>, with or without a query string on the end.
  const inPath = value.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (inPath) return inPath[1]!;

  // ...?id=<id>, the older sharing form.
  const inQuery = value.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (inQuery) return inQuery[1]!;

  // A bare ID. Anything with a slash or a space in it is neither that nor a
  // URL we recognise, and is better refused than turned into a picker that
  // silently opens somewhere else.
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

// ---------------------------------------------------------------------------
// The two Google scripts
// ---------------------------------------------------------------------------

const GIS_SRC = "https://accounts.google.com/gsi/client";
const GAPI_SRC = "https://apis.google.com/js/api.js";

const SCOPE = "https://www.googleapis.com/auth/drive.file";

/**
 * Minimal shapes for the two globals, written out rather than pulled in as
 * `@types/google.picker` and `@types/gapi`.
 *
 * `npm run build` typechecks, so these cannot be `any`, and a dependency on
 * two DefinitelyTyped packages to describe the six calls below is not worth
 * the supply chain. What is used is what is declared; anything else being
 * missing is the point.
 */
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
  callback: (response: TokenResponse) => void;
}

interface PickerDoc {
  id: string;
  name: string;
  mimeType?: string;
  sizeBytes?: string | number;
}

interface PickerData {
  action: string;
  docs?: PickerDoc[];
}

interface DocsView {
  setMimeTypes(types: string): DocsView;
  setParent(id: string): DocsView;
  setIncludeFolders(on: boolean): DocsView;
  setSelectFolderEnabled(on: boolean): DocsView;
  setEnableDrives(on: boolean): DocsView;
  setOwnedByMe(on: boolean): DocsView;
}

interface PickerBuilder {
  addView(view: DocsView): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(cb: (data: PickerData) => void): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  build(): { setVisible(visible: boolean): void; dispose?(): void };
}

interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient(options: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type?: string; message?: string }) => void;
      }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
  picker: {
    DocsView: new (viewId?: string) => DocsView;
    PickerBuilder: new () => PickerBuilder;
    ViewId: { DOCS: string };
    Action: { PICKED: string; CANCEL: string };
    Response: { ACTION: string; DOCUMENTS: string };
    Feature: { SUPPORT_DRIVES: string };
  };
}

interface GapiGlobal {
  load(component: string, callback: () => void): void;
}

function googleGlobal(): GoogleGlobal | undefined {
  return (window as unknown as { google?: GoogleGlobal }).google;
}

function gapiGlobal(): GapiGlobal | undefined {
  return (window as unknown as { gapi?: GapiGlobal }).gapi;
}

/** Load a script once, and hand every later caller the same promise. */
const scripts = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const existing = scripts.get(src);
  if (existing) return existing;

  const pending = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      // Let a later attempt try again -- this is usually a network blip or a
      // blocked domain on a chapter laptop, not a permanent state.
      scripts.delete(src);
      reject(new Error(`Could not load ${src}. Check the network connection.`));
    };
    document.head.appendChild(el);
  });

  scripts.set(src, pending);
  return pending;
}

/**
 * Fetch both Google scripts.
 *
 * Called on the upload screen as soon as it is drawn, not on the click. The
 * token request opens a popup, and a popup opened several awaits after the
 * click that caused it is what a browser's blocker is looking for. Having the
 * scripts already in place by the time somebody presses the button keeps the
 * gap between gesture and popup down to the resolved-promise microtask that
 * `prepareDrive` awaits.
 */
export async function prepareDrive(): Promise<void> {
  await Promise.all([
    loadScript(GIS_SRC),
    loadScript(GAPI_SRC).then(
      () =>
        new Promise<void>((resolve, reject) => {
          const gapi = gapiGlobal();
          if (!gapi) return reject(new Error("Google's picker script loaded but defined nothing."));
          gapi.load("picker", () => resolve());
        }),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// The access token
// ---------------------------------------------------------------------------

/**
 * The token, in memory, for this tab only.
 *
 * Never in localStorage or a cookie. A token in storage outlives the reason it
 * was granted and turns "I opened one scan on the chapter laptop" into standing
 * access for whoever sits down next; keeping it here means closing the tab ends
 * it. The cost is one extra consent click per session, which is the right way
 * round for a shared machine.
 */
let token: { value: string; expiresAt: number } | null = null;
let tokenClient: TokenClient | null = null;

/**
 * The reject side of the request in flight, so the two ways Google can refuse
 * both end the same promise.
 *
 * `initTokenClient` takes `callback` and `error_callback` at construction, and
 * only `callback` can be swapped afterwards -- so the error path cannot be
 * closed over per request the way the success path is, and has to reach the
 * pending promise through here.
 *
 * Leaving this out is not a cosmetic bug. A blocked popup, or a consent window
 * the volunteer closes, arrives ONLY on `error_callback`: the success callback
 * is never called, so a promise that ignores the error path never settles, the
 * button stays disabled reading "Waiting for Google…", and the only way out is
 * reloading the page. Both of those are ordinary things that happen on a
 * chapter laptop, and both were doing exactly that until this was added.
 */
let pendingReject: ((err: Error) => void) | null = null;

/** Treat a token as spent a minute early, so a slow download cannot straddle. */
const EXPIRY_MARGIN_MS = 60_000;

function cachedToken(): string | null {
  if (!token) return null;
  if (Date.now() >= token.expiresAt - EXPIRY_MARGIN_MS) {
    token = null;
    return null;
  }
  return token.value;
}

function requestToken(config: DriveConfig): Promise<string> {
  const google = googleGlobal();
  if (!google) throw new Error("Google's sign-in script is not loaded yet.");

  return new Promise<string>((resolve, reject) => {
    const fail = (err: Error) => {
      pendingReject = null;
      reject(err);
    };
    pendingReject = fail;

    // One client per tab. `initTokenClient` registers a callback that the
    // library replaces on each request, so the client is reusable and building
    // a second one just leaks the first.
    tokenClient ??= google.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope: SCOPE,
      callback: () => {}, // Replaced per request, below.
      error_callback: (error) => {
        // `popup_closed` is somebody changing their mind, `popup_failed_to_open`
        // is a blocker. Neither is a fault worth a stack trace at a volunteer,
        // and both have a next step.
        const message =
          error.type === "popup_closed"
            ? "The Google sign-in window was closed, so no file was opened."
            : error.type === "popup_failed_to_open"
              ? "The browser blocked Google's sign-in window. Allow pop-ups for this page and try again."
              : `Google sign-in did not complete${error.message ? `: ${error.message}` : "."}`;
        pendingReject?.(new Error(message));
      },
    });

    tokenClient.callback = (response) => {
      if (response.error || !response.access_token) {
        return fail(
          new Error(
            response.error === "access_denied"
              ? "Google access was declined, so the folder cannot be opened."
              : `Google sign-in failed: ${response.error_description ?? response.error ?? "no token"}`,
          ),
        );
      }
      pendingReject = null;
      token = {
        value: response.access_token,
        expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000,
      };
      resolve(response.access_token);
    };

    // `prompt: ""` lets Google skip the consent screen when this browser has
    // already granted the scope, which is what makes the second scan of an
    // afternoon a single click.
    tokenClient.requestAccessToken({ prompt: "" });
  });
}

/**
 * Drop the token and tell Google to forget the grant.
 *
 * Offered on the review screen so somebody finishing up on a borrowed laptop
 * has a way to end the access that does not depend on them thinking to close
 * the tab.
 */
export function signOutOfDrive(): void {
  const current = token?.value;
  token = null;
  if (current) googleGlobal()?.accounts.oauth2.revoke(current);
}

/** Whether this tab currently holds a usable Drive token. */
export function isSignedInToDrive(): boolean {
  return cachedToken() !== null;
}

// ---------------------------------------------------------------------------
// Picking and fetching
// ---------------------------------------------------------------------------

export interface PickedFile {
  id: string;
  name: string;
  /** Bytes, when Drive reported a size. Used only for the progress bar. */
  size: number | null;
}

/**
 * Open the picker on the shared folder and resolve with what was chosen, or
 * null if the person closed it without choosing.
 */
function openPicker(config: DriveConfig, accessToken: string): Promise<PickedFile | null> {
  const google = googleGlobal();
  if (!google?.picker) throw new Error("Google's picker is not loaded yet.");

  return new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes("application/pdf")
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    // Open on the shared folder when there is one. Without this the picker
    // starts on "Recent", which for the person doing data entry is a list of
    // everything except the scans.
    if (config.folderId) view.setParent(config.folderId);
    if (config.enableSharedDrives) view.setEnableDrives(true);

    const builder = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(config.apiKey)
      .setTitle("Choose a scanned card set")
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const doc = data.docs?.[0];
          if (!doc) return resolve(null);
          const size = Number(doc.sizeBytes);
          resolve({ id: doc.id, name: doc.name, size: Number.isFinite(size) ? size : null });
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      });

    // Both of these are what lets a `drive.file` app reach a file that lives on
    // a shared drive rather than in somebody's My Drive.
    if (config.appId) builder.setAppId(config.appId);
    if (config.enableSharedDrives) builder.enableFeature(google.picker.Feature.SUPPORT_DRIVES);

    builder.build().setVisible(true);
  });
}

/**
 * Download a picked file into a `File`, reporting progress as it goes.
 *
 * A `File` rather than the bytes because that is what `rasterizePdf` takes, and
 * because the rest of the app -- the draft fingerprint, the filename date
 * seeding, the header -- is written against a name and a size. A file that came
 * from Drive is then indistinguishable downstream from one that was dragged in,
 * which is the property worth having: there is one processing path, and it is
 * the one that has been measured on a 116-page scan.
 */
async function downloadFile(
  file: PickedFile,
  accessToken: string,
  onProgress?: (fraction: number) => void,
): Promise<File> {
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}` +
    `?alt=media&supportsAllDrives=true`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

  if (!res.ok) {
    // 403 here is nearly always the scope, and the message a volunteer gets
    // should say what to do rather than quote a status code at them.
    const detail = res.status === 403 || res.status === 404
      ? "Drive would not hand over that file. It may not be shared with this Google account."
      : `Drive returned ${res.status}.`;
    throw new Error(`Could not download “${file.name}”. ${detail}`);
  }

  // Stream it, so a 300MB scan on a chapter's DSL line shows a moving bar
  // rather than a frozen page. Falls back to `blob()` where the body cannot be
  // read as a stream, in which case there is simply no progress to report.
  const total = file.size ?? Number(res.headers.get("content-length")) ?? 0;
  const reader = res.body?.getReader();

  let blob: Blob;
  if (reader && total > 0) {
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress?.(Math.min(received / total, 1));
    }
    blob = new Blob(chunks as BlobPart[], { type: "application/pdf" });
  } else {
    blob = await res.blob();
    onProgress?.(1);
  }

  return new File([blob], file.name, { type: "application/pdf" });
}

/**
 * The whole flow: consent if needed, pick, download.
 *
 * Resolves with null when the person closed the picker without choosing, which
 * is an ordinary thing to do and not an error.
 */
export async function chooseFileFromDrive(
  config: DriveConfig,
  onProgress?: (fraction: number) => void,
): Promise<File | null> {
  await prepareDrive();

  const accessToken = cachedToken() ?? (await requestToken(config));
  const picked = await openPicker(config, accessToken);
  if (!picked) return null;

  return downloadFile(picked, accessToken, onProgress);
}
