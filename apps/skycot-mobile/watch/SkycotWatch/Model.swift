// What the SKYCOT iPhone app sends its Watch, and what the Watch sends back: the same shapes as
// apps/skycot-mobile/src/watch/protocol.ts (WATCH_PROTOCOL 1), as JSON text.
import Foundation

let watchProtocol = 1

// nondev-seam: skycot-watch-project-approval-model
struct WatchRequest: Codable, Identifiable, Hashable {
  let id: String
  let macId: String
  let threadId: String
  let requestId: String
  let fingerprint: String
  let projectFingerprint: String?
  let projectSentence: String?
  let projectCovers: [String]?
  let projectTitle: String?
  let goal: String?
  let childName: String
  let childInitial: String
  let childColour: String
  let title: String
  let heading: String
  // nondev-seam: skycot-watch-request-sentence-model
  let sentence: String
  let what: String
  let why: String?
  let macName: String?
  let createdAt: Double
  let lapsed: Bool
  let watchCanSayYes: Bool
}

/// A family note: "Ava asked for more time" or "Ava made something". Never what they made.
struct WatchNote: Codable, Identifiable, Hashable {
  let id: String
  let macId: String
  let noteId: String
  /// "more-time" or "shown".
  let kind: String
  let childName: String
  let childInitial: String
  let childColour: String
  let title: String
  let sentence: String
  let macName: String?
  let createdAt: Double
}

struct WatchChild: Codable, Identifiable, Hashable {
  let id: String
  let macId: String
  let name: String
  let initial: String
  let colour: String
  let time: String
  let messages: String
  let bedtime: String?
  let asleep: Bool
}

struct WatchSnapshot: Codable, Equatable {
  let `protocol`: Int
  let at: Double
  /// "ready", "not-linked" or "child-device".
  let state: String
  let grownUpName: String
  let requests: [WatchRequest]
  /// Added after protocol 1 shipped: a snapshot from an older iPhone has none.
  let notes: [WatchNote]?
  let children: [WatchChild]
  let watchSetUp: Bool
  let lockedAt: Double?
  let reachable: Bool
}

/// The phone's reply to any message. Which fields are set depends on the message.
struct PhoneReply: Decodable {
  let ok: Bool
  let sentence: String?
  let snapshot: WatchSnapshot?
  let challenge: String?
  let action: String?
  let keyId: String?
}

struct Proof: Encodable {
  let keyId: String
  let challenge: String
  let signature: String
}

enum WatchMessage: Encodable {
  case hello
  case lock
  case challenge(WatchRequest, scope: String?)
  case answer(WatchRequest, decision: String, proof: Proof?, scope: String?)
  /// "Not tonight" to a note asking for more time. No proof, and no minutes: the Watch can't
  /// give more time (the Mac needs the parent code, on the iPhone).
  case noteNotTonight(WatchNote)

  private enum Keys: String, CodingKey {
    case type, macId, threadId, requestId, fingerprint, decision, proof, noteId, scope
  }

  func encode(to encoder: Encoder) throws {
    var out = encoder.container(keyedBy: Keys.self)
    switch self {
    case .hello:
      try out.encode("hello", forKey: .type)
    case .lock:
      try out.encode("lock", forKey: .type)
    case .challenge(let request, let scope):
      try out.encode("challenge", forKey: .type)
      try out.encode(request.macId, forKey: .macId)
      try out.encode(request.threadId, forKey: .threadId)
      try out.encode(request.requestId, forKey: .requestId)
      try out.encode(scope == "project" ? request.projectFingerprint ?? request.fingerprint : request.fingerprint, forKey: .fingerprint)
      try out.encodeIfPresent(scope, forKey: .scope)
    case .answer(let request, let decision, let proof, let scope):
      try out.encode("answer", forKey: .type)
      try out.encode(request.macId, forKey: .macId)
      try out.encode(request.threadId, forKey: .threadId)
      try out.encode(request.requestId, forKey: .requestId)
      try out.encode(scope == "project" ? request.projectFingerprint ?? request.fingerprint : request.fingerprint, forKey: .fingerprint)
      try out.encode(decision, forKey: .decision)
      try out.encodeIfPresent(proof, forKey: .proof)
      try out.encodeIfPresent(scope, forKey: .scope)
    case .noteNotTonight(let note):
      try out.encode("noteNotTonight", forKey: .type)
      try out.encode(note.macId, forKey: .macId)
      try out.encode(note.noteId, forKey: .noteId)
    }
  }
}

/// The phone asks the Watch to make its key ("Say yes from my Watch", on the iPhone).
struct EnrolRequest: Decodable {
  let type: String
  let challenge: String
  let action: String
}

struct EnrolReply: Encodable {
  let publicKey: String
  let signature: String
  let protection: String
  let name: String
}

extension Data {
  var base64URL: String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
