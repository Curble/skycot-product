// On-device voice typing for SKYCOT (Curble Pty Ltd). A child's words are turned into text by
// Apple Speech on this iPhone or iPad only (`requiresOnDeviceRecognition`): nothing is sent to
// Apple, Google or anyone else, which is why the Mac's grown-up switch for talking can be
// trusted here. If this device can't recognise speech on its own, talking stays off.
import AVFoundation
import ExpoModulesCore
import Speech

public final class SkycotSpeechModule: Module {
  private let audioEngine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?

  public func definition() -> ModuleDefinition {
    Name("SkycotSpeech")
    Events("onTranscript", "onEnd")

    AsyncFunction("availability") { (locale: String?) -> String in
      let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale ?? "en-AU"))
      guard let recognizer else { return "unsupported" }
      if !recognizer.supportsOnDeviceRecognition { return "not-on-device" }
      return recognizer.isAvailable ? "available" : "busy"
    }

    AsyncFunction("requestPermissions") { (promise: Promise) in
      SFSpeechRecognizer.requestAuthorization { status in
        guard status == .authorized else {
          promise.resolve(false)
          return
        }
        AVAudioApplication.requestRecordPermission { granted in
          promise.resolve(granted)
        }
      }
    }

    AsyncFunction("start") { (locale: String?) in
      try self.begin(locale: locale ?? "en-AU")
    }

    AsyncFunction("stop") {
      self.finish()
    }

    OnDestroy {
      self.finish()
    }
  }

  private func begin(locale: String) throws {
    finish()
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)),
      recognizer.supportsOnDeviceRecognition
    else {
      throw Exception(name: "SpeechUnavailable", description: "This device can't turn speech into words by itself.")
    }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .measurement, options: .duckOthers)
    try session.setActive(true, options: .notifyOthersOnDeactivation)

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = true
    request.addsPunctuation = true
    self.request = request

    let input = audioEngine.inputNode
    let format = input.outputFormat(forBus: 0)
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
      request.append(buffer)
    }
    audioEngine.prepare()
    try audioEngine.start()

    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self else { return }
      if let result {
        self.sendEvent("onTranscript", [
          "text": result.bestTranscription.formattedString,
          "isFinal": result.isFinal,
        ])
      }
      if error != nil || result?.isFinal == true {
        self.finish()
      }
    }
  }

  private func finish() {
    let wasRunning = audioEngine.isRunning || task != nil
    if audioEngine.isRunning {
      audioEngine.stop()
      audioEngine.inputNode.removeTap(onBus: 0)
    }
    request?.endAudio()
    task?.cancel()
    request = nil
    task = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    if wasRunning {
      sendEvent("onEnd", [:])
    }
  }
}
