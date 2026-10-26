// The Watch's only way to SKYCOT: its paired iPhone, over Apple's WatchConnectivity. The Watch
// has no link to the Mac, no sign-in and no secret but its own signing key. The phone sends a
// small snapshot (requests, each child's day, the lock) and carries the Watch's answers to the
// Mac with the phone's own sign-in, exactly as the phone's own buttons do.
import Foundation
import WatchConnectivity

enum PhoneError: Error {
  case unreachable
  case refused(String)
}

@MainActor
final class PhoneLink: NSObject, ObservableObject {
  static let shared = PhoneLink()

  @Published private(set) var snapshot: WatchSnapshot?
  @Published private(set) var reachable = false
  @Published private(set) var activated = false

  private let decoder = JSONDecoder()
  private let encoder = JSONEncoder()

  func start() {
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  /// Asks the phone for a fresh snapshot (opening the app, or pulling to refresh).
  func refresh() async {
    guard let reply = try? await send(.hello), let fresh = reply.snapshot else { return }
    snapshot = fresh
  }

  func send(_ message: WatchMessage) async throws -> PhoneReply {
    guard WCSession.default.activationState == .activated, WCSession.default.isReachable else {
      throw PhoneError.unreachable
    }
    let json = String(decoding: try encoder.encode(message), as: UTF8.self)
    let answer: [String: Any] = try await withCheckedThrowingContinuation { continuation in
      WCSession.default.sendMessage(
        ["json": json],
        replyHandler: { continuation.resume(returning: $0) },
        errorHandler: { _ in continuation.resume(throwing: PhoneError.unreachable) })
    }
    let text = answer["json"] as? String ?? "{}"
    return try decoder.decode(PhoneReply.self, from: Data(text.utf8))
  }

  /// A no that couldn't reach the phone right now: watchOS delivers it when it can.
  func queueDecline(_ request: WatchRequest) {
    // nondev-seam: skycot-watch-project-approval-encoding
    guard let data = try? encoder.encode(WatchMessage.answer(request, decision: "decline", proof: nil, scope: nil))
    else { return }
    WCSession.default.transferUserInfo(["json": String(decoding: data, as: UTF8.self)])
  }

  fileprivate func take(context: [String: Any]) {
    guard let text = context["snapshot"] as? String,
      let fresh = try? decoder.decode(WatchSnapshot.self, from: Data(text.utf8)),
      fresh.protocol == watchProtocol
    else { return }
    if let current = snapshot, current.at > fresh.at { return }
    snapshot = fresh
  }

  fileprivate func setReachable(_ value: Bool, activated: Bool) {
    reachable = value
    self.activated = activated
  }
}

extension PhoneLink: WCSessionDelegate {
  nonisolated func session(
    _ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    let context = session.receivedApplicationContext
    let reachable = session.isReachable
    Task { @MainActor in
      self.setReachable(reachable, activated: activationState == .activated)
      self.take(context: context)
      await self.refresh()
    }
  }

  nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
    let reachable = session.isReachable
    Task { @MainActor in
      self.setReachable(reachable, activated: true)
      if reachable { await self.refresh() }
    }
  }

  nonisolated func session(
    _ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]
  ) {
    Task { @MainActor in self.take(context: applicationContext) }
  }

  /// The phone asks this Watch to make its key ("Say yes from my Watch" on the iPhone).
  nonisolated func session(
    _ session: WCSession, didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    let text = message["json"] as? String ?? "{}"
    Task { @MainActor in
      let reply = await self.enrol(text)
      replyHandler(["json": reply])
    }
  }

  private func enrol(_ text: String) async -> String {
    guard let request = try? decoder.decode(EnrolRequest.self, from: Data(text.utf8)),
      request.type == "enrol", request.action.hasPrefix("watch-register:")
    else { return "{}" }
    // The owner on the wrist, as for every yes.
    guard await WristCheck.confirm(reason: "Let this Watch say yes for SKYCOT") == .confirmed
    else { return "{}" }
    do {
      let made = try WatchKey.make()
      let signature = try WatchKey.sign(
        watchSignedMessage(purpose: "register", challenge: request.challenge, action: request.action))
      let name = "\(snapshot?.grownUpName ?? "Grown-up")'s Apple Watch"
      let reply = EnrolReply(
        publicKey: made.publicKey, signature: signature, protection: made.protection.rawValue,
        name: name)
      return String(decoding: try encoder.encode(reply), as: UTF8.self)
    } catch {
      return "{}"
    }
  }
}
