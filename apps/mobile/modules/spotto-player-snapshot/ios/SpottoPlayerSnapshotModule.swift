// Module local (mission « liens vidéo ») : « Spotter ce moment » dans le
// lecteur officiel TikTok ou Instagram. UNE seule fonction, `snapshot` :
//   1. met en pause les médias de la vue web du lecteur
//      (WKWebView.pauseAllMediaPlayback, iOS 15+) ;
//   2. prend l'instantané de ce que la vue montre
//      (WKWebView.takeSnapshot(with:completionHandler:)) ;
//   3. l'écrit en JPEG (1 600 px au plus, qualité 0,8) dans le sous-dossier
//      « lecteur-instantane/ » du cache de l'app, et rend l'adresse du
//      fichier. Le JS l'efface dès que la recherche est partie ou que le
//      parcours est abandonné (src/lib/video-context.ts), et vide ce dossier
//      à chaque lancement de l'app (src/lib/player-snapshot-files.ts) : un
//      instantané laissé par une app fermée en plein parcours ne reste pas.
// Rien d'autre : pas d'enregistrement de l'écran (ReplayKit), pas de PDF,
// aucun appel réseau, aucun fichier de la plateforme lu ou téléchargé.
//
// ⚠️ SI L'INSTANTANÉ SORT NOIR SUR UN VRAI IPHONE : S'ARRÊTER LÀ. Aucune autre
// méthode de capture ne peut être ajoutée sans la décision du fondateur
// (règle absolue n° 2 : l'image est l'instantané de la vue, rien d'autre).
// L'écran de secours « Spottez cette vidéo » (capture d'écran faite par la
// personne) reste alors le chemin.
//
// Relié à l'app seulement si au moins un lecteur est dans le build
// (plugins/lecteur-integre.js). Repris du module retiré au commit 93ba4d1
// (chemin takeSnapshot et pause des médias seulement). NON COMPILÉ ICI (pas
// de Swift dans le bac à sable) : à compiler sur le Mac ou sur EAS.

import ExpoModulesCore
import UIKit
import WebKit

public final class SpottoPlayerSnapshotModule: Module {
  /// Plus grand côté de l'image écrite, en pixels.
  private static let maxSide: CGFloat = 1600
  /// Qualité du JPEG écrit.
  private static let quality: CGFloat = 0.8
  /// Sous-dossier du cache, vidé par l'app à chaque lancement (même nom que
  /// PLAYER_SNAPSHOT_FOLDER, src/lib/player-snapshot-files.ts).
  static let folder = "lecteur-instantane"

  public func definition() -> ModuleDefinition {
    Name("SpottoPlayerSnapshot")

    // viewTag : numéro du conteneur natif (View collapsable={false}) qui entoure la vue web.
    AsyncFunction("snapshot") { (viewTag: Int, promise: Promise) in
      MainActor.assumeIsolated {
        guard let webView = self.findWebView(viewTag: viewTag) else {
          promise.reject(WebViewNotFoundException())
          return
        }
        guard let cache = self.appContext?.config.cacheDirectory else {
          promise.reject(Exceptions.AppContextLost())
          return
        }
        let directory = cache.appendingPathComponent(Self.folder, isDirectory: true)
        let area = webView.bounds
        guard area.width >= 1, area.height >= 1 else {
          promise.reject(EmptyAreaException())
          return
        }
        webView.pauseAllMediaPlayback {
          let configuration = WKSnapshotConfiguration()
          configuration.rect = area
          configuration.afterScreenUpdates = true
          // Largeur en points ; l'image est rendue à l'échelle de l'écran, puis ramenée à 1 600 px au plus.
          configuration.snapshotWidth = NSNumber(value: Double(area.width))
          webView.takeSnapshot(with: configuration) { image, error in
            guard let image else {
              promise.reject(SnapshotFailedException(error?.localizedDescription ?? "no image"))
              return
            }
            writeJPEG(image, maxSide: Self.maxSide, quality: Self.quality, into: directory, promise: promise)
          }
        }
      }
    }
    .runOnQueue(.main)
  }

  /// La vue du conteneur, trouvée par son numéro, puis sa WKWebView (react-native-webview : RNCWKWebView).
  @MainActor
  private func findWebView(viewTag: Int) -> WKWebView? {
    guard let container = appContext?.findView(withTag: viewTag, ofType: UIView.self) else {
      return nil
    }
    return firstWebView(in: container)
  }
}

/// Réduit l'image (1 600 px au plus sur son plus grand côté), l'encode en JPEG
/// hors du fil principal, l'écrit dans le sous-dossier du cache (créé au
/// besoin), puis rend l'adresse du fichier.
private func writeJPEG(_ image: UIImage, maxSide: CGFloat, quality: CGFloat, into directory: URL, promise: Promise) {
  DispatchQueue.global(qos: .userInitiated).async {
    let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
    let factor = min(1, maxSide / max(pixels.width, pixels.height, 1))
    let target = CGSize(width: (pixels.width * factor).rounded(), height: (pixels.height * factor).rounded())
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: target))
    }
    guard let data = resized.jpegData(compressionQuality: quality) else {
      promise.reject(ImageEncodingException())
      return
    }
    let file = directory.appendingPathComponent("lecteur-instantane-\(UUID().uuidString).jpg")
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try data.write(to: file, options: .atomic)
    } catch {
      promise.reject(SnapshotFailedException("write: \(error.localizedDescription)"))
      return
    }
    promise.resolve(file.absoluteString)
  }
}

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

// MARK: - Erreurs (code JS : ERR_… tiré du nom de la classe)

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
    "The snapshot could not be encoded"
  }
}

final class SnapshotFailedException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "The snapshot failed (\(param))"
  }
}
