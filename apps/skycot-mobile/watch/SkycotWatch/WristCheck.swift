// "Only while the Watch is unlocked and on the wrist" (decision 4, the Apple Pay standard).
//
// What watchOS lets an app check (watchOS 9 and later): the LocalAuthentication policy
// `deviceOwnerAuthenticationWithWristDetection`. watchOS itself decides: it succeeds straight
// away when Wrist Detection is on, the passcode was entered since the Watch went on, and it has
// stayed on the wrist ever since. Otherwise it asks for the Watch's passcode on the Watch. An app
// can't read the Wrist Detection switch or the wrist sensor directly, and never sees the passcode.
//
// So a yes or a no from SKYCOT on the Watch happens only after this check passes, and the key
// that signs a yes only works while the Watch is unlocked (WatchKey.swift). When the check
// can't run (no passcode on the Watch, or watchOS says it isn't available), SKYCOT doesn't
// guess: it says "Answer on your iPhone".
import Foundation
import LocalAuthentication

enum WristOutcome: Equatable {
  case confirmed
  case cancelled
  /// Not sure it's the owner on the wrist: answer on the iPhone instead (with the parent code).
  case openOnIPhone(String)
}

enum WristCheck {
  static let noPasscode =
    "To answer on your Watch, it needs a passcode and Wrist Detection on. You can answer on your iPhone."

  static func confirm(reason: String) async -> WristOutcome {
    #if targetEnvironment(simulator)
      // A Simulator has no wrist and no passcode. Real Watches always run the check below.
      return .confirmed
    #else
      let context = LAContext()
      var error: NSError?
      guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithWristDetection, error: &error)
      else {
        return .openOnIPhone(noPasscode)
      }
      do {
        let passed = try await context.evaluatePolicy(
          .deviceOwnerAuthenticationWithWristDetection, localizedReason: reason)
        return passed ? .confirmed : .openOnIPhone(noPasscode)
      } catch let failure as LAError {
        switch failure.code {
        case .userCancel, .appCancel, .systemCancel: return .cancelled
        default:
          return .openOnIPhone("Your Watch couldn't confirm it's you. You can answer on your iPhone.")
        }
      } catch {
        return .openOnIPhone("Your Watch couldn't confirm it's you. You can answer on your iPhone.")
      }
    #endif
  }

  /// Shown under the buttons in Simulator builds only, so screenshots never mislead.
  static var simulatorNote: String? {
    #if targetEnvironment(simulator)
      return "Simulator: the wrist check is skipped here. A real Watch checks every time."
    #else
      return nil
    #endif
  }
}
