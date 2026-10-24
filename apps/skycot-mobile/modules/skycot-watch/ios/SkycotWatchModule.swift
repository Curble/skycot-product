// SKYCOT on a grown-up's Apple Watch, the iPhone side (Curble Pty Ltd). Three jobs:
//
// 1. WatchConnectivity with the SKYCOT Watch app. The phone is the grown-up's linked device and
//    holds the only sign-in to the Mac; the Watch has none. The phone sends the Watch a small
//    snapshot (application context) and answers the Watch's messages through JavaScript, which
//    talks to the Mac with the phone's own sign-in (src/watch/WatchBridge.tsx).
// 2. The "Ava needs a grown-up" notification with Allow once and Decline. Content-free: a name
//    and "needs a grown-up", never what the request is. Allow once opens SKYCOT (on the phone,
//    or on the Watch for a notification the Watch shows), so the grown-up sees what they allow.
//
// 3. Apple's push token for SKYCOT Relay's notifications ("SKYCOT needs a grown-up", "Sam has
//    finished"), shown by iOS when SKYCOT is closed and forwarded to a paired Watch. The relay's
//    pushes are content-free: a "needs a grown-up" push carries the same category (so the same
//    Allow once and Decline) but no request, so the app fetches what is waiting from the Mac.
//
// Messages and answers that arrive before JavaScript is listening (the phone woken in the
// background by the Watch, or by a notification answer) are kept here until it is.
import ExpoModulesCore
import UserNotifications
import WatchConnectivity

let skycotRequestCategory = "SKYCOT_REQUEST"
let skycotAllowAction = "ALLOW_ONCE"
let skycotDeclineAction = "DECLINE"
/// The relay's `thread-id` for a "needs a grown-up" push (infra/skycot-relay/src/push.ts).
let skycotPushedRequestThread = "needs-grown-up"

final class SkycotWatchHub: NSObject, WCSessionDelegate, UNUserNotificationCenterDelegate, @unchecked Sendable {
  static let shared = SkycotWatchHub()

  weak var module: SkycotWatchModule?
  private var started = false
  private var listening = false
  private var queuedMessages: [[String: Any]] = []
  private var queuedAnswers: [[String: Any]] = []
  private var replies: [String: ([String: Any]) -> Void] = [:]
  private var answerDone: [String: () -> Void] = [:]
  private var lastContext: String?

  func start() {
    DispatchQueue.main.async {
      guard !self.started else { return }
      self.started = true
      if WCSession.isSupported() {
        WCSession.default.delegate = self
        WCSession.default.activate()
      }
      let center = UNUserNotificationCenter.current()
      center.delegate = self
      let allow = UNNotificationAction(
        identifier: skycotAllowAction, title: "Allow once",
        options: [.foreground, .authenticationRequired])
      let decline = UNNotificationAction(
        identifier: skycotDeclineAction, title: "Decline",
        options: [.destructive, .authenticationRequired])
      center.setNotificationCategories([
        UNNotificationCategory(
          identifier: skycotRequestCategory, actions: [allow, decline], intentIdentifiers: [],
          hiddenPreviewsBodyPlaceholder: "Someone needs a grown-up",
          options: [])
      ])
    }
  }

  // MARK: JavaScript side

  func startListening() {
    DispatchQueue.main.async {
      self.listening = true
      for message in self.queuedMessages { self.module?.sendEvent("onWatchMessage", message) }
      for answer in self.queuedAnswers { self.module?.sendEvent("onNotificationAnswer", answer) }
      self.queuedMessages.removeAll()
      self.queuedAnswers.removeAll()
      self.module?.sendEvent("onWatchState", self.state())
    }
  }

  func stopListening() {
    DispatchQueue.main.async { self.listening = false }
  }

  func state() -> [String: Any] {
    guard WCSession.isSupported() else {
      return ["supported": false, "paired": false, "installed": false, "reachable": false]
    }
    let session = WCSession.default
    let active = session.activationState == .activated
    return [
      "supported": true,
      "paired": active && session.isPaired,
      "installed": active && session.isWatchAppInstalled,
      "reachable": active && session.isReachable,
    ]
  }

  func reply(id: String, json: String) {
    DispatchQueue.main.async {
      self.replies.removeValue(forKey: id)?(["json": json])
    }
  }

  func updateContext(json: String) throws {
    guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
    guard WCSession.default.isPaired, WCSession.default.isWatchAppInstalled else { return }
    if json == lastContext { return }
    try WCSession.default.updateApplicationContext(["snapshot": json])
    lastContext = json
  }

  func send(json: String, promise: Promise) {
    guard WCSession.isSupported(), WCSession.default.activationState == .activated,
      WCSession.default.isReachable
    else {
      promise.reject("WatchNotReachable", "Open SKYCOT on your Apple Watch, then try again.")
      return
    }
    WCSession.default.sendMessage(
      ["json": json],
      replyHandler: { answer in promise.resolve(answer["json"] as? String ?? "{}") },
      errorHandler: { error in
        promise.reject("WatchNotReachable", "The Watch didn't answer: \(error.localizedDescription)")
      })
  }

  func finishAnswer(id: String) {
    DispatchQueue.main.async { self.answerDone.removeValue(forKey: id)?() }
  }

  private func emit(_ event: String, _ body: [String: Any]) {
    DispatchQueue.main.async {
      if self.listening, let module = self.module {
        module.sendEvent(event, body)
      } else if event == "onWatchMessage" {
        self.queuedMessages.append(body)
      } else if event == "onNotificationAnswer" {
        self.queuedAnswers.append(body)
      }
    }
  }

  // MARK: WCSessionDelegate

  func session(
    _ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    emit("onWatchState", state())
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    // A different Watch was paired: start again with that one.
    session.activate()
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    lastContext = nil
    emit("onWatchState", state())
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    emit("onWatchState", state())
  }

  func session(
    _ session: WCSession, didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    let id = UUID().uuidString
    DispatchQueue.main.async {
      self.replies[id] = replyHandler
      // A reply must come back while the Watch is still waiting.
      DispatchQueue.main.asyncAfter(deadline: .now() + 25) {
        self.replies.removeValue(forKey: id)?([
          "json": "{\"ok\":false,\"sentence\":\"Your iPhone didn't answer in time. Try again.\"}"
        ])
      }
    }
    emit("onWatchMessage", ["id": id, "json": message["json"] as? String ?? "{}"])
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    // A no queued by the Watch while the phone was out of reach: answered when it arrives.
    emit("onWatchMessage", ["id": "", "json": userInfo["json"] as? String ?? "{}"])
  }

  // MARK: UNUserNotificationCenterDelegate

  func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    // Shown while SKYCOT is open too, without a sound.
    completionHandler([.banner, .list])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let content = response.notification.request.content
    // A local notification names its request; a push from the relay names none (requestKey "":
    // JavaScript asks the Mac what is waiting, and a yes still needs the card and Face ID, the
    // parent code or the Watch key, exactly as on the Requests screen).
    let pushed = content.threadIdentifier == skycotPushedRequestThread
    guard content.categoryIdentifier == skycotRequestCategory || pushed else {
      completionHandler()
      return
    }
    let key = content.userInfo["requestKey"] as? String ?? ""
    let action: String
    switch response.actionIdentifier {
    case skycotAllowAction: action = "allow"
    case skycotDeclineAction: action = "decline"
    default: action = "open"
    }
    let id = UUID().uuidString
    DispatchQueue.main.async {
      self.answerDone[id] = completionHandler
      // iOS gives a background answer about 30 seconds; JavaScript says when it's done.
      DispatchQueue.main.asyncAfter(deadline: .now() + 25) {
        self.answerDone.removeValue(forKey: id)?()
      }
    }
    emit("onNotificationAnswer", ["id": id, "action": action, "requestKey": key])
  }
}

/// Apple's push token for this app, for SKYCOT Relay (src/push in JavaScript hands it over).
final class SkycotPushHub: @unchecked Sendable {
  static let shared = SkycotPushHub()

  private var waiting: [Promise] = []
  private var latest: [String: String]?

  /// Asks iOS for the token (no prompt: showing alerts is the separate notification permission).
  /// iOS answers through the app delegate below, at every launch, with the current token.
  func register(promise: Promise) {
    DispatchQueue.main.async {
      self.waiting.append(promise)
      UIApplication.shared.registerForRemoteNotifications()
      DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
        guard !self.waiting.isEmpty else { return }
        let late = self.waiting
        self.waiting.removeAll()
        if let latest = self.latest {
          for promise in late { promise.resolve(latest) }
        } else {
          for promise in late { promise.reject("PushUnavailable", "iOS didn't give a push token.") }
        }
      }
    }
  }

  func registered(deviceToken: Data) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    let answer = ["token": token, "environment": Self.environment()]
    DispatchQueue.main.async {
      self.latest = answer
      let ready = self.waiting
      self.waiting.removeAll()
      for promise in ready { promise.resolve(answer) }
    }
  }

  func failed(error: Error) {
    DispatchQueue.main.async {
      let ready = self.waiting
      self.waiting.removeAll()
      for promise in ready { promise.reject("PushUnavailable", error.localizedDescription) }
    }
  }

  /// Which of Apple's push services issued the token. App Store and TestFlight builds carry no
  /// provisioning profile and always use production; a build signed with a profile (Xcode's
  /// development builds, ad hoc) says which in the profile's own aps-environment.
  static func environment() -> String {
    #if targetEnvironment(simulator)
      return "development"
    #else
      guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
        let data = try? Data(contentsOf: url),
        let text = String(data: data, encoding: .isoLatin1),
        let start = text.range(of: "<?xml"),
        let end = text.range(of: "</plist>"),
        let xml = String(text[start.lowerBound..<end.upperBound]).data(using: .isoLatin1),
        let profile = try? PropertyListSerialization.propertyList(from: xml, format: nil)
          as? [String: Any],
        let entitlements = profile["Entitlements"] as? [String: Any]
      else { return "production" }
      return entitlements["aps-environment"] as? String == "development"
        ? "development" : "production"
    #endif
  }
}

public final class SkycotWatchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SkycotWatch")
    Events("onWatchMessage", "onWatchState", "onNotificationAnswer")

    OnCreate {
      SkycotWatchHub.shared.module = self
      SkycotWatchHub.shared.start()
    }

    OnStartObserving {
      SkycotWatchHub.shared.startListening()
    }

    OnStopObserving {
      SkycotWatchHub.shared.stopListening()
    }

    Function("state") { () -> [String: Any] in
      SkycotWatchHub.shared.state()
    }

    Function("updateContext") { (json: String) in
      try SkycotWatchHub.shared.updateContext(json: json)
    }

    Function("reply") { (id: String, json: String) in
      SkycotWatchHub.shared.reply(id: id, json: json)
    }

    AsyncFunction("sendToWatch") { (json: String, promise: Promise) in
      SkycotWatchHub.shared.send(json: json, promise: promise)
    }

    Function("finishNotificationAnswer") { (id: String) in
      SkycotWatchHub.shared.finishAnswer(id: id)
    }

    AsyncFunction("requestNotifications") { (promise: Promise) in
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge]) {
        granted, _ in promise.resolve(granted)
      }
    }

    /// Apple's push token for this app and which push service it is for:
    /// `{ token, environment: "production" | "development" }`.
    AsyncFunction("registerForPush") { (promise: Promise) in
      SkycotPushHub.shared.register(promise: promise)
    }

    /// "Ava needs a grown-up", now, on this phone (and on the Watch when iOS forwards it).
    AsyncFunction("notifyRequest") { (requestKey: String, title: String, promise: Promise) in
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = "Open SKYCOT to see what it is, then say yes once or no."
      content.categoryIdentifier = skycotRequestCategory
      content.threadIdentifier = "skycot-requests"
      content.userInfo = ["requestKey": requestKey]
      let request = UNNotificationRequest(identifier: requestKey, content: content, trigger: nil)
      UNUserNotificationCenter.current().add(request) { error in
        if let error { promise.reject("NotifyFailed", error.localizedDescription) } else {
          promise.resolve(nil)
        }
      }
    }

    /// The request was answered (here, on the Watch or on the Mac): its notification goes.
    Function("clearRequest") { (requestKey: String) in
      let center = UNUserNotificationCenter.current()
      center.removeDeliveredNotifications(withIdentifiers: [requestKey])
      center.removePendingNotificationRequests(withIdentifiers: [requestKey])
    }
  }
}

/// Starts WatchConnectivity and the notification answers at launch, before JavaScript runs, so
/// a Watch message or an answer that launched the app in the background is not lost; and takes
/// iOS's answer to `registerForRemoteNotifications` (the push token).
public final class SkycotWatchAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    SkycotWatchHub.shared.start()
    return true
  }

  public func application(
    _ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    SkycotPushHub.shared.registered(deviceToken: deviceToken)
  }

  public func application(
    _ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    SkycotPushHub.shared.failed(error: error)
  }
}
