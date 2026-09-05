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
//  NO REFRESH TOKEN. `access_type=offline` is not asked for, so what comes back
//  expires in about an hour and cannot be renewed behind the volunteer's back.
//  A refresh token is standing access to somebody's Drive sitting on a phone
//  that goes to a beach.
//
//  NO KEYCHAIN, NO FILE. The token lives in a property on this object for as
//  long as the process does. Quitting the app ends the grant. This mirrors the
//  web tool holding it in a module variable for the life of the tab, and for
//  the same reason: a token in storage outlives the reason it was granted.
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
        isSignedIn = false

        let verifier = Self.codeVerifier()
        let code = try await authorize(config: config, verifier: verifier)
        let granted = try await exchange(code: code, verifier: verifier, config: config)

        token = granted
        isSignedIn = true
        return granted.value
    }

    func signOut() {
        token = nil
        isSignedIn = false
    }

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
