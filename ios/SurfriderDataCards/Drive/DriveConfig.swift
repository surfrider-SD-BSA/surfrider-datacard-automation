//
//  Whether this build can open a scan out of the chapter's Drive folder.
//
//  The Swift half of src/lib/drive.ts, and the same bargain stated there. Worth
//  repeating rather than cross-referencing, because this is the one path in the
//  app with a third party in it:
//
//    - The scan is not uploaded. It is DOWNLOADED, from a folder that already
//      holds it, onto the phone, and read by the same `read(pdf:)` a file from
//      the document picker goes through. Nothing about a card travels outward.
//    - Google learns that this account opened this file, which it would have
//      learned from the same volunteer downloading it by hand.
//    - The token lives in memory for as long as the app is running and is never
//      written to the Keychain or to a file. See DriveAuth.
//
//  OFF UNLESS CONFIGURED, and that is load-bearing rather than tidy. With no
//  client ID in the build, `current` is nil, no button is drawn on screen 3,
//  and the app makes no network call of any kind -- which is what a fork of this
//  repository, or a chapter that keeps its scans on a USB stick, gets by
//  default. The app's whole privacy posture rests on that being the default,
//  and it is why every entry point here goes through `current` being non-nil
//  rather than through a flag somebody could forget.
//
//  Setup is in docs/google-drive.md; the iOS-specific parts are in
//  docs/google-drive-ios.md.
//

import Foundation

struct DriveConfig {

    /// OAuth 2.0 client ID for an **iOS** client. Public by design, not a
    /// secret: an iOS client has no client secret at all, which is why the
    /// exchange below is PKCE rather than a secret this repository would have
    /// to keep. See DriveAuth.
    let clientId: String

    /// API key for the Picker, restricted by HTTP referrer to the origin the
    /// picker page is served from. Public, like the client ID: it identifies
    /// the project and is constrained by that referrer list, which is why the
    /// restriction is the part of the setup that actually matters.
    let apiKey: String

    /// The page that hosts Google's Picker.
    ///
    /// The Picker is a JavaScript library with no native counterpart, and it
    /// will only run on an origin registered with Google -- so it is served
    /// from the project's GitHub Pages site and loaded into a web view here.
    /// See DrivePicker for what crosses that boundary, which is a token in and
    /// a file ID out.
    let pickerURL: URL

    /// Cloud project NUMBER, and it is REQUIRED -- not, as this once said,
    /// something that only matters for shared drives.
    ///
    /// `drive.file` grants access to the files somebody picks, and what makes a
    /// picked file *count* as picked by THIS app is the picker naming the app
    /// when it hands the file over. Without the app id the picker still returns
    /// a file id, the download still runs, and Drive answers 403 -- which
    /// surfaces as "Drive would not hand over that file. It may not be shared
    /// with this Google account", a sentence that sends somebody to check
    /// sharing settings that were never the problem.
    ///
    /// Never nil in practice: see `projectNumber(from:)`.
    let appId: String?

    /// Whether to offer shared drives in the picker.
    let enableSharedDrives: Bool

    /// The folder the picker opens on, or nil for the whole Drive.
    ///
    /// A convenience and not a boundary, exactly as on the web: what a
    /// volunteer can reach is what Drive has shared with them, and restricting
    /// that is Drive's job. This only saves them the navigation.
    let folderId: String?

    /// The redirect Google sends the authorisation code back to.
    ///
    /// An iOS OAuth client's redirect is its client ID with the dot-segments
    /// reversed, which is a scheme only this app is registered for. Derived
    /// rather than configured: it is not an independent setting, and a build
    /// where the two disagreed would fail at the consent screen with a message
    /// about a redirect mismatch that names neither of them.
    var redirectURI: String {
        let reversed = clientId
            .split(separator: ".")
            .reversed()
            .joined(separator: ".")
        return "\(reversed):/oauth2redirect"
    }

    /// The scheme half of that, which is what ASWebAuthenticationSession waits
    /// on.
    var callbackScheme: String {
        String(redirectURI.split(separator: ":").first ?? "")
    }

    // MARK: - Reading it out of the build

    /// The configuration this build was made with, or nil if it was made
    /// without one.
    ///
    /// Computed once. The values come from the Info.plist, which takes them
    /// from build settings, so nothing about a chapter's Google project is
    /// committed to this repository -- and a plain `xcodebuild` with no
    /// settings passed produces a build with the feature absent rather than
    /// broken.
    static let current: DriveConfig? = fromBundle()

    static func fromBundle(_ bundle: Bundle = .main) -> DriveConfig? {
        // Both, or nothing. A build with a client ID and no API key would draw
        // the button and fail inside the picker with a message about a
        // developer key, which names neither the setting nor the person who
        // has to fix it. The web tool draws its button on the same condition.
        guard let clientId = string(bundle, "GoogleClientID"),
              let apiKey = string(bundle, "GoogleAPIKey"),
              let pickerURL = URL(string: string(bundle, "GooglePickerURL") ?? defaultPickerURL)
        else { return nil }

        return DriveConfig(
            clientId: clientId,
            apiKey: apiKey,
            pickerURL: pickerURL,
            // Explicit if a build set one, otherwise taken off the client ID.
            appId: string(bundle, "GoogleAppID") ?? projectNumber(from: clientId),
            enableSharedDrives: (bundle.object(forInfoDictionaryKey: "GoogleSharedDrives") as? String) == "true",
            folderId: parseFolderId(string(bundle, "GoogleDriveFolderID"))
        )
    }

    /// Where `docs/ios-picker.html` lands on this project's GitHub Pages site.
    ///
    /// A default rather than a required setting because for this chapter it is
    /// a constant, and one more thing to paste is one more thing to paste
    /// wrong. **A fork must set `GooglePickerURL` to its own copy**: the origin
    /// is half of what the API key restriction checks, so a fork pointing at
    /// this one is a fork whose picker will not load.
    private static let defaultPickerURL =
        "https://surfrider-sd-bsa.github.io/surfrider-datacard-automation/ios-picker.html"

    /// The Cloud project number, read off the front of the client ID.
    ///
    /// A Google client ID is `<project number>-<random>.apps.googleusercontent.com`,
    /// so the number is already in the build and asking anybody to paste it a
    /// second time is asking for two settings that must agree and one day will
    /// not. `GoogleAppID` still overrides this, for a project whose ids do not
    /// follow that shape.
    private static func projectNumber(from clientId: String) -> String? {
        let digits = clientId.prefix { $0.isNumber }
        return digits.isEmpty ? nil : String(digits)
    }

    /// An Info.plist string that is actually set.
    ///
    /// An unset build setting leaves the `$(NAME)` literal behind rather than
    /// removing the key, and that string is not a client ID. Treating it as one
    /// draws the button and then fails at Google with an error about an invalid
    /// client, which is a long way from the actual mistake.
    private static func string(_ bundle: Bundle, _ key: String) -> String? {
        guard let raw = bundle.object(forInfoDictionaryKey: key) as? String else { return nil }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.hasPrefix("$(") else { return nil }
        return value
    }

    /// Accept either a folder ID or the URL of the folder.
    ///
    /// Transcribed from `parseFolderId` in src/lib/drive.ts, for the same
    /// reason it exists there: the thing a person actually has is what they
    /// copied out of the address bar, and asking them to find the ID inside
    /// `https://drive.google.com/drive/folders/1a2b3c?usp=sharing` is asking
    /// them to get it wrong. Getting it wrong produces a picker that opens
    /// somewhere unexpected with no explanation.
    ///
    /// Kept in step with the TypeScript by hand. If the accepted forms change
    /// there, change them here; `DriveConfigTests` covers the same cases the
    /// web's `tests/drive.test.ts` does.
    static func parseFolderId(_ raw: String?) -> String? {
        guard let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }

        // .../folders/<id>, with or without a query string on the end.
        if let id = firstMatch(in: value, pattern: "/folders/([A-Za-z0-9_-]+)") { return id }

        // ...?id=<id>, the older sharing form.
        if let id = firstMatch(in: value, pattern: "[?&]id=([A-Za-z0-9_-]+)") { return id }

        // A bare ID. Anything with a slash or a space in it is neither that nor
        // a URL this recognises, and is better refused than turned into a
        // picker that opens somewhere surprising.
        if firstMatch(in: value, pattern: "^([A-Za-z0-9_-]+)$") != nil { return value }
        return nil
    }

    private static func firstMatch(in value: String, pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)),
              match.numberOfRanges > 1,
              let range = Range(match.range(at: 1), in: value)
        else { return nil }
        return String(value[range])
    }
}
