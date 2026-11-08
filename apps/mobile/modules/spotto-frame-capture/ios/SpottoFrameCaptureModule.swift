// Module local de Spotto (lot « lecteur intégré ») : prendre l'image affichée
// par le lecteur officiel (TikTok, Instagram) dans la vue web de l'écran
// Lecteur, sans rien télécharger. Méthodes, choisies et ordonnées par le JS
// (src/lib/player-capture.ts), qui vérifie aussi que l'image n'est pas noire :
//  - "pdf"      : WKWebView.createPDF (iOS 14+) ; WebKit repeint la page,
//                 image courante de la vidéo comprise (note R3 §4.A) ;
//  - "snapshot" : WKWebView.takeSnapshot (iOS 11+) ; copie du serveur
//                 d'affichage, vidéo souvent noire (note R3 §1) ;
//  - captureScreen : ReplayKit, RPScreenRecorder.startCapture (iOS 11+,
//                 déprécié en iOS 27) ; invite d'iOS ; une seule image gardée.
// Chaque méthode écrit un JPEG dans le dossier de cache d'Expo (celui de
// Paths.cache : le JS l'efface avec discardLocalFile) et renvoie
// { uri, width, height }. Swift 5.9 (podspec), comme expo-clipboard.
// Corrections de la contre-expertise : n° 13 (mediaState), n° 16
// (cancelScreenCapture, 0,6 s ignorées), n° 20 (Sendable, @MainActor,
// RPRecordingErrorCode). NON COMPILÉ ICI (pas de Swift dans le bac à sable) :
// à compiler sur le Mac ou sur EAS.

import CoreImage
import CoreMedia
import ExpoModulesCore
import PDFKit
import ReplayKit
import UIKit
import WebKit

public final class SpottoFrameCaptureModule: Module {
  /// Capture d'écran ReplayKit en cours (une seule à la fois). Lue et modifiée sur le fil principal.
  private var screenGrabber: ScreenFrameGrabber?

  public func definition() -> ModuleDefinition {
    Name("SpottoFrameCapture")

    // Photo directe de la vue web : method = "pdf" ou "snapshot".
    AsyncFunction("captureWebView") { (viewTag: Int, method: String, promise: Promise) in
      MainActor.assumeIsolated {
        guard let webView = self.findWebView(viewTag: viewTag) else {
          promise.reject(WebViewNotFoundException())
          return
        }
        guard let directory = self.appContext?.config.cacheDirectory else {
          promise.reject(Exceptions.AppContextLost())
          return
        }
        let area = webView.bounds
        guard area.width >= 1, area.height >= 1 else {
          promise.reject(EmptyAreaException())
          return
        }
        switch method {
        case "pdf":
          captureAsPDF(webView, area: area, scale: max(webView.traitCollection.displayScale, 1), directory: directory, promise: promise)
        case "snapshot":
          captureAsSnapshot(webView, area: area, directory: directory, promise: promise)
        default:
          promise.reject(UnknownMethodException(method))
        }
      }
    }
    .runOnQueue(.main)

    AsyncFunction("screenCaptureAvailable") { () -> Bool in
      RPScreenRecorder.shared().isAvailable
    }
    .runOnQueue(.main)

    // Une image de l'écran par ReplayKit, recadrée sur la vue web.
    AsyncFunction("captureScreen") { (viewTag: Int, promise: Promise) in
      MainActor.assumeIsolated {
        guard let webView = self.findWebView(viewTag: viewTag), let window = webView.window else {
          promise.reject(WebViewNotFoundException())
          return
        }
        guard self.screenGrabber == nil else {
          promise.reject(CaptureBusyException())
          return
        }
        guard RPScreenRecorder.shared().isAvailable else {
          promise.reject("ERR_SCREEN_RECORDING_UNAVAILABLE", "Screen recording is not available")
          return
        }
        guard let directory = self.appContext?.config.cacheDirectory else {
          promise.reject(Exceptions.AppContextLost())
          return
        }
        // Cadre du lecteur dans le repère de la fenêtre, en points.
        let area = webView.convert(webView.bounds, to: window)
        guard area.width >= 1, area.height >= 1, window.bounds.width >= 1, window.bounds.height >= 1 else {
          promise.reject(EmptyAreaException())
          return
        }
        let grabber = ScreenFrameGrabber(windowSize: window.bounds.size, area: area) { [weak self] result in
          self?.screenGrabber = nil
          switch result {
          case .success(let image):
            writeJPEG(image, into: directory, promise: promise)
          case .failure(let failure):
            promise.reject(failure.code, failure.message)
          }
        }
        self.screenGrabber = grabber
        grabber.start()
      }
    }
    .runOnQueue(.main)

    // Délai global dépassé côté JS (60 s, alerte d'iOS comprise) : on arrête
    // la capture en cours ; sa promesse est rejetée (…_CANCELLED).
    AsyncFunction("cancelScreenCapture") { () in
      self.screenGrabber?.cancel()
    }
    .runOnQueue(.main)

    // Met en pause toute la vue web (iOS 15+), puis rend l'état lu.
    AsyncFunction("pauseMedia") { (viewTag: Int, promise: Promise) in
      MainActor.assumeIsolated {
        guard let webView = self.findWebView(viewTag: viewTag) else {
          promise.reject(WebViewNotFoundException())
          return
        }
        webView.pauseAllMediaPlayback {
          webView.requestMediaPlaybackState { state in
            promise.resolve(playbackStateName(state))
          }
        }
      }
    }
    .runOnQueue(.main)

    // État de lecture de la vue web, sans rien changer : « playing » quand une
    // vidéo joue (codes d'intégration : bouton actif après une lecture
    // constatée, contre-expertise n° 13).
    AsyncFunction("mediaState") { (viewTag: Int, promise: Promise) in
      MainActor.assumeIsolated {
        guard let webView = self.findWebView(viewTag: viewTag) else {
          promise.reject(WebViewNotFoundException())
          return
        }
        webView.requestMediaPlaybackState { state in
          promise.resolve(playbackStateName(state))
        }
      }
    }
    .runOnQueue(.main)
  }

  /// La vue du conteneur (View collapsable={false}) qui entoure la WebView,
  /// trouvée par son numéro dans le registre Fabric, puis sa WKWebView.
  @MainActor
  private func findWebView(viewTag: Int) -> WKWebView? {
    guard let container = appContext?.findView(withTag: viewTag, ofType: UIView.self) else {
      return nil
    }
    return firstWebView(in: container)
  }
}

// MARK: - Photo directe de la vue web

/// createPDF : rectangle en coordonnées de la vue, rendu à l'échelle de l'écran (note R3 §6).
@MainActor
private func captureAsPDF(_ webView: WKWebView, area: CGRect, scale: CGFloat, directory: URL, promise: Promise) {
  let configuration = WKPDFConfiguration()
  configuration.rect = area
  webView.createPDF(configuration: configuration) { result in
    switch result {
    case .failure(let error):
      promise.reject(CaptureFailedException("pdf: \(error.localizedDescription)"))
    case .success(let data):
      guard let page = PDFDocument(data: data)?.page(at: 0) else {
        promise.reject(CaptureFailedException("pdf: no page"))
        return
      }
      let box = page.bounds(for: .mediaBox)
      guard box.width >= 1, box.height >= 1 else {
        promise.reject(EmptyAreaException())
        return
      }
      let format = UIGraphicsImageRendererFormat()
      format.scale = scale
      format.opaque = true
      let image = UIGraphicsImageRenderer(size: box.size, format: format).image { context in
        UIColor.black.setFill()
        context.fill(CGRect(origin: .zero, size: box.size))
        // Repère PDF (origine en bas à gauche) → repère UIKit (en haut à gauche).
        context.cgContext.translateBy(x: 0, y: box.size.height)
        context.cgContext.scaleBy(x: 1, y: -1)
        page.draw(with: .mediaBox, to: context.cgContext)
      }
      writeJPEG(image, into: directory, promise: promise)
    }
  }
}

/// takeSnapshot : largeur en points, image à l'échelle de l'écran (WKWebView.mm l.1693-1705, note R3 §1).
@MainActor
private func captureAsSnapshot(_ webView: WKWebView, area: CGRect, directory: URL, promise: Promise) {
  let configuration = WKSnapshotConfiguration()
  configuration.rect = area
  configuration.afterScreenUpdates = true
  configuration.snapshotWidth = NSNumber(value: Double(area.width))
  webView.takeSnapshot(with: configuration) { image, error in
    guard let image else {
      promise.reject(CaptureFailedException("snapshot: \(error?.localizedDescription ?? "no image")"))
      return
    }
    writeJPEG(image, into: directory, promise: promise)
  }
}

// MARK: - Une image de l'écran (ReplayKit)

private enum ScreenCaptureFailure: Error {
  case declined, disabled, phoneCall, interrupted, timeout, noFrame, geometry, cancelled
  case failed(Int)

  init(_ error: Error) {
    let nsError = error as NSError
    guard nsError.domain == RPRecordingErrorDomain, let code = RPRecordingErrorCode(rawValue: nsError.code) else {
      self = .failed(nsError.code)
      return
    }
    switch code {
    case .userDeclined: self = .declined
    case .disabled: self = .disabled
    case .activePhoneCall: self = .phoneCall
    case .interrupted, .contentResize, .systemDormancy: self = .interrupted
    default: self = .failed(nsError.code)
    }
  }

  var code: String {
    switch self {
    case .declined: return "ERR_SCREEN_RECORDING_DECLINED"
    case .disabled: return "ERR_SCREEN_RECORDING_DISABLED"
    case .phoneCall: return "ERR_SCREEN_RECORDING_PHONE_CALL"
    case .interrupted: return "ERR_SCREEN_RECORDING_INTERRUPTED"
    case .timeout: return "ERR_SCREEN_RECORDING_TIMEOUT"
    case .noFrame: return "ERR_SCREEN_RECORDING_NO_FRAME"
    case .geometry: return "ERR_SCREEN_RECORDING_GEOMETRY"
    case .cancelled: return "ERR_SCREEN_RECORDING_CANCELLED"
    case .failed: return "ERR_SCREEN_RECORDING_FAILED"
    }
  }

  var message: String {
    if case .failed(let code) = self {
      return "ReplayKit error \(code)"
    }
    return code
  }
}

/// Capture dans l'app par ReplayKit : micro et caméra coupés, images des 0,6
/// premières secondes ignorées (l'alerte d'iOS s'efface ; à calibrer, essai
/// C7), la première image suivante est recadrée sur le lecteur, puis tout
/// s'arrête. Délai : 2,5 s une fois l'enregistrement lancé ; le JS ajoute un
/// délai global de 60 s, alerte comprise, et appelle cancel().
/// @unchecked Sendable : l'état mutable n'est lu et modifié que sur `state`.
private final class ScreenFrameGrabber: @unchecked Sendable {
  private let recorder = RPScreenRecorder.shared()
  private let windowSize: CGSize
  private let area: CGRect
  private let onDone: (Result<UIImage, ScreenCaptureFailure>) -> Void
  private let state = DispatchQueue(label: "spotto.frame-capture.screen")
  private let imageContext = CIContext()
  // Lus et modifiés sur `state` seulement.
  private var acceptAfter: DispatchTime?
  private var taking = false
  private var started = false
  private var finished = false

  init(windowSize: CGSize, area: CGRect, onDone: @escaping (Result<UIImage, ScreenCaptureFailure>) -> Void) {
    self.windowSize = windowSize
    self.area = area
    self.onDone = onDone
  }

  /// Sur le fil principal.
  func start() {
    recorder.isMicrophoneEnabled = false
    recorder.isCameraEnabled = false
    if recorder.isRecording {
      // Capture restée ouverte (sinon code −5830) : on l'arrête d'abord (note R3 §6).
      recorder.stopCapture { [weak self] _ in
        DispatchQueue.main.async { self?.begin() }
      }
    } else {
      begin()
    }
  }

  /// Délai global du JS dépassé (alerte d'iOS restée affichée, ou rien reçu).
  func cancel() {
    finish(.failure(.cancelled))
  }

  private func begin() {
    recorder.startCapture(handler: { [weak self] sampleBuffer, bufferType, error in
      guard let self, error == nil, bufferType == .video else { return }
      self.consider(sampleBuffer)
    }, completionHandler: { [weak self] error in
      guard let self else { return }
      if let error {
        self.finish(.failure(ScreenCaptureFailure(error)))
        return
      }
      self.state.async {
        // Abandon pendant l'alerte d'iOS : l'enregistrement vient de démarrer, on l'arrête aussitôt.
        if self.finished {
          DispatchQueue.main.async { self.recorder.stopCapture { _ in } }
          return
        }
        self.started = true
        self.acceptAfter = .now() + 0.6
      }
      self.state.asyncAfter(deadline: .now() + 2.5) { [weak self] in
        self?.finish(.failure(.timeout))
      }
    })
  }

  /// Sur la file de ReplayKit.
  private func consider(_ sampleBuffer: CMSampleBuffer) {
    var take = false
    state.sync {
      if let after = acceptAfter, !finished, !taking, DispatchTime.now() >= after {
        taking = true
        take = true
      }
    }
    guard take else { return }
    finish(crop(sampleBuffer))
  }

  /// Tampon (pixels) → image recadrée sur le lecteur. Échelle = largeur du
  /// tampon / largeur de la fenêtre, jamais supposée (note R3 §3).
  private func crop(_ sampleBuffer: CMSampleBuffer) -> Result<UIImage, ScreenCaptureFailure> {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      return .failure(.noFrame)
    }
    let frame = CIImage(cvPixelBuffer: pixelBuffer)
    guard let full = imageContext.createCGImage(frame, from: frame.extent) else {
      return .failure(.noFrame)
    }
    let scaleX = CGFloat(full.width) / windowSize.width
    let scaleY = CGFloat(full.height) / windowSize.height
    // Même forme que la fenêtre (app en portrait) ; sinon l'image est tournée :
    // on n'invente rien (RPVideoSampleOrientationKey : À VÉRIFIER).
    guard scaleX > 0, abs(scaleX - scaleY) <= scaleX * 0.05 else {
      return .failure(.geometry)
    }
    let pixels = CGRect(x: area.minX * scaleX, y: area.minY * scaleY, width: area.width * scaleX, height: area.height * scaleY).integral
    guard let cropped = full.cropping(to: pixels) else {
      return .failure(.geometry)
    }
    return .success(UIImage(cgImage: cropped, scale: scaleX, orientation: .up))
  }

  private func finish(_ result: Result<UIImage, ScreenCaptureFailure>) {
    state.async { [weak self] in
      guard let self, !self.finished else { return }
      self.finished = true
      let stop = self.started
      DispatchQueue.main.async {
        if stop {
          self.recorder.stopCapture { _ in }
        }
        self.onDone(result)
      }
    }
  }
}

// MARK: - Outils

/// Enregistre l'image en JPEG dans le cache d'Expo (hors du fil principal), puis répond au JS.
private func writeJPEG(_ image: UIImage, into directory: URL, promise: Promise) {
  DispatchQueue.global(qos: .userInitiated).async {
    guard let data = image.jpegData(compressionQuality: 0.95) else {
      promise.reject(ImageEncodingException())
      return
    }
    let file = directory.appending(path: "spotto-lecteur-\(UUID().uuidString).jpg")
    do {
      try data.write(to: file, options: .atomic)
    } catch {
      promise.reject(CaptureFailedException("write: \(error.localizedDescription)"))
      return
    }
    let size: [String: Any] = [
      "uri": file.absoluteString,
      "width": Int((image.size.width * image.scale).rounded()),
      "height": Int((image.size.height * image.scale).rounded()),
    ]
    promise.resolve(size)
  }
}

/// La WKWebView de react-native-webview (RNCWKWebView : WKWebView), sous le conteneur.
@MainActor
private func firstWebView(in view: UIView) -> WKWebView? {
  if let webView = view as? WKWebView {
    return webView
  }
  for child in view.subviews {
    if let found = firstWebView(in: child) {
      return found
    }
  }
  return nil
}

private func playbackStateName(_ state: WKMediaPlaybackState) -> String {
  switch state {
  case .none: return "none"
  case .playing: return "playing"
  case .paused: return "paused"
  case .suspended: return "suspended"
  @unknown default: return "unknown"
  }
}

// MARK: - Erreurs (code JS : ERR_… tiré du nom de la classe, CodedError.swift l.45)

final class WebViewNotFoundException: Exception, @unchecked Sendable {
  override var reason: String {
    "No web view was found for this view tag"
  }
}

final class EmptyAreaException: Exception, @unchecked Sendable {
  override var reason: String {
    "The player area is empty"
  }
}

final class ImageEncodingException: Exception, @unchecked Sendable {
  override var reason: String {
    "The frame could not be encoded"
  }
}

final class CaptureBusyException: Exception, @unchecked Sendable {
  override var reason: String {
    "A screen capture is already running"
  }
}

final class UnknownMethodException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Unknown capture method: \(param)"
  }
}

final class CaptureFailedException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "The capture failed (\(param))"
  }
}
