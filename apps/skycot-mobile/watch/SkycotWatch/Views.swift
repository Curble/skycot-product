// SKYCOT on Apple Watch: the screens. Standard watchOS patterns (a vertical page for Requests,
// Today and Lock, lists with large rows, a card that scrolls with the Digital Crown, a
// confirmation before locking), SF Symbols, and the iPhone's own words. Australian spelling.
import SwiftUI
import WatchKit

struct RequestRoute: Hashable {
  let key: String
  let decline: Bool
  var allow = false
}

/// Development builds in the Simulator only (no wrist, no one to tap): `-skycotTest <step>` as
/// a launch argument opens a screen and, for `allow-first`, `decline-first` and `lock-confirm`,
/// presses its button through the same code as a tap. Never in an App Store build.
enum SimulatorTest {
  static var step: String? {
    #if DEBUG && targetEnvironment(simulator)
      return UserDefaults.standard.string(forKey: "skycotTest")
    #else
      return nil
    #endif
  }
}

struct RootView: View {
  @EnvironmentObject private var phone: PhoneLink
  @EnvironmentObject private var router: Router
  @State private var path: [RequestRoute] = []
  @State private var page = 0

  var body: some View {
    NavigationStack(path: $path) {
      content
        .navigationDestination(for: RequestRoute.self) { route in
          RequestView(key: route.key, declineNow: route.decline, allowNow: route.allow)
        }
    }
    .task { await phone.refresh() }
    .onChange(of: phone.snapshot?.at) { _, _ in runSimulatorStep() }
    .onChange(of: router.opened) { _, opened in
      guard let opened else { return }
      page = 0
      path = [RequestRoute(key: opened.key, decline: opened.decline)]
      router.opened = nil
    }
  }

  @State private var ranSimulatorStep = false

  private func runSimulatorStep() {
    guard !ranSimulatorStep, let step = SimulatorTest.step, let snapshot = phone.snapshot,
      snapshot.state == "ready"
    else { return }
    switch step {
    case "today": page = 1
    case "lock-ask", "lock-confirm": page = 2
    case "open-first", "open-first-buttons", "allow-first", "decline-first":
      guard let first = snapshot.requests.first else { return }
      path = [
        RequestRoute(
          key: first.id, decline: step == "decline-first", allow: step == "allow-first")
      ]
    default: break
    }
    ranSimulatorStep = true
  }

  @ViewBuilder private var content: some View {
    if let snapshot = phone.snapshot {
      switch snapshot.state {
      case "ready":
        TabView(selection: $page) {
          RequestsPage(snapshot: snapshot).tag(0)
          TodayPage(snapshot: snapshot).tag(1)
          LockPage(snapshot: snapshot).tag(2)
        }
        .tabViewStyle(.verticalPage)
      case "child-device":
        Notice(
          symbol: "figure.and.child.holdinghands", title: "For grown-ups",
          text: "SKYCOT on Apple Watch is for a grown-up's iPhone. A child's work stays on their own device.")
      default:
        Notice(
          symbol: "iphone", title: "Link your iPhone",
          text: "Open SKYCOT on your iPhone and link it at your family's Mac as a grown-up's phone.")
      }
    } else {
      Notice(
        symbol: "iphone.radiowaves.left.and.right", title: "SKYCOT",
        text: phone.reachable
          ? "Asking your iPhone…" : "Open SKYCOT on your iPhone. Your Watch shows what it sees.")
    }
  }
}

// MARK: Requests

struct RequestsPage: View {
  let snapshot: WatchSnapshot
  @EnvironmentObject private var phone: PhoneLink

  var body: some View {
    let waiting = snapshot.requests
    Group {
      if waiting.isEmpty {
        ScrollView {
          VStack(spacing: 8) {
            Image(systemName: "checkmark.shield.fill")
              .font(.system(size: 40))
              .foregroundStyle(.green)
            Text("All quiet").font(.headline)
            Text("Nothing needs you right now.")
              .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            PhoneStatus(snapshot: snapshot)
          }
          .frame(maxWidth: .infinity)
          .padding(.top, 8)
        }
      } else {
        List {
          ForEach(waiting) { request in
            NavigationLink(value: RequestRoute(key: request.id, decline: false)) {
              RequestRow(request: request)
            }
          }
          PhoneStatus(snapshot: snapshot).listRowBackground(Color.clear)
        }
      }
    }
    .navigationTitle("Requests")
  }
}

struct RequestRow: View {
  let request: WatchRequest

  var body: some View {
    HStack(spacing: 10) {
      Avatar(initial: request.childInitial, colour: request.childColour, size: 32)
      VStack(alignment: .leading, spacing: 2) {
        Text(request.title).font(.headline).lineLimit(2)
        Text(request.heading).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
        Text(request.lapsed ? "Waiting on the Mac" : age(request.createdAt))
          .font(.footnote).foregroundStyle(request.lapsed ? .orange : .secondary)
      }
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }
}

/// One request, and Allow once / Decline.
struct RequestView: View {
  let key: String
  let declineNow: Bool
  var allowNow = false
  @EnvironmentObject private var phone: PhoneLink
  @State private var kept: WatchRequest?
  @State private var stage: Stage = .ready
  @State private var startedDecline = false

  enum Stage: Equatable {
    case ready
    case working(String)
    case done(String)
    case problem(String)
    case openOnIPhone(String)
  }

  var body: some View {
    let request = phone.snapshot?.requests.first { $0.id == key } ?? kept
    ScrollViewReader { reader in
      ScrollView {
        if let request {
          card(request)
          Color.clear.frame(height: 1).id("end")
        } else {
          Notice(
            symbol: "hourglass", title: "Just a moment",
            text: "Asking your iPhone for this request…")
        }
      }
      // The answer shows where the buttons were: bring it into view.
      .onChange(of: stage) { _, _ in withAnimation { reader.scrollTo("end", anchor: .bottom) } }
      .task {
        if SimulatorTest.step == "open-first-buttons" {
          try? await Task.sleep(for: .seconds(2))
          reader.scrollTo("end", anchor: .bottom)
        }
      }
    }
    .navigationTitle(request?.childName ?? "Request")
    .onAppear { if kept == nil { kept = request } }
    .onChange(of: request) { _, fresh in if let fresh { kept = fresh } }
    .task(id: request?.id) {
      if request == nil { await phone.refresh() }
      if declineNow, !startedDecline, let request {
        startedDecline = true
        await decline(request)
      } else if allowNow, !startedDecline, let request {
        // The Simulator check's tap on Allow once (SimulatorTest), after the card has shown.
        startedDecline = true
        try? await Task.sleep(for: .seconds(3))
        await allow(request)
      }
    }
  }

  @ViewBuilder private func card(_ request: WatchRequest) -> some View {
    let matches =
      cardFingerprint(
        threadId: request.threadId, requestId: request.requestId, what: request.what,
        why: request.why) == request.fingerprint
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Avatar(initial: request.childInitial, colour: request.childColour, size: 28)
        Text(request.title).font(.headline).fixedSize(horizontal: false, vertical: true)
      }
      Text(request.heading).font(.title3).fontWeight(.semibold)
      if !request.what.isEmpty {
        Text(request.what)
          .font(.system(.footnote, design: .monospaced))
          .padding(8)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.14)))
      }
      if let why = request.why {
        Text(why).font(.footnote).foregroundStyle(.secondary)
      }
      if let mac = request.macName {
        Label(mac, systemImage: "desktopcomputer").font(.footnote).foregroundStyle(.secondary)
      }
      outcome(request, matches: matches)
    }
    .padding(.horizontal, 2)
  }

  @ViewBuilder private func outcome(_ request: WatchRequest, matches: Bool) -> some View {
    switch stage {
    case .working(let words):
      HStack(spacing: 8) {
        ProgressView()
        Text(words).font(.footnote).foregroundStyle(.secondary)
      }
      .padding(.top, 6)
    case .done(let words):
      Label(words, systemImage: "checkmark.circle.fill")
        .font(.headline).foregroundStyle(.green).padding(.top, 6)
    case .openOnIPhone(let words):
      VStack(alignment: .leading, spacing: 4) {
        Label("Answer on your iPhone", systemImage: "iphone").font(.headline)
        Text(words).font(.footnote).foregroundStyle(.secondary)
      }
      .padding(.top, 6)
    case .ready, .problem:
      if case .problem(let words) = stage {
        Label(words, systemImage: "exclamationmark.triangle.fill")
          .font(.footnote).foregroundStyle(.orange)
      }
      if request.lapsed {
        Text("This one is waiting on the Mac now. Answer it there.")
          .font(.footnote).foregroundStyle(.orange).padding(.top, 4)
      } else if !matches {
        Text("This request changed. Have another look on your iPhone.")
          .font(.footnote).foregroundStyle(.orange).padding(.top, 4)
      } else {
        if request.watchCanSayYes {
          Button {
            Task { await allow(request) }
          } label: {
            Label("Allow once", systemImage: "checkmark")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(.borderedProminent)
          .tint(.blue)
          .padding(.top, 6)
        } else {
          Text("To say yes here, set it up on your iPhone: SKYCOT, This device, Apple Watch.")
            .font(.footnote).foregroundStyle(.secondary).padding(.top, 4)
        }
        Button {
          Task { await decline(request) }
        } label: {
          Label("Decline", systemImage: "xmark").frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        if let note = WristCheck.simulatorNote {
          Text(note).font(.caption2).foregroundStyle(.tertiary)
        }
      }
    }
  }

  private func allow(_ request: WatchRequest) async {
    switch await WristCheck.confirm(reason: "Allow \(request.childName)'s request once") {
    case .cancelled: return
    case .openOnIPhone(let words):
      stage = .openOnIPhone(words)
      return
    case .confirmed: break
    }
    stage = .working("Asking your iPhone…")
    do {
      let issued = try await phone.send(.challenge(request))
      guard issued.ok, let challenge = issued.challenge, let action = issued.action,
        let keyId = issued.keyId
      else {
        stage = .problem(issued.sentence ?? "Your iPhone couldn't ask the Mac. Try again.")
        return
      }
      // Sign only the request this card shows, whatever comes back.
      guard
        action == "approve:\(request.threadId):\(request.requestId):\(request.fingerprint)"
      else {
        stage = .problem("That didn't match this request. Have another look on your iPhone.")
        return
      }
      let signature: String
      do {
        signature = try WatchKey.sign(
          watchSignedMessage(purpose: "approve", challenge: challenge, action: action))
      } catch {
        stage = .openOnIPhone(
          "This Watch can't say yes right now. Set it up again on your iPhone, or answer there.")
        return
      }
      let answered = try await phone.send(
        .answer(
          request, decision: "accept",
          proof: Proof(keyId: keyId, challenge: challenge, signature: signature)))
      if answered.ok {
        stage = .done(answered.sentence ?? "Allowed, this once.")
        tap(.success)
      } else {
        stage = .problem(answered.sentence ?? "That didn't work. Try again.")
        tap(.failure)
      }
    } catch {
      stage = .openOnIPhone("Your Watch can't reach your iPhone right now.")
    }
  }

  private func decline(_ request: WatchRequest) async {
    switch await WristCheck.confirm(reason: "Decline \(request.childName)'s request") {
    case .cancelled: return
    case .openOnIPhone(let words):
      stage = .openOnIPhone(words)
      return
    case .confirmed: break
    }
    stage = .working("Declining…")
    do {
      let answered = try await phone.send(.answer(request, decision: "decline", proof: nil))
      if answered.ok {
        stage = .done(answered.sentence ?? "Declined.")
        tap(.success)
      } else {
        stage = .problem(answered.sentence ?? "That didn't work. Try again.")
      }
    } catch {
      phone.queueDecline(request)
      stage = .done("Declined. Your iPhone passes it on when it can.")
    }
  }
}

// MARK: Today

struct TodayPage: View {
  let snapshot: WatchSnapshot

  var body: some View {
    Group {
      if snapshot.children.isEmpty {
        Notice(
          symbol: "figure.2.and.child.holdinghands", title: "No children yet",
          text: "Add a child on the Mac, in Settings, Family.")
      } else {
        List {
          ForEach(snapshot.children) { child in
            VStack(alignment: .leading, spacing: 3) {
              HStack(spacing: 8) {
                Avatar(initial: child.initial, colour: child.colour, size: 26)
                Text(child.name).font(.headline)
                Spacer(minLength: 0)
                if child.asleep {
                  Image(systemName: "moon.zzz.fill").foregroundStyle(.indigo)
                    .accessibilityLabel("Asleep")
                }
              }
              Text(child.time).font(.body)
              Text(child.messages).font(.footnote).foregroundStyle(.secondary)
              if let bedtime = child.bedtime {
                Label(bedtime, systemImage: "bed.double.fill")
                  .font(.footnote).foregroundStyle(.secondary)
              }
              if child.asleep {
                Text("SKYCOT is asleep for \(child.name).")
                  .font(.footnote).foregroundStyle(.indigo)
              }
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
          }
        }
      }
    }
    .navigationTitle("Today")
  }
}

// MARK: Lock

struct LockPage: View {
  let snapshot: WatchSnapshot
  @EnvironmentObject private var phone: PhoneLink
  @State private var asking = false
  @State private var stage: String?
  @State private var busy = false

  var body: some View {
    ScrollViewReader { reader in
    ScrollView {
      VStack(spacing: 8) {
        Image(systemName: "lock.fill")
          .font(.system(size: 36))
          .foregroundStyle(.orange)
        Text("Lock SKYCOT now").font(.headline)
        Text(
          "Ends every grown-up's yes on every device, such as Advanced mode left open on the Mac."
        )
        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
        Button {
          asking = true
        } label: {
          if busy { ProgressView() } else { Text("Lock now").frame(maxWidth: .infinity) }
        }
        .buttonStyle(.borderedProminent)
        .tint(.orange)
        .disabled(busy)
        if let stage {
          Text(stage).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            .id("end")
        } else if let lockedAt = snapshot.lockedAt {
          Text("Locked at \(clock(lockedAt)).").font(.footnote).foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity)
    }
    .onChange(of: stage) { _, _ in withAnimation { reader.scrollTo("end", anchor: .bottom) } }
    }
    .navigationTitle("Lock")
    .task {
      if SimulatorTest.step == "lock-ask" { asking = true }
      if SimulatorTest.step == "lock-confirm", stage == nil {
        try? await Task.sleep(for: .seconds(2))
        await lock()
      }
    }
    .confirmationDialog("Lock SKYCOT now?", isPresented: $asking, titleVisibility: .visible) {
      Button("Lock", role: .destructive) { Task { await lock() } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Every grown-up's yes ends now, on every device.")
    }
  }

  private func lock() async {
    busy = true
    defer { busy = false }
    do {
      let reply = try await phone.send(.lock)
      stage = reply.ok ? "Locked at \(clock(Date().timeIntervalSince1970 * 1000))." : reply.sentence
      tap(reply.ok ? .success : .failure)
    } catch {
      stage = "Your Watch can't reach your iPhone right now. Lock everything from your iPhone."
    }
  }
}

// MARK: Pieces

struct PhoneStatus: View {
  let snapshot: WatchSnapshot
  @EnvironmentObject private var phone: PhoneLink

  var body: some View {
    if !phone.reachable {
      Label("Can't reach your iPhone. Last heard at \(clock(snapshot.at)).", systemImage: "iphone.slash")
        .font(.footnote).foregroundStyle(.secondary)
    } else if !snapshot.reachable {
      Label("Your iPhone can't reach the Mac right now.", systemImage: "desktopcomputer")
        .font(.footnote).foregroundStyle(.secondary)
    }
  }
}

struct Avatar: View {
  let initial: String
  let colour: String
  let size: CGFloat

  var body: some View {
    Circle()
      .fill(Color(hex: colour))
      .frame(width: size, height: size)
      .overlay(
        Text(initial)
          .font(.system(size: size * 0.48, weight: .semibold, design: .rounded))
          .foregroundStyle(.white)
      )
      .accessibilityHidden(true)
  }
}

struct Notice: View {
  let symbol: String
  let title: String
  let text: String

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        Image(systemName: symbol).font(.system(size: 34)).foregroundStyle(.blue)
        Text(title).font(.headline)
        Text(text).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
      }
      .frame(maxWidth: .infinity)
      .padding(.top, 10)
    }
  }
}

extension Color {
  init(hex: String) {
    let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x3F8EF0
    self.init(
      red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255)
  }
}

/// "9:41 pm".
func clock(_ milliseconds: Double) -> String {
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_AU")
  formatter.dateFormat = "h:mm a"
  return formatter.string(from: Date(timeIntervalSince1970: milliseconds / 1000)).lowercased()
}

/// "Just now", "1 minute ago", "12 minutes ago".
func age(_ createdAt: Double) -> String {
  let minutes = Int((Date().timeIntervalSince1970 * 1000 - createdAt) / 60_000)
  if minutes < 1 { return "Just now" }
  return minutes == 1 ? "1 minute ago" : "\(minutes) minutes ago"
}

/// A tap on the wrist (not in the Simulator, which would play a sound).
func tap(_ kind: WKHapticType) {
  #if !targetEnvironment(simulator)
    WKInterfaceDevice.current().play(kind)
  #endif
}
