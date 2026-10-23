// SKYCOT on a grown-up's Apple Watch (Phase 4). Copyright (c) 2026 Curble Pty Ltd, trading as
// SKYCOT. A companion to the SKYCOT iPhone app: it shows the requests waiting for a grown-up,
// each child's time today and bedtime, and "Lock SKYCOT now", and says yes once or no from the
// wrist while the Watch is unlocked and on the wrist. Everything goes through the paired iPhone.
import SwiftUI
import UserNotifications
import WatchKit

/// A request a notification opened, and whether its Decline was chosen.
struct Opened: Equatable, Hashable {
  let key: String
  let decline: Bool
  let at = UUID()
}

/// Where a tap on a notification should land.
@MainActor
final class Router: ObservableObject {
  static let shared = Router()
  @Published var opened: Opened?
}

final class AppDelegate: NSObject, WKApplicationDelegate, UNUserNotificationCenterDelegate {
  func applicationDidFinishLaunching() {
    let center = UNUserNotificationCenter.current()
    center.delegate = self
    // The same category as the iPhone's, so a notification shows the same two buttons here.
    // Both open SKYCOT on the Watch: the card is shown before a yes, and every answer from the
    // Watch runs the wrist check first.
    let allow = UNNotificationAction(
      identifier: "ALLOW_ONCE", title: "Allow once", options: [.foreground, .authenticationRequired])
    let decline = UNNotificationAction(
      identifier: "DECLINE", title: "Decline",
      options: [.foreground, .destructive, .authenticationRequired])
    center.setNotificationCategories([
      UNNotificationCategory(
        identifier: "SKYCOT_REQUEST", actions: [allow, decline], intentIdentifiers: [],
        options: [])
    ])
    Task { @MainActor in PhoneLink.shared.start() }
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .list]
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    let info = response.notification.request.content.userInfo
    guard let key = info["requestKey"] as? String else { return }
    let decline = response.actionIdentifier == "DECLINE"
    await MainActor.run { Router.shared.opened = Opened(key: key, decline: decline) }
  }
}

@main
struct SkycotWatchApp: App {
  @WKApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @StateObject private var phone = PhoneLink.shared
  @StateObject private var router = Router.shared

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(phone)
        .environmentObject(router)
    }
  }
}
