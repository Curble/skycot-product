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
      // An empty key (a push that names no request) lands on the Requests list itself.
      path = opened.key.isEmpty ? [] : [RequestRoute(key: opened.key, decline: opened.decline)]
      router.opened = nil
      if opened.key.isEmpty { Task { await phone.refresh() } }
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
          RequestsPage(snapshot: snapshot) { path.append($0) }.tag(0)
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
  let open: (RequestRoute) -> Void
  @EnvironmentObject private var phone: PhoneLink

  var body: some View {
    let waiting = snapshot.requests
    let notes = snapshot.notes ?? []
    Group {
      if waiting.isEmpty && notes.isEmpty {
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
            .swipeActions(edge: .trailing) {
              if !request.lapsed && request.watchCanSayYes {
                Button {
                  open(RequestRoute(key: request.id, decline: false, allow: true))
                } label: {
                  Label("Allow once", systemImage: "checkmark")
                }
                .tint(.green)
              }
            }
          }
          ForEach(notes) { note in
            NavigationLink {
              NoteView(key: note.id)
            } label: {
              NoteRow(note: note)
            }
          }
          PhoneStatus(snapshot: snapshot).listRowBackground(Color.clear)
        }
      }
    }
    .navigationTitle(waiting.isEmpty ? "Requests" : "Requests · \(waiting.count)")
  }
}

struct RequestRow: View {
  let request: WatchRequest

  var body: some View {
    HStack(spacing: 10) {
      Avatar(initial: request.childInitial, colour: request.childColour, size: 32)
      VStack(alignment: .leading, spacing: 2) {
        Text(request.title).font(.headline).lineLimit(2)
        Text(request.sentence).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
        Text(request.lapsed ? "Waiting on the Mac" : age(request.createdAt))
          .font(.footnote).foregroundStyle(request.lapsed ? .orange : .secondary)
      }
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }
}

struct NoteRow: View {
  let note: WatchNote

  var body: some View {
    HStack(spacing: 10) {
      Avatar(initial: note.childInitial, colour: note.childColour, size: 32)
      VStack(alignment: .leading, spacing: 2) {
        Text(note.title).font(.headline).lineLimit(2)
        Text(age(note.createdAt)).font(.footnote).foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }
}

/// One family note. "Shown" is a line (the thing itself is on the iPhone). "More time" has 15
/// minutes, 30 minutes and Not tonight. Not tonight needs no proof, as Decline needs none, but
/// like every answer from the Watch it runs the wrist check first. 15 and 30 minutes are never
/// given from here: the Mac accepts them only with the parent code, which the Watch can't take,
/// and a Watch signature is accepted for a yes to a request only. So they point to the iPhone.
struct NoteView: View {
  let key: String
  @EnvironmentObject private var phone: PhoneLink
  @State private var kept: WatchNote?
  @State private var stage: RequestView.Stage = .ready

  var body: some View {
    let note = phone.snapshot?.notes?.first { $0.id == key } ?? kept
    ScrollView {
      if let note {
        card(note)
      } else {
        Notice(symbol: "checkmark.circle", title: "All done", text: "That one has been answered.")
      }
    }
    .navigationTitle(note?.childName ?? "Note")
    .onAppear { if kept == nil { kept = note } }
    .onChange(of: note) { _, fresh in if let fresh { kept = fresh } }
  }

  @ViewBuilder private func card(_ note: WatchNote) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Avatar(initial: note.childInitial, colour: note.childColour, size: 28)
        Text(note.title).font(.headline).fixedSize(horizontal: false, vertical: true)
      }
      if let mac = note.macName {
        Label(mac, systemImage: "desktopcomputer").font(.footnote).foregroundStyle(.secondary)
      }
      if note.kind == "shown" {
        Label(note.sentence, systemImage: "iphone").font(.body)
          .fixedSize(horizontal: false, vertical: true)
      } else {
        Text(note.sentence).font(.body).fixedSize(horizontal: false, vertical: true)
        outcome(note)
      }
    }
    .padding(.horizontal, 2)
  }

  @ViewBuilder private func outcome(_ note: WatchNote) -> some View {
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
      Button {
        stage = .openOnIPhone(
          "More time needs the parent code, on your iPhone. \(note.childName)'s note is waiting there."
        )
      } label: {
        Label("15 minutes", systemImage: "clock").frame(maxWidth: .infinity)
      }
      .buttonStyle(.bordered)
      .padding(.top, 6)
      Button {
        stage = .openOnIPhone(
          "More time needs the parent code, on your iPhone. \(note.childName)'s note is waiting there."
        )
      } label: {
        Label("30 minutes", systemImage: "clock.badge.plus").frame(maxWidth: .infinity)
      }
      .buttonStyle(.bordered)
      Button {
        Task { await notTonight(note) }
      } label: {
        Label("Not tonight", systemImage: "moon.zzz").frame(maxWidth: .infinity)
      }
      .buttonStyle(.bordered)
      if let simulated = WristCheck.simulatorNote {
        Text(simulated).font(.caption2).foregroundStyle(.tertiary)
      }
    }
  }

  private func notTonight(_ note: WatchNote) async {
    switch await WristCheck.confirm(reason: "Say not tonight to \(note.childName)") {
    case .cancelled: return
    case .openOnIPhone(let words):
      stage = .openOnIPhone(words)
      return
    case .confirmed: break
    }
    stage = .working("Telling your iPhone…")
    do {
      let answered = try await phone.send(.noteNotTonight(note))
      if answered.ok {
        stage = .done(answered.sentence ?? "Said not tonight.")
        tap(.success)
      } else {
        stage = .problem(answered.sentence ?? "That didn't work. Try again.")
        tap(.failure)
      }
    } catch {
      stage = .openOnIPhone("Your Watch can't reach your iPhone right now.")
    }
  }
}

/// One request, and Allow once / Decline.
// nondev-seam: skycot-watch-project-approval-choice
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
        if SimulatorTest.step == "allow-first" {
          try? await Task.sleep(for: .seconds(3))
        }
        await allow(request)
      }
    }
  }

  @ViewBuilder private func card(_ request: WatchRequest) -> some View {
    let matches =
      cardFingerprint(
        threadId: request.threadId, requestId: request.requestId, what: request.what,
        why: request.why) == request.fingerprint
    let projectMatches = request.projectFingerprint.map { fingerprint in
      cardFingerprint(
        threadId: request.threadId, requestId: request.requestId, what: request.what,
        why: request.why, scope: "project", covers: request.projectCovers ?? []) == fingerprint
    } ?? false
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Avatar(initial: request.childInitial, colour: request.childColour, size: 28)
        Text(request.title).font(.headline).fixedSize(horizontal: false, vertical: true)
      }
      // nondev-seam: skycot-watch-request-sentence-view
      Text(request.sentence).font(.title3).fixedSize(horizontal: false, vertical: true)
      if let goal = request.goal { Text("Goal: \(goal)").font(.footnote).foregroundStyle(.secondary) }
      if let projectSentence = request.projectSentence {
        Text(projectSentence).font(.footnote).foregroundStyle(.secondary)
      }
      if let mac = request.macName {
        Label(mac, systemImage: "desktopcomputer").font(.footnote).foregroundStyle(.secondary)
      }
      outcome(request, matches: matches, projectMatches: projectMatches)
    }
    .padding(.horizontal, 2)
  }

  @ViewBuilder private func outcome(_ request: WatchRequest, matches: Bool, projectMatches: Bool) -> some View {
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
          if request.batchLead == true, let batchCount = request.batchCount, batchCount > 1,
             request.batchId != nil, request.batchFingerprint != nil {
            Button {
              Task { await allowBatch(request) }
            } label: {
              Label("Allow all \(batchCount)", systemImage: "checkmark.circle")
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
            .padding(.top, 6)
            .accessibilityLabel("Allow all \(batchCount) requests once")
            Button {
              Task { await answerBatch(request, decision: "decline") }
            } label: {
              Label("Not now for all \(batchCount)", systemImage: "xmark")
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .accessibilityLabel("Not now for all \(batchCount) requests")
          }
          Button {
            Task { await allow(request, scope: "once") }
          } label: {
            Label("Allow once", systemImage: "checkmark")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(.borderedProminent)
          .tint(.blue)
          .padding(.top, 6)
          .accessibilityLabel("Allow this request once")
          if request.projectFingerprint != nil && projectMatches {
            Button {
              Task { await allow(request, scope: "project") }
            } label: {
              Label("Allow for this project", systemImage: "folder.badge.checkmark")
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .padding(.top, 4)
            .accessibilityLabel("Allow this request for this project")
          }
        } else {
          Text("To say yes here, set up Apple Watch in Settings on your iPhone.")
            .font(.footnote).foregroundStyle(.secondary).padding(.top, 4)
        }
        Button {
          Task { await decline(request) }
        } label: {
          Label("Decline", systemImage: "xmark").frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .accessibilityLabel("Decline this request")
        if let note = WristCheck.simulatorNote {
          Text(note).font(.caption2).foregroundStyle(.tertiary)
        }
      }
    }
  }

  private func allowBatch(_ request: WatchRequest) async {
    guard let batchId = request.batchId, let fingerprint = request.batchFingerprint,
          let count = request.batchCount else { return }
    switch await WristCheck.confirm(reason: "Allow all \(count) requests from \(request.childName)") {
    case .cancelled: return
    case .openOnIPhone(let words): stage = .openOnIPhone(words); return
    case .confirmed: break
    }
    stage = .working("Asking your iPhone…")
    do {
      let issued = try await phone.send(.challengeBatch(request))
      guard issued.ok, let challenge = issued.challenge, let action = issued.action,
            let keyId = issued.keyId,
            action == "approve-batch:\(batchId):\(fingerprint)" else {
        stage = .problem(issued.sentence ?? "That list changed. Have another look on your iPhone.")
        return
      }
      let signature = try WatchKey.sign(watchSignedMessage(purpose: "approve", challenge: challenge, action: action))
      let answered = try await phone.send(.answerBatch(
        request, decision: "accept", proof: Proof(keyId: keyId, challenge: challenge, signature: signature)))
      if answered.ok { stage = .done("Allowed all \(count), once each."); tap(.success) }
      else { stage = .problem(answered.sentence ?? "That didn't work. Try again.") }
    } catch {
      stage = .openOnIPhone("Your Watch can't reach your iPhone right now.")
    }
  }

  private func answerBatch(_ request: WatchRequest, decision: String) async {
    guard request.batchId != nil, request.batchFingerprint != nil else { return }
    switch await WristCheck.confirm(reason: "Not now for all \(request.batchCount ?? 0) requests") {
    case .cancelled: return
    case .openOnIPhone(let words): stage = .openOnIPhone(words); return
    case .confirmed: break
    }
    do {
      let result = try await phone.send(.answerBatch(request, decision: decision, proof: nil))
      stage = result.ok ? .done("Not now. They see that on their screen.") : .problem(result.sentence ?? "That list changed. Have another look.")
    } catch { stage = .openOnIPhone("Your Watch can't reach your iPhone right now.") }
  }

  private func allow(_ request: WatchRequest, scope: String = "once") async {
    switch await WristCheck.confirm(reason: scope == "project" ? "Allow \(request.childName)'s request for this project" : "Allow \(request.childName)'s request once") {
    case .cancelled: return
    case .openOnIPhone(let words):
      stage = .openOnIPhone(words)
      return
    case .confirmed: break
    }
    stage = .working("Asking your iPhone…")
    do {
      let fingerprint = scope == "project" ? request.projectFingerprint ?? request.fingerprint : request.fingerprint
      let issued = try await phone.send(.challenge(request, scope: scope))
      guard issued.ok, let challenge = issued.challenge, let action = issued.action,
        let keyId = issued.keyId
      else {
        stage = .problem(issued.sentence ?? "Your iPhone couldn't ask the Mac. Try again.")
        return
      }
      // Sign only the request this card shows, whatever comes back.
      guard
        action == "approve:\(request.threadId):\(request.requestId):\(fingerprint)"
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
          proof: Proof(keyId: keyId, challenge: challenge, signature: signature), scope: scope))
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
      let answered = try await phone.send(.answer(request, decision: "decline", proof: nil, scope: nil))
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
