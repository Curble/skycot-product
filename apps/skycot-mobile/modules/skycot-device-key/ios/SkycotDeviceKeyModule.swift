// SKYCOT's Face ID key on a grown-up's iPhone (Curble Pty Ltd). The phone's own way to say yes
// to a child's "Ask a grown-up" request, built the way the Watch's key is (WatchKey.swift):
//
// - A P-256 signing key made in this iPhone's Secure Enclave. The private key never leaves it,
//   not even for SKYCOT. Its access control is `privateKeyUsage` + `biometryCurrentSet`: every
//   signature needs Face ID (or Touch ID) at that moment, there is no passcode way round it, and
//   iOS makes the key useless for good if the enrolled faces or fingers change.
// - Its encrypted handle (CryptoKit's `dataRepresentation`, usable only by this Secure Enclave)
//   is kept in the keychain "when passcode set, this device only": never in a backup, never on
//   another device, gone if the passcode is turned off.
// - The Mac keeps only the public half. For each yes it gives a one-use challenge for that one
//   request, and this module signs the four lines of `deviceKeySignedMessage` in
//   packages/skycot-rules/src/people.ts, built here from the parts so JavaScript can only ask for
//   a SKYCOT message, never for an arbitrary signature.
//
// Errors are plain codes JavaScript turns into words and the parent-code fallback:
// "cancelled", "fallback", "unavailable", "locked-out", "no-key", "key-invalid", "failed".
import CryptoKit
import ExpoModulesCore
import Foundation
import LocalAuthentication
import Security

struct SignRequest: Record {
  @Field var purpose: String = ""
  @Field var challenge: String = ""
  @Field var action: String = ""
}

private enum DeviceKeyFailure: Error {
  case code(String, String)
}

private enum DeviceKeyStore {
  static let service = "com.skycot.app.device-key"
  static let account = "approver-key"

  static var accessible: CFString { kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly }

  static func accessControl() throws -> SecAccessControl {
    var error: Unmanaged<CFError>?
    guard
      let access = SecAccessControlCreateWithFlags(
        nil, accessible, [.privateKeyUsage, .biometryCurrentSet], &error)
    else { throw DeviceKeyFailure.code("unavailable", "This iPhone can't make a Face ID key.") }
    return access
  }

  static func blob() -> Data? {
    var found: CFTypeRef?
    let status = SecItemCopyMatching(
      [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: service,
        kSecAttrAccount: account,
        kSecReturnData: true,
      ] as CFDictionary, &found)
    return status == errSecSuccess ? found as? Data : nil
  }

  static func save(_ blob: Data) throws {
    delete()
    let status = SecItemAdd(
      [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: service,
        kSecAttrAccount: account,
        kSecAttrAccessible: accessible,
        kSecAttrSynchronizable: false,
        kSecValueData: blob,
      ] as CFDictionary, nil)
    if status == errSecDecode || status == errSecNotAvailable {
      throw DeviceKeyFailure.code("unavailable", "Turn on a passcode for this iPhone first.")
    }
    guard status == errSecSuccess else {
      throw DeviceKeyFailure.code("failed", "This iPhone couldn't keep its Face ID key.")
    }
  }

  static func delete() {
    SecItemDelete(
      [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account]
        as CFDictionary)
  }
}

/// The four lines the Mac checks: `deviceKeySignedMessage` in packages/skycot-rules/src/people.ts.
func deviceKeySignedMessage(purpose: String, challenge: String, action: String) -> String {
  ["SKYCOT Device Key v1", purpose, challenge, action].joined(separator: "\n")
}

private extension Data {
  var base64URL: String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}

private func biometryName(_ type: LABiometryType) -> String {
  switch type {
  case .faceID: return "face-id"
  case .touchID: return "touch-id"
  case .opticID: return "optic-id"
  default: return "none"
  }
}

/// What a LocalAuthentication error means for the grown-up: cancelled, the parent code instead,
/// or Face ID not usable now.
private func failure(from error: Error?) -> DeviceKeyFailure {
  guard let error = error as? LAError else {
    return .code("failed", "Face ID didn't confirm that.")
  }
  switch error.code {
  case .userCancel, .appCancel, .systemCancel:
    return .code("cancelled", "Face ID was cancelled.")
  case .userFallback:
    return .code("fallback", "Use the parent code instead.")
  case .biometryNotAvailable, .biometryNotEnrolled, .passcodeNotSet:
    return .code("unavailable", "Face ID isn't available on this iPhone right now.")
  case .biometryLockout:
    return .code(
      "locked-out", "Face ID is locked after too many tries. Unlock your iPhone with its passcode.")
  default:
    return .code("failed", "Face ID didn't confirm that.")
  }
}

public final class SkycotDeviceKeyModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SkycotDeviceKey")

    /// Whether this device can have a Face ID key, which check it uses, and whether it has one.
    Function("status") { () -> [String: Any] in
      let context = LAContext()
      var error: NSError?
      let can = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
      return [
        "available": can && SecureEnclave.isAvailable,
        "biometry": biometryName(context.biometryType),
        "hasKey": DeviceKeyStore.blob() != nil,
      ]
    }

    /// A new key (replacing any old one) and, after one Face ID check, its signatures over the
    /// Macs' registration challenges, which prove to each Mac that this key is real and works.
    AsyncFunction("create") { (reason: String, requests: [SignRequest], promise: Promise) in
      guard SecureEnclave.isAvailable else {
        promise.reject("unavailable", "This iPhone has no Secure Enclave for a Face ID key.")
        return
      }
      let probe = LAContext()
      var probeError: NSError?
      guard probe.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &probeError)
      else {
        let failed = failure(from: probeError)
        if case .code(let code, let message) = failed { promise.reject(code, message) }
        return
      }
      let biometry = biometryName(probe.biometryType)
      do {
        let key = try SecureEnclave.P256.Signing.PrivateKey(
          accessControl: try DeviceKeyStore.accessControl())
        try DeviceKeyStore.save(key.dataRepresentation)
        let publicKey = key.publicKey.derRepresentation.base64URL
        Self.signAll(reason: reason, requests: requests) { result in
          switch result {
          case .success(let signatures):
            promise.resolve([
              "publicKey": publicKey,
              "biometry": biometry,
              "signatures": signatures,
            ])
          case .failure(.code(let code, let message)):
            // Not set up after all: no half-made key is left behind.
            DeviceKeyStore.delete()
            promise.reject(code, message)
          }
        }
      } catch DeviceKeyFailure.code(let code, let message) {
        DeviceKeyStore.delete()
        promise.reject(code, message)
      } catch {
        DeviceKeyStore.delete()
        promise.reject("unavailable", "This iPhone couldn't make a Face ID key.")
      }
    }

    /// One Face ID check, then a signature over each challenge (one per Mac answer, normally one).
    AsyncFunction("sign") { (reason: String, requests: [SignRequest], promise: Promise) in
      Self.signAll(reason: reason, requests: requests) { result in
        switch result {
        case .success(let signatures): promise.resolve(signatures)
        case .failure(.code(let code, let message)): promise.reject(code, message)
        }
      }
    }

    /// "Stop using Face ID": the key's handle goes, so the key can never sign again.
    Function("remove") {
      DeviceKeyStore.delete()
    }
  }

  private static func signAll(
    reason: String,
    requests: [SignRequest],
    done: @escaping (Result<[String], DeviceKeyFailure>) -> Void
  ) {
    guard !requests.isEmpty,
      requests.allSatisfy({ $0.purpose == "register" || $0.purpose == "approve" })
    else {
      done(.failure(.code("failed", "There was nothing to sign.")))
      return
    }
    // Only SKYCOT's own message, built here from its parts.
    let messages: [Data] = requests.map { request in
      Data(
        deviceKeySignedMessage(
          purpose: request.purpose, challenge: request.challenge, action: request.action
        ).utf8)
    }
    guard let blob = DeviceKeyStore.blob() else {
      done(.failure(.code("no-key", "Face ID isn't set up on this iPhone.")))
      return
    }
    let access: SecAccessControl
    do {
      access = try DeviceKeyStore.accessControl()
    } catch {
      done(.failure(.code("unavailable", "Face ID isn't available on this iPhone right now.")))
      return
    }
    let context = LAContext()
    context.localizedReason = reason
    context.localizedCancelTitle = "Cancel"
    // The button after a missed try: the parent code, never the iPhone's passcode.
    context.localizedFallbackTitle = "Use parent code"
    context.evaluateAccessControl(access, operation: .useKeySign, localizedReason: reason) {
      success, error in
      guard success else {
        done(.failure(failure(from: error)))
        return
      }
      do {
        // The context Face ID just opened: the Secure Enclave signs without asking again.
        let key = try SecureEnclave.P256.Signing.PrivateKey(
          dataRepresentation: blob, authenticationContext: context)
        let signatures = try messages.map { message in
          try key.signature(for: message).derRepresentation.base64URL
        }
        context.invalidate()
        done(.success(signatures))
      } catch {
        context.invalidate()
        // Face ID passed but the key refused: the enrolled faces changed, or the key is gone.
        done(
          .failure(
            .code(
              "key-invalid",
              "Face ID on this iPhone changed, so its old key no longer works. Set Face ID up again in This device."
            )))
      }
    }
  }
}
