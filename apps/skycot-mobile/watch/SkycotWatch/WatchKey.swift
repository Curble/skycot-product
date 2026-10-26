// The Watch's own key for saying yes (Phase 4, decision 4). Made on this Watch, kept on this
// Watch: in the Secure Enclave where the Watch has one, so the private key can't be read out,
// even by SKYCOT. The Mac keeps only the public half, on the grown-up's phone's record.
//
// The key works only while this Watch is unlocked: it is stored "when passcode set, this device
// only", so watchOS refuses it while the Watch is locked (including after it comes off the
// wrist, when Wrist Detection is on), deletes it if the passcode is turned off, and never puts it
// in a backup or on another device.
import CryptoKit
import Foundation
import Security

enum WatchKeyError: Error {
  case noPasscode
  case keychain(OSStatus)
  case broken
}

/// What the Watch signs: the same four lines as `watchSignedMessage` in
/// packages/skycot-rules/src/people.ts.
func watchSignedMessage(purpose: String, challenge: String, action: String) -> String {
  ["SKYCOT Watch v1", purpose, challenge, action].joined(separator: "\n")
}

/// The Mac's fingerprint of a card: the first 24 hex characters of SHA-256 over the request's
/// thread, id, what and why (fingerprintFor in SkycotFamilyDevices.ts). The Watch checks it
/// against the card it shows, so it never signs a yes for words it didn't show.
// nondev-seam: skycot-watch-project-approval-fingerprint
func cardFingerprint(
  threadId: String, requestId: String, what: String, why: String?, scope: String = "once",
  covers: [String] = []) -> String {
  var lines = [threadId, requestId, what, why ?? ""]
  if scope == "project" { lines += ["project"] + covers.sorted() }
  let material = lines.joined(separator: "\n")
  let digest = SHA256.hash(data: Data(material.utf8))
  return String(digest.map { String(format: "%02x", $0) }.joined().prefix(24))
}

enum WatchKey {
  private static let service = "com.skycot.watch"
  private static let account = "approver-key"

  enum Protection: String {
    case secureEnclave = "secure-enclave"
    case keychain
    case simulator
  }

  private enum Stored {
    case enclave(SecureEnclave.P256.Signing.PrivateKey)
    case software(P256.Signing.PrivateKey)

    var publicKey: P256.Signing.PublicKey {
      switch self {
      case .enclave(let key): return key.publicKey
      case .software(let key): return key.publicKey
      }
    }

    func sign(_ data: Data) throws -> P256.Signing.ECDSASignature {
      switch self {
      case .enclave(let key): return try key.signature(for: data)
      case .software(let key): return try key.signature(for: data)
      }
    }
  }

  static var protection: Protection {
    #if targetEnvironment(simulator)
      return .simulator
    #else
      return SecureEnclave.isAvailable ? .secureEnclave : .keychain
    #endif
  }

  private static var accessible: CFString {
    #if targetEnvironment(simulator)
      // A Simulator has no passcode; on a real Watch the stricter class below is used.
      return kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    #else
      return kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
    #endif
  }

  /// A new key, replacing any old one (setting the Watch up again).
  static func make() throws -> (publicKey: String, protection: Protection) {
    delete()
    let blob: Data
    switch protection {
    case .secureEnclave:
      var error: Unmanaged<CFError>?
      guard
        let access = SecAccessControlCreateWithFlags(
          nil, accessible, .privateKeyUsage, &error)
      else { throw WatchKeyError.broken }
      let key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access)
      blob = key.dataRepresentation
    case .keychain, .simulator:
      blob = P256.Signing.PrivateKey().rawRepresentation
    }
    let status = SecItemAdd(
      [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: service,
        kSecAttrAccount: account,
        kSecAttrAccessible: accessible,
        kSecAttrSynchronizable: false,
        kSecValueData: blob,
      ] as CFDictionary, nil)
    if status == errSecDecode || status == errSecNotAvailable { throw WatchKeyError.noPasscode }
    guard status == errSecSuccess else { throw WatchKeyError.keychain(status) }
    return (try load().publicKey.derRepresentation.base64URL, protection)
  }

  static func sign(_ message: String) throws -> String {
    try load().sign(Data(message.utf8)).derRepresentation.base64URL
  }

  static func delete() {
    SecItemDelete(
      [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account]
        as CFDictionary)
  }

  private static func load() throws -> Stored {
    var found: CFTypeRef?
    let status = SecItemCopyMatching(
      [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: service,
        kSecAttrAccount: account,
        kSecReturnData: true,
      ] as CFDictionary, &found)
    // errSecInteractionNotAllowed: the Watch is locked. The key is not there to use.
    guard status == errSecSuccess, let blob = found as? Data else {
      throw WatchKeyError.keychain(status)
    }
    if protection == .secureEnclave {
      return .enclave(try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob))
    }
    return .software(try P256.Signing.PrivateKey(rawRepresentation: blob))
  }
}
