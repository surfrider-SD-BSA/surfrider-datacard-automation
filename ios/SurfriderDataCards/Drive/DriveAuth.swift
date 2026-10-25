//
//  Signing into Google, for as long as the app is running and no longer.
//
//  PKCE, against an iOS OAuth client, through ASWebAuthenticationSession. Three
//  choices here are deliberate and each of them is a thing this could have done
//  more cheaply:
//
//  NO CLIENT SECRET, because an iOS client does not have one. A secret shipped
//  inside an app is not a secret -- anyone can pull it out of the bundle -- and
//  a repository that publishes its build to the open web has no business
//  pretending otherwise. PKCE is what replaces it: a random verifier is made
//  per sign-in, its SHA-256 goes to Google with the authorisation request, and
//  the verifier itself is only revealed when the code is exchanged. A code
//  intercepted on the way back is worth nothing without it.
//
//  A REFRESH TOKEN, IN THE KEYCHAIN, AND THAT IS A REVERSAL. This asked for no
//  refresh token at first, on the argument that one is "standing access to
//  somebody's Drive sitting on a phone that goes to a beach". The argument was
//  not wrong, it was answering the wrong question: the web tool it was copied
//  from runs on a chapter laptop that several volunteers share, and this runs
//  on one person's phone, behind that person's own passcode. Making them sign
//  into Google at every cleanup bought nothing on a personal device and cost a
//  passkey prompt each time, so it was asked for and it is here.
//
//  What that costs, stated rather than glossed: this app can now reach the
//  files it was given until the grant is revoked, without anybody present.
//  Three things bound it. The scope is still `drive.file`, so "the files it was
//  given" means the ones somebody picked and nothing else. The refresh token is
//  in the Keychain with `WhenUnlockedThisDeviceOnly`, so it is not in a backup
//  and does not travel to another device. And **Sign out of Google** deletes
//  it, which is the control that has to exist for a reversal like this to be
//  fair -- the access token was always memory-only and still is.
//
//  ASWebAuthenticationSession rather than a WKWebView is not a style preference
//  -- Google refuses OAuth in an embedded web view (its "disallowed_useragent"
//  policy), and it is also the reason the volunteer can see the address bar and
//  check they are typing their password into accounts.google.com.
//

import AuthenticationServices
import CryptoKit
import Foundation

@MainActor
final class DriveAuth: NSObject, ObservableObject {

    /// The one scope this app asks for.
    ///
    /// `drive.file` grants access to the individual files a person picks and to
    /// NOTHING else in their Drive: it cannot enumerate a folder and cannot
    /// open a file nobody chose. `drive.readonly` would be fewer moving parts
    /// and would also hand a beach-cleanup transcription tool the ability to
    /// read a volunteer's entire Drive, which is not a reasonable thing to ask
    /// somebody to click Allow on. The web tool refuses that trade in
    /// src/lib/drive.ts and this refuses it for the same reason.
    static let scope = "https://www.googleapis.com/auth/drive.file"

    /// Treat a token as spent a minute early, so a slow download on a beach
    /// connection cannot straddle the expiry. Same margin as the web tool.
    private static let expiryMargin: TimeInterval = 60

    private var token: (value: String, expiresAt: Date)?
    private var session: ASWebAuthenticationSession?

    /// Whether somebody is signed in right now. Drives the "Sign out of Google"
    /// control, which exists for the same reason the web tool's does.
    @Published private(set) var isSignedIn = false

    // MARK: -

    /// A usable access token, asking Google only if there is not one already.
    func accessToken(for config: DriveConfig) async throws -> String {
        if let token, Date() < token.expiresAt - Self.expiryMargin {
            return token.value
        }
        self.token = nil

        // The quiet path, and the reason signing in once is enough: a stored
        // refresh token mints a new access token with nothing on screen. A
        // refusal here is not an error to show -- a revoked or expired grant
        // just means asking properly again -- so it falls through.
        if let refresh = Keychain.read(Self.refreshKey) {
            if let granted = try? await exchangeRefresh(refresh, config: config) {
                token = granted
                isSignedIn = true
                return granted.value
            }
            Keychain.delete(Self.refreshKey)
        }

        isSignedIn = false
        let verifier = Self.codeVerifier()
        let code = try await authorize(config: config, verifier: verifier)
        let granted = try await exchange(code: code, verifier: verifier, config: config)

        token = granted
        isSignedIn = true
        return granted.value
    }

    /// Whether a grant is stored, so the button can say "Sign out of Google"
    /// before anything has been opened this run.
    var hasStoredGrant: Bool { Keychain.read(Self.refreshKey) != nil }

    func signOut() {
        token = nil
        isSignedIn = false
        // The whole grant, not just this run's token. Anything less would make
        // the button a lie.
        Keychain.delete(Self.refreshKey)
    }

    private static let refreshKey = "drive.refresh-token"

    // MARK: - The consent screen

    private func authorize(config: DriveConfig, verifier: String) async throws -> String {
        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        let state = Self.randomString(32)
        components.queryItems = [
            .init(name: "client_id", value: config.clientId),
            .init(name: "redirect_uri", value: config.redirectURI),
            .init(name: "response_type", value: "code"),
            .init(name: "scope", value: Self.scope),
            .init(name: "code_challenge", value: Self.challenge(for: verifier)),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state),
            // Offline access is what makes the grant outlive the process. The
            // consent prompt is forced with it, because Google returns a
            // refresh token only on a consent the person actually saw -- a
            // silent re-approval yields none, and the app would then ask again
            // at every launch while looking like it should not have to.
            .init(name: "access_type", value: "offline"),
            .init(name: "prompt", value: "consent"),
        ]
        guard let url = components.url else { throw DriveError.malformedRequest }

        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: config.callbackScheme
            ) { callback, error in
                if let callback {
                    continuation.resume(returning: callback)
                } else if let error = error as? ASWebAuthenticationSessionError,
                          error.code == .canceledLogin {
                    continuation.resume(throwing: DriveError.cancelled)
                } else {
                    continuation.resume(throwing: error ?? DriveError.cancelled)
                }
            }
            session.presentationContextProvider = self
            // Not ephemeral. An ephemeral session would make a volunteer type a
            // Google password on a phone keyboard at every cleanup; this is
            // somebody's own phone, and the thing actually worth not persisting
            // is the token, which is handled above. On a shared laptop the web
            // tool is the right front end and it makes the stricter choice.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session

            if !session.start() {
                continuation.resume(throwing: DriveError.cannotPresent)
            }
        }

        return try Self.code(from: callback, expecting: state)
    }

    /// Pull the authorisation code out of the redirect, refusing anything that
    /// does not match the request that was sent.
    ///
    /// The state check is not ceremony: without it this would accept a code
    /// from a request it never made.
    private static func code(from callback: URL, expecting state: String) throws -> String {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? {
            items.first { $0.name == name }?.value
        }

        // Google reports a refusal in the redirect rather than by failing it --
        // `error=access_denied` is what closing the consent screen looks like.
        if let error = value("error") {
            throw error == "access_denied" ? DriveError.cancelled : DriveError.refused(error)
        }
        guard value("state") == state else { throw DriveError.stateMismatch }
        guard let code = value("code") else { throw DriveError.noCode }
        return code
    }

    // MARK: - The exchange

    private func exchange(
        code: String,
        verifier: String,
        config: DriveConfig
    ) async throws -> (value: String, expiresAt: Date) {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        var form = URLComponents()
        form.queryItems = [
            .init(name: "client_id", value: config.clientId),
            .init(name: "code", value: code),
            .init(name: "code_verifier", value: verifier),
            .init(name: "grant_type", value: "authorization_code"),
            .init(name: "redirect_uri", value: config.redirectURI),
        ]
        request.httpBody = form.percentEncodedQuery?.data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw DriveError.tokenExchangeFailed(Self.googleError(in: data))
        }

        struct Granted: Decodable {
            let access_token: String
            let expires_in: Double
            let refresh_token: String?
        }
        guard let granted = try? JSONDecoder().decode(Granted.self, from: data) else {
            throw DriveError.tokenExchangeFailed(nil)
        }
        if let refresh = granted.refresh_token {
            Keychain.write(refresh, key: Self.refreshKey)
        }
        return (granted.access_token, Date().addingTimeInterval(granted.expires_in))
    }

    /// Trade the stored grant for a new access token, with nothing on screen.
    private func exchangeRefresh(
        _ refresh: String,
        config: DriveConfig
    ) async throws -> (value: String, expiresAt: Date) {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        var form = URLComponents()
        form.queryItems = [
            .init(name: "client_id", value: config.clientId),
            .init(name: "refresh_token", value: refresh),
            .init(name: "grant_type", value: "refresh_token"),
        ]
        request.httpBody = form.percentEncodedQuery?.data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw DriveError.tokenExchangeFailed(Self.googleError(in: data))
        }

        struct Granted: Decodable {
            let access_token: String
            let expires_in: Double
        }
        guard let granted = try? JSONDecoder().decode(Granted.self, from: data) else {
            throw DriveError.tokenExchangeFailed(nil)
        }
        return (granted.access_token, Date().addingTimeInterval(granted.expires_in))
    }

    /// Google's own description of what went wrong, when it sent one. Better in
    /// front of a volunteer than a status code.
    private static func googleError(in data: Data) -> String? {
        struct Failure: Decodable { let error_description: String?; let error: String? }
        let failure = try? JSONDecoder().decode(Failure.self, from: data)
        return failure?.error_description ?? failure?.error
    }

    // MARK: - PKCE

    private static func codeVerifier() -> String { randomString(64) }

    private static func challenge(for verifier: String) -> String {
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return base64URL(Data(digest))
    }

    private static func randomString(_ bytes: Int) -> String {
        var raw = [UInt8](repeating: 0, count: bytes)
        // A verifier guessable from the clock would defeat the point of PKCE.
        guard SecRandomCopyBytes(kSecRandomDefault, bytes, &raw) == errSecSuccess else {
            return UUID().uuidString + UUID().uuidString
        }
        return base64URL(Data(raw))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

// MARK: -

extension DriveAuth: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
            let window = scenes
                .first { $0.activationState == .foregroundActive }?
                .keyWindow ?? scenes.first?.keyWindow
            return window ?? ASPresentationAnchor()
        }
    }
}


// MARK: -

/// The smallest Keychain that will hold one string.
///
/// `ThisDeviceOnly` on purpose: the grant this protects is for one phone and
/// has no business restoring onto a new one out of a backup. `WhenUnlocked`
/// because nothing here runs in the background.
private enum Keychain {

    static func read(_ key: String) -> String? {
        var query = base(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ value: String, key: String) {
        // Deleted first rather than updated: an add over an existing item fails
        // with a duplicate, and the update path is a second set of attributes
        // to keep in step for no benefit.
        delete(key)
        var query = base(key)
        query[kSecValueData as String] = Data(value.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    static func delete(_ key: String) {
        SecItemDelete(base(key) as CFDictionary)
    }

    private static func base(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Bundle.main.bundleIdentifier ?? "datacards",
            kSecAttrAccount as String: key,
        ]
    }
}
